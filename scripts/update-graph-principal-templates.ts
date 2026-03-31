import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

const PRINCIPAL_METADATA_URL = "https://graph.microsoft.com/v1.0/$metadata";
const PRINCIPAL_NAMESPACE = "microsoft.graph.externalConnectors";
const PRINCIPAL_COMPLEX_TYPE_NAME = "principal";

export type PrincipalComplexTypeProperty = {
  name: string;
  type: string;
  nullable: boolean;
};

export type PrincipalComplexTypeSnapshot = {
  generatedAt: string;
  graphVersion: "v1.0";
  sourceUrl: string;
  namespace: string;
  name: string;
  fullName: string;
  properties: PrincipalComplexTypeProperty[];
};

const toArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const pick = <T extends object>(obj: T | undefined | null, keys: string[]): unknown => {
  if (!obj) return undefined;
  for (const key of keys) {
    if (key in obj) return (obj as Record<string, unknown>)[key];
  }
  return undefined;
};

const findEdmx = (parsed: Record<string, unknown>): Record<string, unknown> => {
  return (parsed["edmx:Edmx"] ?? parsed["Edmx"] ?? parsed["edmx:edmx"] ?? parsed) as Record<string, unknown>;
};

const findDataServices = (edmx: Record<string, unknown>): Record<string, unknown> => {
  return (edmx["edmx:DataServices"] ?? edmx["DataServices"] ?? edmx) as Record<string, unknown>;
};

const toCsPropertyName = (name: string): string => name.slice(0, 1).toUpperCase() + name.slice(1);

const assertSupportedPropertyType = (property: PrincipalComplexTypeProperty): void => {
  if (property.type !== "Edm.String") {
    throw new Error(
      `Unsupported principal property type '${property.type}' for '${property.name}'. Update the template generator.`
    );
  }
};

export const parsePrincipalComplexTypeSnapshot = (
  xml: string,
  generatedAt = new Date().toISOString(),
  sourceUrl = PRINCIPAL_METADATA_URL
): PrincipalComplexTypeSnapshot => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const edmx = findEdmx(parsed);
  const dataServices = findDataServices(edmx);
  const schemas = toArray(
    pick(dataServices, ["Schema", "edm:Schema", "Edm:Schema"])
  ) as Array<Record<string, unknown>>;

  const schema = schemas.find(
    (entry) => (entry["@_Namespace"] ?? entry["@_namespace"]) === PRINCIPAL_NAMESPACE
  );
  if (!schema) {
    throw new Error(`Could not find '${PRINCIPAL_NAMESPACE}' schema in Graph metadata.`);
  }

  const complexTypes = toArray(schema.ComplexType ?? schema["edm:ComplexType"]) as Array<Record<string, unknown>>;
  const principal = complexTypes.find(
    (entry) => (entry["@_Name"] ?? entry["@_name"]) === PRINCIPAL_COMPLEX_TYPE_NAME
  );
  if (!principal) {
    throw new Error(
      `Could not find complex type '${PRINCIPAL_NAMESPACE}.${PRINCIPAL_COMPLEX_TYPE_NAME}' in Graph metadata.`
    );
  }

  const properties = toArray(principal.Property).map((property) => {
    const prop = property as Record<string, unknown>;
    const type = String(prop["@_Type"] ?? prop["@_type"] ?? "Edm.String");
    const nullableRaw = prop["@_Nullable"] ?? prop["@_nullable"];
    return {
      name: String(prop["@_Name"] ?? prop["@_name"] ?? ""),
      type,
      nullable: nullableRaw === undefined ? true : String(nullableRaw) !== "false",
    } satisfies PrincipalComplexTypeProperty;
  }).filter((property) => property.name);

  for (const property of properties) {
    assertSupportedPropertyType(property);
  }

  return {
    generatedAt,
    graphVersion: "v1.0",
    sourceUrl,
    namespace: PRINCIPAL_NAMESPACE,
    name: PRINCIPAL_COMPLEX_TYPE_NAME,
    fullName: `${PRINCIPAL_NAMESPACE}.${PRINCIPAL_COMPLEX_TYPE_NAME}`,
    properties,
  };
};

