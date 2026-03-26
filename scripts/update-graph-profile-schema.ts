import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { fileURLToPath } from "node:url";

import type { GraphProfileSchemaSnapshot } from "../src/people/profile-schema.js";
import type { GraphCapabilitySnapshot } from "../src/graph/capabilities.js";

const V1_METADATA_URL = "https://graph.microsoft.com/v1.0/$metadata";
const METADATA_URL = "https://graph.microsoft.com/beta/$metadata";
const V1_OPENAPI_URL = "https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/v1.0/openapi.yaml";
const BETA_OPENAPI_URL = "https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/beta/openapi.yaml";

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

export type ExternalConnectorLabelSets = {
  allLabels: string[];
  peopleLabels: string[];
};

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

type RawEnumType = {
  name: string;
  namespace: string;
  fullName: string;
  members: Array<{ name: string; value?: string }>;
};

const buildEntityIndex = (schemas: any[]): Map<string, RawEntityType> => {
  const map = new Map<string, RawEntityType>();
  for (const schema of schemas) {
    const namespace = schema?.["@_Namespace"] ?? schema?.["@_namespace"];
    if (!namespace) continue;
    const entityTypes = toArray(schema?.EntityType ?? schema?.["edm:EntityType"]);
    const complexTypes = toArray(schema?.ComplexType ?? schema?.["edm:ComplexType"]);
    for (const entity of [...entityTypes, ...complexTypes]) {
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

const buildEnumIndex = (schemas: any[]): Map<string, RawEnumType> => {
  const map = new Map<string, RawEnumType>();
  for (const schema of schemas) {
    const namespace = schema?.["@_Namespace"] ?? schema?.["@_namespace"];
    if (!namespace) continue;
    const enumTypes = toArray(schema?.EnumType ?? schema?.["edm:EnumType"]);
    for (const entry of enumTypes) {
      const name = entry?.["@_Name"] ?? entry?.["@_name"];
      if (!name) continue;
      const fullName = `${namespace}.${name}`;
      const members = toArray(entry?.Member).map((member: any) => ({
        name: member?.["@_Name"] ?? member?.["@_name"],
        value: member?.["@_Value"] ?? member?.["@_value"],
      })).filter((member) => Boolean(member.name));
      map.set(fullName, {
        name,
        namespace,
        fullName,
        members,
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

const tryFindTypeByName = (index: Map<string, RawEntityType>, name: string): RawEntityType | undefined => {
  const matches = Array.from(index.values()).filter((entry) => entry.name === name);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  const preferred = matches.find((entry) => entry.namespace === "microsoft.graph");
  return preferred ?? matches[0];
};

const tryFindEnumByName = (index: Map<string, RawEnumType>, name: string): RawEnumType | undefined => {
  const matches = Array.from(index.values()).filter((entry) => entry.name === name);
  if (matches.length === 0) return undefined;
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

const resolvePropertyTypeName = (typeName: string): string | null => {
  const match = /^Collection\((.+)\)$/.exec(typeName);
  const rawType = match ? match[1]! : typeName;
  if (rawType.startsWith("Edm.")) return null;
  const parts = rawType.split(".").filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : null;
};

const createInitialGraphTypeNames = (): Set<string> => {
  const graphTypeNames = new Set(
    Object.values(labelTypeMap).map((typeName) => graphAliases[typeName] ?? typeName)
  );
  graphTypeNames.add("itemFacet");
  return graphTypeNames;
};

const normalizeLabelName = (value: string): string => value.trim().replace(/[.'`]+$/g, "");

const splitLabelList = (raw: string): string[] =>
  raw
    .split(",")
    .map((entry) => normalizeLabelName(entry))
    .filter(Boolean);

export const parseExternalConnectorLabelSets = (openApiYaml: string): ExternalConnectorLabelSets => {
  const enumBlockMatch = /microsoft\.graph\.externalConnectors\.label:\s*\n(?:.*\n)*?\s+enum:\s*\n((?:\s+-\s+[^\n]+\n)+)\s+type:\s+string/m.exec(
    openApiYaml
  );
  const enumLabels = enumBlockMatch
    ? Array.from(enumBlockMatch[1]!.matchAll(/-\s+([^\n]+)/g), (match) => normalizeLabelName(match[1]!))
    : [];

  const descriptionMatch = /The possible values are:\s*([^']+?)\.\s*Use the Prefer: include-unknown-enum-members request header to retrieve additional values defined in this evolvable enum,?\s*For People Connectors you can include\s*:\s*([^']+?)\./s.exec(
    openApiYaml
  );

  const standardLabels = descriptionMatch ? splitLabelList(descriptionMatch[1]!) : [];
  const peopleLabels = descriptionMatch ? splitLabelList(descriptionMatch[2]!) : [];

  return {
    allLabels: [...new Set([...enumLabels, ...standardLabels, ...peopleLabels])],
    peopleLabels: [...new Set(peopleLabels)],
  };
};

export const parseGraphMetadataSnapshot = (
  xml: string,
  generatedAt = new Date().toISOString(),
  graphVersion = "beta"
): GraphProfileSchemaSnapshot => {
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
  const enumIndex = buildEnumIndex(schemas);
  const enumTypeNames = new Set<string>();
  const graphTypeNames = createInitialGraphTypeNames();

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

  let addedReference = true;
  while (addedReference) {
    addedReference = false;
    for (const name of [...graphTypeNames]) {
      const entry = tryFindTypeByName(entityIndex, name);
      if (!entry) continue;
      const properties = collectProperties(entityIndex, entry);
      for (const prop of properties) {
        const referenced = resolvePropertyTypeName(prop.type);
        if (!referenced) continue;
        if (tryFindEnumByName(enumIndex, referenced)) {
          enumTypeNames.add(referenced);
          continue;
        }
        if (graphTypeNames.has(referenced)) continue;
        if (!tryFindTypeByName(entityIndex, referenced)) continue;
        graphTypeNames.add(referenced);
        addBaseTypes(referenced);
        addedReference = true;
      }
    }
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

  const enums = Array.from(enumTypeNames)
    .map((enumName) => tryFindEnumByName(enumIndex, enumName))
    .filter((entry): entry is RawEnumType => Boolean(entry))
    .map((entry) => ({
      name: entry.name,
      fullName: entry.fullName,
      namespace: entry.namespace,
      members: entry.members,
    }));

  return {
    generatedAt,
    graphVersion,
    types,
    enums,
    aliases: graphAliases,
    labelTypeMap
  };
};

const toResolvedTypeName = (snapshot: GraphProfileSchemaSnapshot, typeName: string): string =>
  snapshot.aliases[typeName] ?? typeName;

const computeAvailability = (
  v1Supported: boolean,
  betaSupported: boolean
): { availableIn: Array<"v1.0" | "beta">; minGraphApiVersion: "v1.0" | "beta" } => ({
  availableIn: [v1Supported ? "v1.0" : undefined, betaSupported ? "beta" : undefined].filter(
    (value): value is "v1.0" | "beta" => Boolean(value)
  ),
  minGraphApiVersion: v1Supported ? "v1.0" : "beta",
});

export const buildGraphCapabilitySnapshot = (
  v1Snapshot: GraphProfileSchemaSnapshot,
  betaSnapshot: GraphProfileSchemaSnapshot,
  v1Labels: ExternalConnectorLabelSets,
  betaLabels: ExternalConnectorLabelSets,
  generatedAt = new Date().toISOString()
): GraphCapabilitySnapshot => {
  const v1Types = new Set(v1Snapshot.types.map((type) => type.name));
  const betaTypes = new Set(betaSnapshot.types.map((type) => type.name));
  const allTypeNames = new Set<string>([...v1Types, ...betaTypes]);

  const profileTypes = Object.fromEntries(
    [...allTypeNames]
      .sort((left, right) => left.localeCompare(right))
      .map((typeName) => [
        typeName,
        computeAvailability(v1Types.has(typeName), betaTypes.has(typeName)),
      ])
  );

  const allLabels = new Set<string>([...v1Labels.allLabels, ...betaLabels.allLabels]);
  const labels = Object.fromEntries(
    [...allLabels]
      .sort((left, right) => left.localeCompare(right))
      .map((label) => [
        label,
        {
          ...computeAvailability(v1Labels.allLabels.includes(label), betaLabels.allLabels.includes(label)),
          kind:
            v1Labels.peopleLabels.includes(label) || betaLabels.peopleLabels.includes(label) ? "people" : "semantic",
        } as const,
      ])
  );

  const peopleLabels = Object.fromEntries(
    Object.entries(betaSnapshot.labelTypeMap)
      .filter(([label]) => betaLabels.peopleLabels.includes(label) || v1Labels.peopleLabels.includes(label))
      .map(([label, planTypeName]) => {
      const resolvedTypeName = toResolvedTypeName(betaSnapshot, planTypeName);
      return [
        label,
        {
          ...computeAvailability(v1Labels.peopleLabels.includes(label), betaLabels.peopleLabels.includes(label)),
          planTypeName,
          graphTypeName: resolvedTypeName,
        },
      ];
      })
  );

  return {
    generatedAt,
    connectionProperties: {
      contentCategory: computeAvailability(false, true),
      profileSourceRegistration: computeAvailability(false, true),
    },
    propertyTypes: {
      principal: computeAvailability(false, true),
      principalCollection: computeAvailability(false, true),
    },
    labels,
    peopleLabels,
    profileTypes,
  };
};

export const writeGraphProfileSnapshot = async (
  snapshot: GraphProfileSchemaSnapshot,
  cwd = process.cwd()
): Promise<string> => {
  const outDir = path.join(cwd, "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "graph-profile-schema.json");
  await writeFile(
    outPath,
    JSON.stringify(snapshot, null, 2) + "\n",
    "utf8"
  );
  return outPath;
};

export const writeGraphCapabilitySnapshot = async (
  snapshot: GraphCapabilitySnapshot,
  cwd = process.cwd()
): Promise<string> => {
  const outDir = path.join(cwd, "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "graph-capabilities.json");
  await writeFile(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return outPath;
};

export const fetchGraphMetadataXml = async (url = METADATA_URL): Promise<string> => {
  const res = await fetch(url, {
    headers: {
      Accept: "application/xml"
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to download Graph metadata: ${res.status} ${res.statusText}`);
  }
  return res.text();
};

export const fetchGraphOpenApiYaml = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: {
      Accept: "application/yaml, text/yaml, text/plain"
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to download Graph OpenAPI: ${res.status} ${res.statusText}`);
  }
  return res.text();
};

export const main = async (): Promise<void> => {
  const [v1Xml, betaXml, v1OpenApiYaml, betaOpenApiYaml] = await Promise.all([
    fetchGraphMetadataXml(V1_METADATA_URL),
    fetchGraphMetadataXml(METADATA_URL),
    fetchGraphOpenApiYaml(V1_OPENAPI_URL),
    fetchGraphOpenApiYaml(BETA_OPENAPI_URL),
  ]);
  const generatedAt = new Date().toISOString();
  const v1Snapshot = parseGraphMetadataSnapshot(v1Xml, generatedAt, "v1.0");
  const betaSnapshot = parseGraphMetadataSnapshot(betaXml, generatedAt, "beta");
  const capabilitySnapshot = buildGraphCapabilitySnapshot(
    v1Snapshot,
    betaSnapshot,
    parseExternalConnectorLabelSets(v1OpenApiYaml),
    parseExternalConnectorLabelSets(betaOpenApiYaml),
    generatedAt
  );

  await writeGraphProfileSnapshot(betaSnapshot);
  await writeGraphCapabilitySnapshot(capabilitySnapshot);

  console.log(
    `Wrote snapshot with ${betaSnapshot.types.length} types and ${betaSnapshot.enums.length} enums to data/graph-profile-schema.json`
  );
  console.log(
    `Wrote capability snapshot with ${Object.keys(capabilitySnapshot.profileTypes).length} profile types to data/graph-capabilities.json`
  );
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
