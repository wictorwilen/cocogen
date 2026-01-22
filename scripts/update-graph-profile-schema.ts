import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const METADATA_URL = "https://graph.microsoft.com/beta/$metadata";

const labelTypeMap = {
  personAccount: "userAccountInformation",
  personName: "personName",
  personCurrentPosition: "workPosition",
  personAddresses: "itemAddress",
  personEmails: "itemEmail",
  personPhones: "itemPhone",
  personAwards: "personAward",
  personCertifications: "personCertification",
  personProjects: "projectParticipation",
  personSkills: "skillProficiency",
  personWebAccounts: "webAccount",
  personWebSite: "webSite",
  personAnniversaries: "personAnniversary",
  personNote: "personAnnotation"
} as const;

const graphAliases: Record<string, string> = {
  personAnniversary: "personAnnualEvent",
  webSite: "personWebsite"
};

const graphTypeNames = new Set(
  Object.values(labelTypeMap).map((typeName) => graphAliases[typeName] ?? typeName)
);
graphTypeNames.add("itemFacet");

const toArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const pick = <T extends object>(obj: T | undefined | null, keys: string[]): any => {
  if (!obj) return undefined;
  for (const key of keys) {
    if (key in obj) return (obj as any)[key];
  }
  return undefined;
};

const findEdmx = (parsed: Record<string, unknown>): any => {
  return parsed["edmx:Edmx"] ?? parsed["Edmx"] ?? parsed["edmx:edmx"] ?? parsed;
};

const findDataServices = (edmx: any): any => {
  return edmx["edmx:DataServices"] ?? edmx["DataServices"] ?? edmx;
};

type RawEntityType = {
  name: string;
  namespace: string;
  fullName: string;
  baseType?: string;
  properties: Array<{ name: string; type: string; nullable: boolean }>;
};

const buildEntityIndex = (schemas: any[]): Map<string, RawEntityType> => {
  const map = new Map<string, RawEntityType>();
  for (const schema of schemas) {
    const namespace = schema?.["@_Namespace"] ?? schema?.["@_namespace"];
    if (!namespace) continue;
    const entityTypes = toArray(schema?.EntityType ?? schema?.["edm:EntityType"]);
    for (const entity of entityTypes) {
      const name = entity?.["@_Name"] ?? entity?.["@_name"];
      if (!name) continue;
      const fullName = `${namespace}.${name}`;
      const baseType = entity?.["@_BaseType"] ?? entity?.["@_baseType"];
      const properties = toArray(entity?.Property).map((prop: any) => {
        const propName = prop?.["@_Name"] ?? prop?.["@_name"];
        const type = prop?.["@_Type"] ?? prop?.["@_type"] ?? "Edm.String";
        const nullableRaw = prop?.["@_Nullable"] ?? prop?.["@_nullable"];
        const nullable = nullableRaw === undefined ? true : String(nullableRaw) !== "false";
        return {
          name: propName,
          type,
          nullable
        };
      });
      map.set(fullName, {
        name,
        namespace,
        fullName,
        baseType,
        properties: properties.filter((prop) => Boolean(prop.name))
      });
    }
  }
  return map;
};

const findTypeByName = (index: Map<string, RawEntityType>, name: string): RawEntityType => {
  const matches = Array.from(index.values()).filter((entry) => entry.name === name);
  if (matches.length === 0) {
    throw new Error(`Could not find entity type '${name}' in Graph metadata.`);
  }
  if (matches.length === 1) return matches[0];
  const preferred = matches.find((entry) => entry.namespace === "microsoft.graph");
  return preferred ?? matches[0];
};

const collectProperties = (
  index: Map<string, RawEntityType>,
  entry: RawEntityType
): Array<{ name: string; type: string; nullable: boolean }> => {
  const ordered: Array<{ name: string; type: string; nullable: boolean }> = [];
  const seen = new Map<string, { name: string; type: string; nullable: boolean }>();
  const visit = (item: RawEntityType | undefined) => {
    if (!item) return;
    if (item.baseType) {
      const base = index.get(item.baseType);
      visit(base);
    }
    for (const prop of item.properties) {
      if (!prop.name) continue;
      seen.set(prop.name, prop);
    }
  };
  visit(entry);
  for (const prop of seen.values()) {
    ordered.push(prop);
  }
  return ordered;
};

const main = async (): Promise<void> => {
  const res = await fetch(METADATA_URL, {
    headers: {
      Accept: "application/xml"
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to download Graph metadata: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });
  const parsed = parser.parse(xml);
  const edmx = findEdmx(parsed);
  const dataServices = findDataServices(edmx);
  const schemas = toArray(pick(dataServices, ["Schema", "edm:Schema", "Edm:Schema"]));
  if (!schemas.length) {
    throw new Error("No schemas found in Graph metadata.");
  }
  const entityIndex = buildEntityIndex(schemas);

  const addBaseTypes = (name: string): void => {
    const entry = findTypeByName(entityIndex, name);
    if (entry.name === "itemFacet") return;
    if (!entry.baseType) return;
    const baseName = entityIndex.get(entry.baseType)?.name ?? entry.baseType.split(".").pop();
    if (!baseName) return;
    if (!graphTypeNames.has(baseName)) {
      graphTypeNames.add(baseName);
      addBaseTypes(baseName);
    }
  };

  for (const name of [...graphTypeNames]) {
    addBaseTypes(name);
  }

  const types = Array.from(graphTypeNames).map((graphName) => {
    const entry = findTypeByName(entityIndex, graphName);
    const baseType = entry.baseType
      ? entry.name === "itemFacet"
        ? undefined
        : entityIndex.get(entry.baseType)?.name ?? entry.baseType.split(".").pop()
      : undefined;
    const properties = collectProperties(entityIndex, entry).map((prop) => ({
      name: prop.name,
      type: prop.type,
      nullable: prop.nullable
    }));
    const required = properties.filter((prop) => !prop.nullable).map((prop) => prop.name);
    return {
      name: entry.name,
      fullName: entry.fullName,
      namespace: entry.namespace,
      baseType,
      properties,
      required
    };
  });

  const snapshot = {
    generatedAt: new Date().toISOString(),
    graphVersion: "beta",
    types,
    aliases: graphAliases,
    labelTypeMap
  };

  const outDir = path.join(process.cwd(), "data");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "graph-profile-schema.json"),
    JSON.stringify(snapshot, null, 2) + "\n",
    "utf8"
  );

  console.log(`Wrote snapshot with ${types.length} types to data/graph-profile-schema.json`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