const renderDotnetPrincipalTemplate = (snapshot: PrincipalComplexTypeSnapshot): string => {
  const deserializers = snapshot.properties.map(
    (property) => `            { ${JSON.stringify(property.name)}, n => ${toCsPropertyName(property.name)} = n.GetStringValue() },`
  );
  const propertyLines = snapshot.properties.flatMap((property) => [
    `    [JsonPropertyName(${JSON.stringify(property.name)})]`,
    `    public string? ${toCsPropertyName(property.name)} { get; set; }`,
  ]);
  const serializeLines = snapshot.properties.map(
    (property) => `        writer.WriteStringValue(${JSON.stringify(property.name)}, ${toCsPropertyName(property.name)});`
  );

  return [
    "using System;",
    "using System.Collections.Generic;",
    "using System.Text.Json.Serialization;",
    "using Microsoft.Kiota.Abstractions.Serialization;",
    "",
    "namespace <%= namespaceName %>.Core;",
    "",
    "public sealed class Principal : IAdditionalDataHolder, IParsable",
    "{",
    '    [JsonPropertyName("@odata.type")]',
    '    public string? OdataType { get; set; } = "#microsoft.graph.externalConnectors.principal";',
    ...propertyLines,
    "    public IDictionary<string, object> AdditionalData { get; set; } = new Dictionary<string, object>();",
    "",
    "    public static Principal CreateFromDiscriminatorValue(IParseNode parseNode) => new();",
    "",
    "    public IDictionary<string, Action<IParseNode>> GetFieldDeserializers()",
    "    {",
    "        return new Dictionary<string, Action<IParseNode>>(StringComparer.OrdinalIgnoreCase)",
    "        {",
    '            { "@odata.type", n => OdataType = n.GetStringValue() },',
    ...deserializers,
    "        };",
    "    }",
    "",
    "    public void Serialize(ISerializationWriter writer)",
    "    {",
    '        writer.WriteStringValue("@odata.type", OdataType);',
    ...serializeLines,
    "        writer.WriteAdditionalData(AdditionalData);",
    "    }",
    "}",
    "",
  ].join("\n");
};

const renderTsPrincipalTemplate = (snapshot: PrincipalComplexTypeSnapshot): string => {
  const propertyLines = snapshot.properties.map((property) => `  ${property.name}?: string;`);

  return [
    "/**",
    " * Principal representation for external connector schema properties.",
    " */",
    "export type Principal = {",
    '  "@odata.type": "#microsoft.graph.externalConnectors.principal";',
    ...propertyLines,
    "  [key: string]: string | undefined;",
    "};",
    "",
    "export const cleanPrincipal = (",
    "  value: Record<string, unknown> | null | undefined",
    "): Record<string, unknown> | null | undefined => {",
    "  if (!value) return value;",
    "  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined));",
    "};",
    "",
    "export const cleanPrincipalCollection = (",
    "  values: Array<Record<string, unknown>> | null | undefined",
    "): Array<Record<string, unknown>> | null | undefined => {",
    "  if (!values) return values;",
    "  return values",
    "    .filter((value): value is Record<string, unknown> => Boolean(value))",
    "    .map((value) => cleanPrincipal(value) ?? value);",
    "};",
    "",
  ].join("\n");
};

const readJson = async <T>(filePath: string): Promise<T> => JSON.parse(await readFile(filePath, "utf8")) as T;

const writeIfChanged = async (filePath: string, content: string): Promise<void> => {
  let current: string | undefined;
  try {
    current = await readFile(filePath, "utf8");
  } catch {
    current = undefined;
  }
  if (current === content) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
};

export const writePrincipalSnapshot = async (
  snapshot: PrincipalComplexTypeSnapshot,
  cwd = process.cwd()
): Promise<string> => {
  const outPath = path.join(cwd, "data", "graph-external-connectors-principal.json");
  await writeIfChanged(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  return outPath;
};

export const writePrincipalTemplates = async (
  snapshot: PrincipalComplexTypeSnapshot,
  cwd = process.cwd()
): Promise<void> => {
  await writeIfChanged(
    path.join(cwd, "src", "init", "templates", "dotnet", "Core", "Principal.cs.ejs"),
    renderDotnetPrincipalTemplate(snapshot)
  );
  await writeIfChanged(
    path.join(cwd, "src", "init", "templates", "ts", "src", "core", "principal.ts.ejs"),
    renderTsPrincipalTemplate(snapshot)
  );
};

export const fetchPrincipalSnapshot = async (): Promise<PrincipalComplexTypeSnapshot> => {
  const response = await fetch(PRINCIPAL_METADATA_URL, {
    headers: {
      Accept: "application/xml",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download Graph metadata: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  return parsePrincipalComplexTypeSnapshot(xml);
};

export const syncPrincipalTemplates = async (cwd = process.cwd()): Promise<PrincipalComplexTypeSnapshot> => {
  const snapshotPath = path.join(cwd, "data", "graph-external-connectors-principal.json");
  let snapshot: PrincipalComplexTypeSnapshot;

  try {
    snapshot = await fetchPrincipalSnapshot();
    await writePrincipalSnapshot(snapshot, cwd);
  } catch (error) {
    try {
      snapshot = await readJson<PrincipalComplexTypeSnapshot>(snapshotPath);
      console.warn(
        `Falling back to cached principal metadata at data/graph-external-connectors-principal.json: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } catch {
      throw error;
    }
  }

  await writePrincipalTemplates(snapshot, cwd);
  return snapshot;
};

export const main = async (): Promise<void> => {
  const snapshot = await syncPrincipalTemplates();
  console.log(
    `Synced ${snapshot.fullName} templates from ${snapshot.graphVersion} metadata with ${snapshot.properties.length} properties.`
  );
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}