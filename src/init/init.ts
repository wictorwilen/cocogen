import { readFileSync } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ConnectorIr, PropertyType } from "../ir.js";
import { loadIrFromTypeSpec } from "../tsp/loader.js";
import { validateIr } from "../validate/validator.js";
import { renderTemplate } from "./template.js";

export type InitOptions = {
  tspPath: string;
  outDir: string;
  projectName?: string;
  force?: boolean;
  usePreviewFeatures?: boolean;
};

export type UpdateOptions = {
  outDir: string;
  tspPath?: string;
  usePreviewFeatures?: boolean;
};

type CocogenProjectConfig = {
  lang: "ts" | "dotnet";
  tsp: string;
  cocogenVersion?: string;
};

const COCOGEN_CONFIG_FILE = "cocogen.json";

function toTsType(type: PropertyType): string {
  switch (type) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "int64":
    case "double":
      return "number";
    case "dateTime":
      return "string";
    case "stringCollection":
      return "string[]";
    case "int64Collection":
    case "doubleCollection":
      return "number[]";
    case "dateTimeCollection":
      return "string[]";
    case "principal":
      return "string";
    default:
      return "unknown";
  }
}

function toCsType(type: PropertyType): string {
  switch (type) {
    case "string":
    case "principal":
      return "string";
    case "boolean":
      return "bool";
    case "int64":
      return "long";
    case "double":
      return "double";
    case "dateTime":
      return "DateTimeOffset";
    case "stringCollection":
      return "List<string>";
    case "int64Collection":
      return "List<long>";
    case "doubleCollection":
      return "List<double>";
    case "dateTimeCollection":
      return "List<DateTimeOffset>";
    default:
      return "object";
  }
}

function toCsIdentifier(name: string): string {
  const parts = name.split(/[_\-\s]+/g).filter(Boolean);
  const pascal = parts.map((p) => p.slice(0, 1).toUpperCase() + p.slice(1)).join("");
  return pascal || "Item";
}

function toTsIdentifier(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/g).filter(Boolean);
  if (parts.length === 0) return "Item";

  const pascal = parts.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join("");
  const sanitized = pascal.replaceAll(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function toCsNamespace(projectName: string): string {
  const cleaned = projectName
    .replaceAll(/[^A-Za-z0-9_\.\-\s]/g, "")
    .replaceAll(/[\-\s]+/g, "_")
    .replaceAll(/\.+/g, ".")
    .trim();

  const parts = cleaned.split(".").filter(Boolean).map(toCsIdentifier);
  return parts.length > 0 ? parts.join(".") : "Connector";
}

async function ensureEmptyDir(outDir: string, force: boolean): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const entries = await readdir(outDir);
  if (entries.length > 0 && !force) {
    throw new Error(
      `Output directory is not empty: ${outDir}. Use an empty folder or pass --force to overwrite.`
    );
  }
}

function graphBaseUrl(ir: ConnectorIr): string {
  return `https://graph.microsoft.com/${ir.connection.graphApiVersion}`;
}

function schemaPayload(ir: ConnectorIr): unknown {
  return {
    baseType: "microsoft.graph.externalItem",
    properties: ir.properties
      .filter((p) => p.name !== ir.item.contentPropertyName)
      .map((p) => ({
        name: p.name,
        type: p.type,
        labels: p.labels.length > 0 ? p.labels : undefined,
        aliases: p.aliases.length > 0 ? p.aliases : undefined,
        description: p.description,
        isSearchable: p.search.searchable ?? undefined,
        isQueryable: p.search.queryable ?? undefined,
        isRetrievable: p.search.retrievable ?? undefined,
        isRefinable: p.search.refinable ?? undefined,
        isExactMatchRequired: p.search.exactMatchRequired ?? undefined,
      })),
  };
}

function getGeneratorVersion(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(dir, "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // Ignore version lookup errors.
  }
  return "0.0.0";
}

function projectConfigContents(outDir: string, tspPath: string, lang: CocogenProjectConfig["lang"]): string {
  const rel = path.relative(outDir, path.resolve(tspPath)).replaceAll(path.sep, "/");
  const config: CocogenProjectConfig = {
    lang,
    tsp: rel || "./schema.tsp",
    cocogenVersion: getGeneratorVersion(),
  };
  return JSON.stringify(config, null, 2) + "\n";
}

async function loadProjectConfig(outDir: string): Promise<{ config: CocogenProjectConfig }> {
  const tryRead = async (fileName: string): Promise<string | undefined> => {
    try {
      return await readFile(path.join(outDir, fileName), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw error;
    }
  };

  const raw = await tryRead(COCOGEN_CONFIG_FILE);

  if (!raw) {
    throw new Error(`Missing ${COCOGEN_CONFIG_FILE}. Re-run cocogen init or fix the file.`);
  }

  const parsed = JSON.parse(raw) as Partial<CocogenProjectConfig>;
  if ((parsed.lang !== "ts" && parsed.lang !== "dotnet") || typeof parsed.tsp !== "string") {
    throw new Error(`Invalid ${COCOGEN_CONFIG_FILE}. Re-run cocogen init or fix the file.`);
  }
  return { config: { lang: parsed.lang, tsp: parsed.tsp, cocogenVersion: parsed.cocogenVersion } };
}

async function writeGeneratedTs(outDir: string, ir: ConnectorIr): Promise<void> {
  await mkdir(path.join(outDir, "src", "schema"), { recursive: true });
  await mkdir(path.join(outDir, "src", "core"), { recursive: true });

  const modelProperties = ir.properties.map((p) => ({
    name: p.name,
    tsType: toTsType(p.type),
  }));

  const transformProperties = ir.properties.map((p) => {
    const parser = (() => {
      switch (p.type) {
        case "stringCollection":
          return "parseStringCollection";
        case "int64Collection":
        case "doubleCollection":
          return "parseNumberCollection";
        case "dateTimeCollection":
          return "parseStringCollection";
        case "boolean":
          return "parseBoolean";
        case "int64":
        case "double":
          return "parseNumber";
        case "principal":
        case "dateTime":
        case "string":
        default:
          return "parseString";
      }
    })();

    const personEntity = p.personEntity
      ? (p.type === "stringCollection"
          ? buildTsPersonEntityCollectionExpression(
              p.personEntity.fields.map((field) => ({
                path: field.path,
                source: field.source,
              }))
            )
          : buildTsPersonEntityExpression(
              p.personEntity.fields.map((field) => ({
                path: field.path,
                source: field.source,
              }))
            ))
      : null;

    const isPeopleLabel = p.labels.some((label) => label.startsWith("person"));
    const needsManualEntity = isPeopleLabel && !p.personEntity;
    const expression = needsManualEntity
      ? `(() => { throw new Error("Missing @coco.source(..., to) mappings for people entity '${p.name}'. Implement transform in propertyTransform.ts."); })()`
      : personEntity
      ? personEntity
      : `${parser}(readSourceValue(row, ${JSON.stringify(p.source.csvHeaders)}))`;

    return {
      name: p.name,
      parser,
      expression,
      isCollection: p.type === "stringCollection",
      transformName: toTsIdentifier(p.name),
      tsType: toTsType(p.type),
    };
  });

  await writeFile(
    path.join(outDir, "src", "schema", "model.ts"),
    await renderTemplate("ts/src/generated/model.ts.ejs", {
      itemTypeName: ir.item.typeName,
      properties: modelProperties,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", "schema", "constants.ts"),
    await renderTemplate("ts/src/generated/constants.ts.ejs", {
      graphApiVersion: ir.connection.graphApiVersion,
      contentCategory: ir.connection.contentCategory ?? null,
      connectionId: ir.connection.connectionId ?? null,
      connectionDescription: ir.connection.connectionDescription ?? null,
      profileSourceWebUrl: ir.connection.profileSource?.webUrl ?? null,
      profileSourceDisplayName: ir.connection.profileSource?.displayName ?? null,
      profileSourcePriority: ir.connection.profileSource?.priority ?? null,
      itemTypeName: ir.item.typeName,
      idPropertyName: ir.item.idPropertyName,
      contentPropertyName: ir.item.contentPropertyName ?? null,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", "schema", "schemaPayload.ts"),
    await renderTemplate("ts/src/generated/schemaPayload.ts.ejs", {
      schemaPayloadJson: JSON.stringify(schemaPayload(ir), null, 2),
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", "datasource", "csv.ts"),
    await renderTemplate("ts/src/generated/csv.ts.ejs", {}),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", "schema", "propertyTransformBase.ts"),
    await renderTemplate("ts/src/generated/propertyTransformBase.ts.ejs", {
      properties: transformProperties,
    }),
    "utf8"
  );

  const transformOverridesPath = path.join(outDir, "src", "schema", "propertyTransform.ts");
  try {
    await access(transformOverridesPath);
  } catch {
    await writeFile(
      transformOverridesPath,
      await renderTemplate("ts/src/propertyTransform.ts.ejs", {}),
      "utf8"
    );
  }

  await writeFile(
    path.join(outDir, "src", "schema", "fromCsvRow.ts"),
    await renderTemplate("ts/src/generated/fromCsvRow.ts.ejs", {
      properties: transformProperties,
      itemTypeName: ir.item.typeName,
    }),
    "utf8"
  );

  const propertiesObjectLines = ir.properties
    .filter((p) => p.name !== ir.item.contentPropertyName)
    .flatMap((p) => {
      const lines: string[] = [];
      const odataType = toOdataCollectionType(p.type);
      if (odataType) {
        lines.push(`      ${JSON.stringify(`${p.name}@odata.type`)}: ${JSON.stringify(odataType)},`);
      }
      lines.push(`      ${JSON.stringify(p.name)}: item.${p.name},`);
      return lines;
    })
    .join("\n");
  const contentBlock = ir.item.contentPropertyName
    ? `,\n    content: {\n      type: \"text\",\n      value: String((item as any)[contentPropertyName ?? \"\"] ?? \"\"),\n    }`
    : "";

  await writeFile(
    path.join(outDir, "src", "schema", "itemPayload.ts"),
    await renderTemplate("ts/src/generated/itemPayload.ts.ejs", {
      propertiesObjectLines,
      contentBlock,
      itemTypeName: ir.item.typeName,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", "schema", "index.ts"),
    await renderTemplate("ts/src/generated/index.ts.ejs", {}),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", "core", "connectorCore.ts"),
    await renderTemplate("ts/src/core/connectorCore.ts.ejs", {
      itemTypeName: ir.item.typeName,
      isPeopleConnector: ir.connection.contentCategory === "people",
    }),
    "utf8"
  );
}

function toGraphPropertyTypeEnumName(type: PropertyType): string {
  switch (type) {
    case "string":
      return "String";
    case "boolean":
      return "Boolean";
    case "int64":
      return "Int64";
    case "double":
      return "Double";
    case "dateTime":
      return "DateTime";
    case "stringCollection":
      return "StringCollection";
    case "int64Collection":
      return "Int64Collection";
    case "doubleCollection":
      return "DoubleCollection";
    case "dateTimeCollection":
      return "DateTimeCollection";
    case "principal":
      return "Principal";
    default:
      return "String";
  }
}

function toOdataCollectionType(type: PropertyType): string | null {
  switch (type) {
    case "stringCollection":
      return "Collection(String)";
    case "int64Collection":
      return "Collection(Int64)";
    case "doubleCollection":
      return "Collection(Double)";
    case "dateTimeCollection":
      return "Collection(DateTimeOffset)";
    default:
      return null;
  }
}

function toCsParseFunction(type: PropertyType): string {
  switch (type) {
    case "stringCollection":
      return "CsvParser.ParseStringCollection";
    case "int64Collection":
      return "CsvParser.ParseInt64Collection";
    case "doubleCollection":
      return "CsvParser.ParseDoubleCollection";
    case "dateTimeCollection":
      return "CsvParser.ParseDateTimeCollection";
    case "boolean":
      return "CsvParser.ParseBoolean";
    case "int64":
      return "CsvParser.ParseInt64";
    case "double":
      return "CsvParser.ParseDouble";
    case "dateTime":
      return "CsvParser.ParseDateTime";
    case "principal":
    case "string":
    default:
      return "CsvParser.ParseString";
  }
}

function toCsPropertyValueExpression(type: PropertyType, csPropertyName: string): string {
  switch (type) {
    case "dateTime":
      return `item.${csPropertyName}.ToString("o")`;
    case "dateTimeCollection":
      return `item.${csPropertyName}.Select((x) => x.ToString("o")).ToList()`;
    default:
      return `item.${csPropertyName}`;
  }
}

type PersonEntityField = {
  path: string;
  source: { csvHeaders: string[] };
};

function buildObjectTree(fields: PersonEntityField[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const field of fields) {
    const parts = field.path.split(".").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i]!;
      if (i === parts.length - 1) {
        cursor[key] = field;
        continue;
      }
      const next = cursor[key];
      if (typeof next === "object" && next && !Array.isArray(next) && !("path" in (next as object))) {
        cursor = next as Record<string, unknown>;
      } else {
        const child: Record<string, unknown> = {};
        cursor[key] = child;
        cursor = child;
      }
    }
  }

  return root;
}

function buildTsPersonEntityExpression(fields: PersonEntityField[]): string {
  const tree = buildObjectTree(fields);
  const indentUnit = "  ";

  const renderNode = (node: Record<string, unknown>, level: number): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const headers = JSON.stringify(field.source.csvHeaders);
        return `${childIndent}${JSON.stringify(key)}: parseString(readSourceValue(row, ${headers}))`;
      }
      return `${childIndent}${JSON.stringify(key)}: ${renderNode(value as Record<string, unknown>, level + 1)}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  const rendered = renderNode(tree, 2);
  return `JSON.stringify(\n${indentUnit.repeat(2)}${rendered}\n${indentUnit.repeat(2)})`;
}

function buildTsPersonEntityCollectionExpression(fields: PersonEntityField[]): string {
  const indentUnit = "  ";
  const renderNode = (node: Record<string, unknown>, level: number, valueVar: string): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        return `${childIndent}${JSON.stringify(key)}: ${valueVar}`;
      }
      return `${childIndent}${JSON.stringify(key)}: ${renderNode(value as Record<string, unknown>, level + 1, valueVar)}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  if (fields.length === 1) {
    const tree = buildObjectTree(fields);
    const field = fields[0]!;
    const headers = JSON.stringify(field.source.csvHeaders);
    const rendered = renderNode(tree, 2, "value");

    return `parseStringCollection(readSourceValue(row, ${headers}))
  .map((value) => JSON.stringify(\n${indentUnit.repeat(2)}${rendered}\n${indentUnit.repeat(2)}))`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const headers = JSON.stringify(field.source.csvHeaders);
    return `  const ${varName} = parseStringCollection(readSourceValue(row, ${headers}));`;
  });

  const renderNodeMany = (node: Record<string, unknown>): string => {
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        return `${indentUnit.repeat(2)}${JSON.stringify(key)}: getValue(${varName}, index)`;
      }
      return `${indentUnit.repeat(2)}${JSON.stringify(key)}: ${renderNodeMany(value as Record<string, unknown>)}`;
    });
    return `{
${entries.join(",\n")}
${indentUnit}}`;
  };

  const fieldVars = [...fieldVarByPath.values()].join(", ");
  const lengthVars = fieldVars
    ? `const lengths = [${fieldVars}].map((value) => value.length);`
    : "const lengths = [0];";

  return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n  const maxLen = Math.max(0, ...lengths);\n  const getValue = (values: string[], index: number): string => {\n    if (values.length === 0) return \"\";\n    if (values.length === 1) return values[0] ?? \"\";\n    return values[index] ?? \"\";\n  };\n  const results: string[] = [];\n  for (let index = 0; index < maxLen; index++) {\n    results.push(JSON.stringify(\n      ${renderNodeMany(tree)}\n    ));\n  }\n  return results;\n})()`;
}

function buildCsPersonEntityExpression(fields: PersonEntityField[]): string {
  const tree = buildObjectTree(fields);
  const indentUnit = "    ";

  const renderNode = (node: Record<string, unknown>, level: number): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const headers = `new[] { ${field.source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
        return `${childIndent}[${JSON.stringify(key)}] = CsvParser.ParseString(row, ${headers})`;
      }
      return `${childIndent}[${JSON.stringify(key)}] = ${renderNode(value as Record<string, unknown>, level + 1)}`;
    });

    return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
  };

  const rendered = renderNode(tree, 2);
  return `JsonSerializer.Serialize(\n${indentUnit.repeat(2)}${rendered}\n${indentUnit.repeat(2)})`;
}

function buildCsPersonEntityCollectionExpression(fields: PersonEntityField[]): string {
  const indentUnit = "    ";
  const renderNode = (node: Record<string, unknown>, level: number, valueVar: string): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        return `${childIndent}[${JSON.stringify(key)}] = ${valueVar}`;
      }
      return `${childIndent}[${JSON.stringify(key)}] = ${renderNode(value as Record<string, unknown>, level + 1, valueVar)}`;
    });

    return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
  };

  if (fields.length === 1) {
    const tree = buildObjectTree(fields);
    const field = fields[0]!;
    const headers = `new[] { ${field.source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
    const rendered = renderNode(tree, 3, "value");

    return `CsvParser.ParseStringCollection(row, ${headers})
            .Select(value => JsonSerializer.Serialize(\n${indentUnit.repeat(3)}${rendered}\n${indentUnit.repeat(3)}))
            .ToList()`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const headers = `new[] { ${field.source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
    return `        var ${varName} = CsvParser.ParseStringCollection(row, ${headers});`;
  });

  const renderNodeMany = (node: Record<string, unknown>): string => {
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        return `${indentUnit.repeat(3)}[${JSON.stringify(key)}] = GetValue(${varName}, index)`;
      }
      return `${indentUnit.repeat(3)}[${JSON.stringify(key)}] = ${renderNodeMany(value as Record<string, unknown>)}`;
    });

    return `new Dictionary<string, object?>\n${indentUnit.repeat(2)}{\n${entries.join(",\n")}\n${indentUnit.repeat(2)}}`;
  };

  const fieldVars = [...fieldVarByPath.values()];
  const lengthLines = fieldVars.length > 0
    ? `        var maxLen = new[] { ${fieldVars.map((v) => `${v}.Count`).join(", ")} }.Max();`
    : "        var maxLen = 0;";

  return `new Func<List<string>>(() =>\n    {\n${fieldLines.join("\n")}\n        string GetValue(List<string> values, int index)\n        {\n            if (values.Count == 0) return \"\";\n            if (values.Count == 1) return values[0] ?? \"\";\n            return index < values.Count ? (values[index] ?? \"\") : \"\";\n        }\n${lengthLines}\n        var results = new List<string>();\n        for (var index = 0; index < maxLen; index++)\n        {\n            results.Add(JsonSerializer.Serialize(${renderNodeMany(tree)}));\n        }\n        return results;\n    }).Invoke()`;
}

function csvEscape(value: string): string {
  if (value.includes("\n") || value.includes("\r") || value.includes(",") || value.includes("\"")) {
    return `"${value.replaceAll("\"", '""')}"`;
  }
  return value;
}

function sampleValueForType(type: PropertyType): string {
  switch (type) {
    case "boolean":
      return "true";
    case "int64":
      return "123";
    case "double":
      return "1.23";
    case "dateTime":
      return "2024-01-01T00:00:00Z";
    case "stringCollection":
      return "alpha;beta";
    case "int64Collection":
      return "1;2";
    case "doubleCollection":
      return "1.1;2.2";
    case "dateTimeCollection":
      return "2024-01-01T00:00:00Z;2024-01-02T00:00:00Z";
    case "principal":
      return 'alice@contoso.com';
    case "string":
    default:
      return "sample";
  }
}

function sampleValueForHeader(header: string, type?: PropertyType): string {
  const lower = header.toLowerCase();
  if (lower.includes("job title")) return "Software Engineer";
  if (lower.includes("company")) return "Contoso";
  if (lower.includes("employee")) return "E123";
  if (lower.includes("upn") || lower.includes("userprincipal")) return "user@contoso.com";
  if (lower.includes("email")) return "user@contoso.com";
  if (lower.includes("phone")) return "+1 555 0100";
  if (lower.includes("name")) return "Ada Lovelace";
  if (lower.includes("skill")) return "TypeScript;Python";
  if (lower.includes("proficiency")) return "advancedProfessional;expert";
  if (lower.includes("address")) return "1 Main St";
  if (lower.includes("city")) return "Seattle";
  if (lower.includes("country")) return "US";
  if (lower.includes("note") || lower.includes("bio")) return "Sample profile note";
  return type ? sampleValueForType(type) : "sample";
}

function buildSampleCsv(ir: ConnectorIr): string {
  const headers: string[] = [];
  const seen = new Set<string>();
  const addHeader = (header: string): void => {
    if (seen.has(header)) return;
    seen.add(header);
    headers.push(header);
  };

  for (const prop of ir.properties) {
    if (prop.personEntity) {
      for (const field of prop.personEntity.fields) {
        for (const header of field.source.csvHeaders) addHeader(header);
      }
      continue;
    }

    for (const header of prop.source.csvHeaders) addHeader(header);
  }

  const valueByHeader = new Map<string, string>();
  for (const prop of ir.properties) {
    if (prop.personEntity) {
      for (const field of prop.personEntity.fields) {
        for (const header of field.source.csvHeaders) {
          if (!valueByHeader.has(header)) valueByHeader.set(header, sampleValueForHeader(header));
        }
      }
      continue;
    }

    for (const header of prop.source.csvHeaders) {
      if (!valueByHeader.has(header)) valueByHeader.set(header, sampleValueForHeader(header, prop.type));
    }
  }

  const headerLine = headers.map(csvEscape).join(",");
  const valueLine = headers.map((h) => csvEscape(valueByHeader.get(h) ?? "sample")).join(",");
  return `${headerLine}\n${valueLine}\n`;
}

async function writeGeneratedDotnet(outDir: string, ir: ConnectorIr, namespaceName: string): Promise<void> {
  await mkdir(path.join(outDir, "Schema"), { recursive: true });
  await mkdir(path.join(outDir, "Core"), { recursive: true });

  const properties = ir.properties.map((p) => {
    const parseFn = toCsParseFunction(p.type);
    const csvHeadersLiteral = `new[] { ${p.source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
    const isCollection = p.type === "stringCollection";
    const personEntity = p.personEntity
      ? {
          entity: p.personEntity.entity,
          fields: p.personEntity.fields.map((field) => ({
            path: field.path,
            source: field.source,
          })),
        }
      : null;
    const isPeopleLabel = p.labels.some((label) => label.startsWith("person"));
    const needsManualEntity = isPeopleLabel && !p.personEntity;
    const transformExpression = needsManualEntity
      ? `throw new NotImplementedException("Missing @coco.source(..., to) mappings for people entity '${p.name}'. Implement in PropertyTransform.cs.")`
      : personEntity
      ? isCollection
        ? buildCsPersonEntityCollectionExpression(personEntity.fields)
        : buildCsPersonEntityExpression(personEntity.fields)
      : `${parseFn}(row, ${csvHeadersLiteral})`;

    return {
      name: p.name,
      csName: toCsIdentifier(p.name),
      csType: toCsType(p.type),
      csvHeaders: p.source.csvHeaders,
      csvHeadersLiteral,
      isCollection,
      personEntity,
      parseFn,
      transformExpression,
      transformThrows: needsManualEntity,
      graphTypeEnumName: toGraphPropertyTypeEnumName(p.type),
      description: p.description,
      labels: p.labels,
      aliases: p.aliases,
      search: p.search,
      type: p.type,
    };
  });

  const schemaPropertyLines = properties
    .filter((p) => p.name !== ir.item.contentPropertyName)
    .map((p) => {
      const labels =
        p.labels.length > 0
          ? `new List<string> { ${p.labels.map((l) => JSON.stringify(l)).join(", ")} }`
          : null;
      const aliases =
        p.aliases.length > 0
          ? `new List<string> { ${p.aliases.map((a) => JSON.stringify(a)).join(", ")} }`
          : "null";

      const additionalDataEntries: string[] = [];
      if (p.description) additionalDataEntries.push(`                        ["description"] = ${JSON.stringify(p.description)},`);
      if (labels) additionalDataEntries.push(`                        ["labels"] = ${labels},`);

      const additionalDataBlock =
        additionalDataEntries.length > 0
          ? [
              "                    AdditionalData = new Dictionary<string, object>",
              "                    {",
              ...additionalDataEntries,
              "                    },",
            ]
          : [];

      const lines: string[] = [
        "                new Property",
        "                {",
        `                    Name = ${JSON.stringify(p.name)},`,
        `                    Type = PropertyType.${p.graphTypeEnumName},`,
      ];

      if (p.search.searchable !== undefined) lines.push(`                    IsSearchable = ${p.search.searchable ? "true" : "false"},`);
      if (p.search.queryable !== undefined) lines.push(`                    IsQueryable = ${p.search.queryable ? "true" : "false"},`);
      if (p.search.retrievable !== undefined) lines.push(`                    IsRetrievable = ${p.search.retrievable ? "true" : "false"},`);
      if (p.search.refinable !== undefined) lines.push(`                    IsRefinable = ${p.search.refinable ? "true" : "false"},`);
      if (p.search.exactMatchRequired !== undefined)
        lines.push(`                    IsExactMatchRequired = ${p.search.exactMatchRequired ? "true" : "false"},`);
      if (aliases !== "null") lines.push(`                    Aliases = ${aliases},`);
      lines.push(...additionalDataBlock);

      lines.push("                },");
      return lines.join("\n");
    })
    .join("\n");

  const constructorArgLines = properties
    .map((p, index) => {
      const comma = index < properties.length - 1 ? "," : "";
      return `            (${p.csType})transforms.TransformProperty(${JSON.stringify(p.name)}, row)${comma}`;
    })
    .join("\n");

  const propertiesObjectLines = properties
    .filter((p) => p.name !== ir.item.contentPropertyName)
    .flatMap((p) => {
      const lines: string[] = [];
      const odataType = toOdataCollectionType(p.type);
      if (odataType) {
        lines.push(`                { ${JSON.stringify(`${p.name}@odata.type`)}, ${JSON.stringify(odataType)} },`);
      }
      lines.push(`                { ${JSON.stringify(p.name)}, ${toCsPropertyValueExpression(p.type, p.csName)} },`);
      return lines;
    })
    .join("\n");

  const itemIdProperty = properties.find((p) => p.name === ir.item.idPropertyName);
  const itemIdExpression = itemIdProperty ? `Convert.ToString(item.${itemIdProperty.csName}) ?? ""` : "\"\"";

  const contentBlock = ir.item.contentPropertyName
    ? [
        "        externalItem.Content = new ExternalItemContent",
        "        {",
        "            Type = ExternalItemContentType.Text,",
        `            Value = Convert.ToString(item.${toCsIdentifier(ir.item.contentPropertyName)}) ?? string.Empty,`,
        "        };",
      ].join("\n")
    : "";

  await writeFile(
    path.join(outDir, "Schema", "Model.cs"),
    await renderTemplate("dotnet/Generated/Model.cs.ejs", {
      namespaceName,
      itemTypeName: ir.item.typeName,
      properties: properties.map((p) => ({ csName: p.csName, csType: p.csType })),
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Schema", "Constants.cs"),
    await renderTemplate("dotnet/Generated/Constants.cs.ejs", {
      namespaceName,
      graphApiVersion: ir.connection.graphApiVersion,
      contentCategory: ir.connection.contentCategory ?? null,
      profileSourceWebUrl: ir.connection.profileSource?.webUrl ?? null,
      profileSourceDisplayName: ir.connection.profileSource?.displayName ?? null,
      profileSourcePriority: ir.connection.profileSource?.priority ?? null,
      itemTypeName: ir.item.typeName,
      idPropertyName: ir.item.idPropertyName,
      contentPropertyName: ir.item.contentPropertyName ?? null,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Schema", "SchemaPayload.cs"),
    await renderTemplate("dotnet/Generated/SchemaPayload.cs.ejs", {
      namespaceName,
      schemaPropertyLines,
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Datasource", "CsvParser.cs"),
    await renderTemplate("dotnet/Generated/CsvParser.cs.ejs", {
      namespaceName,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Schema", "PropertyTransformBase.cs"),
    await renderTemplate("dotnet/Generated/PropertyTransformBase.cs.ejs", {
      namespaceName,
      properties,
      usesPersonEntity: properties.some((p) => p.personEntity),
    }),
    "utf8"
  );

  const transformOverridesPath = path.join(outDir, "Schema", "PropertyTransform.cs");
  try {
    await access(transformOverridesPath);
  } catch {
    await writeFile(
      transformOverridesPath,
      await renderTemplate("dotnet/PropertyTransform.cs.ejs", {
        namespaceName,
      }),
      "utf8"
    );
  }

  await writeFile(
    path.join(outDir, "Schema", "FromCsvRow.cs"),
    await renderTemplate("dotnet/Generated/FromCsvRow.cs.ejs", {
      namespaceName,
      itemTypeName: ir.item.typeName,
      constructorArgLines,
    }),
    "utf8"
  );


  await writeFile(
    path.join(outDir, "Schema", "ItemPayload.cs"),
    await renderTemplate("dotnet/Generated/ItemPayload.cs.ejs", {
      namespaceName,
      itemTypeName: ir.item.typeName,
      itemIdExpression,
      propertiesObjectLines,
      contentBlock,
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Core", "ConnectorCore.cs"),
    await renderTemplate("dotnet/Core/ConnectorCore.cs.ejs", {
      namespaceName,
      itemTypeName: ir.item.typeName,
      isPeopleConnector: ir.connection.contentCategory === "people",
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );
}

function formatValidationErrors(ir: ConnectorIr): string {
  const issues = validateIr(ir);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length === 0) return "";

  return errors
    .map((e) => `- ${e.message}${e.hint ? `\n  hint: ${e.hint}` : ""}`)
    .join("\n");
}

export async function updateTsProject(options: UpdateOptions): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  const { config } = await loadProjectConfig(outDir);
  const tspPath = options.tspPath ? path.resolve(options.tspPath) : path.resolve(outDir, config.tsp);

  if (config.lang !== "ts") {
    throw new Error(`This project is '${config.lang}'. Use cocogen init/update for that language.`);
  }

  const ir = await loadIrFromTypeSpec(tspPath);
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  await writeGeneratedTs(outDir, ir);
  if (options.tspPath) {
    await writeFile(path.join(outDir, COCOGEN_CONFIG_FILE), projectConfigContents(outDir, tspPath, "ts"), "utf8");
  }

  return { outDir, ir };
}

export async function updateDotnetProject(
  options: UpdateOptions
): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  const { config } = await loadProjectConfig(outDir);
  const tspPath = options.tspPath ? path.resolve(options.tspPath) : path.resolve(outDir, config.tsp);

  if (config.lang !== "dotnet") {
    throw new Error(`This project is '${config.lang}'. Use cocogen init/update for that language.`);
  }

  const ir = await loadIrFromTypeSpec(tspPath);
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  const namespaceName = toCsNamespace(path.basename(outDir));
  await writeGeneratedDotnet(outDir, ir, namespaceName);
  if (options.tspPath) {
    await writeFile(path.join(outDir, COCOGEN_CONFIG_FILE), projectConfigContents(outDir, tspPath, "dotnet"), "utf8");
  }

  return { outDir, ir };
}

export async function updateProject(options: UpdateOptions): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  const { config } = await loadProjectConfig(outDir);
  if (config.lang === "dotnet") {
    return updateDotnetProject(options);
  }
  return updateTsProject(options);
}

export async function initTsProject(options: InitOptions): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  await ensureEmptyDir(outDir, Boolean(options.force));

  const ir = await loadIrFromTypeSpec(options.tspPath);
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  const projectName = options.projectName ?? path.basename(outDir);

  await mkdir(path.join(outDir, "src"), { recursive: true });
  await mkdir(path.join(outDir, "src", "datasource"), { recursive: true });
  await mkdir(path.join(outDir, "src", "schema"), { recursive: true });

  await writeFile(
    path.join(outDir, "package.json"),
    await renderTemplate("ts/package.json.ejs", {
      projectName,
      isPeopleConnector: ir.connection.contentCategory === "people",
    }),
    "utf8"
  );
  await writeFile(
    path.join(outDir, "tspconfig.yaml"),
    await renderTemplate("ts/tspconfig.yaml.ejs", {}),
    "utf8"
  );
  await writeFile(
    path.join(outDir, "tsconfig.json"),
    await renderTemplate("ts/tsconfig.json.ejs", {}),
    "utf8"
  );
  await writeFile(
    path.join(outDir, ".env.example"),
    await renderTemplate("ts/.env.example.ejs", {
      itemTypeName: ir.item.typeName,
      isPeopleConnector: ir.connection.contentCategory === "people",
      connectionId: ir.connection.connectionId ?? null,
      connectionDescription: ir.connection.connectionDescription ?? null,
      profileSourceWebUrl: ir.connection.profileSource?.webUrl ?? null,
      profileSourceDisplayName: ir.connection.profileSource?.displayName ?? null,
      profileSourcePriority: ir.connection.profileSource?.priority ?? null,
    }),
    "utf8"
  );
  await writeFile(
    path.join(outDir, "README.md"),
    await renderTemplate("ts/README.md.ejs", {
      isPeopleConnector: ir.connection.contentCategory === "people",
      itemTypeName: ir.item.typeName,
    }),
    "utf8"
  );
  const copiedTspPath = path.join(outDir, "schema.tsp");
  await copyFile(path.resolve(options.tspPath), copiedTspPath);
  await writeFile(path.join(outDir, COCOGEN_CONFIG_FILE), projectConfigContents(outDir, copiedTspPath, "ts"), "utf8");

  const propertiesObjectLines = ir.properties
    .flatMap((p) => {
      const lines: string[] = [];
      const odataType = toOdataCollectionType(p.type);
      if (odataType) {
        lines.push(`      ${JSON.stringify(`${p.name}@odata.type`)}: ${JSON.stringify(odataType)},`);
      }
      lines.push(`      ${JSON.stringify(p.name)}: item.${p.name},`);
      return lines;
    })
    .join("\n");
  const contentBlock = ir.item.contentPropertyName
    ? `,\n    content: {\n      type: \"text\",\n      value: String((item as any)[contentPropertyName ?? \"\"] ?? \"\"),\n    }`
    : "";

  await writeFile(
    path.join(outDir, "src", "cli.ts"),
    await renderTemplate("ts/src/cli.ts.ejs", {
      graphBaseUrl: graphBaseUrl(ir),
      isPeopleConnector: ir.connection.contentCategory === "people",
      itemTypeName: ir.item.typeName,
    }),
    "utf8"
  );
  await writeFile(
    path.join(outDir, "src", "datasource", "itemSource.ts"),
    await renderTemplate("ts/src/datasource/itemSource.ts.ejs", { itemTypeName: ir.item.typeName }),
    "utf8"
  );
  await writeFile(
    path.join(outDir, "src", "datasource", "csvItemSource.ts"),
    await renderTemplate("ts/src/datasource/csvItemSource.ts.ejs", { itemTypeName: ir.item.typeName }),
    "utf8"
  );

  await writeFile(path.join(outDir, "data.csv"), buildSampleCsv(ir), "utf8");

  await writeGeneratedTs(outDir, ir);

  await writeFile(
    path.join(outDir, "src", "index.ts"),
    await renderTemplate("ts/src/index.ts.ejs", {}),
    "utf8"
  );

  return { outDir, ir };
}

export async function initDotnetProject(
  options: InitOptions
): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  await ensureEmptyDir(outDir, Boolean(options.force));

  const ir = await loadIrFromTypeSpec(options.tspPath);
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  const projectName = options.projectName ?? path.basename(outDir);
  const namespaceName = toCsNamespace(projectName);

  await mkdir(path.join(outDir, "Datasource"), { recursive: true });
  await mkdir(path.join(outDir, "Schema"), { recursive: true });

  await writeFile(
    path.join(outDir, `${projectName}.csproj`),
    await renderTemplate("dotnet/project.csproj.ejs", {
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "package.json"),
    await renderTemplate("dotnet/package.json.ejs", {
      projectName,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "tspconfig.yaml"),
    await renderTemplate("dotnet/tspconfig.yaml.ejs", {}),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Program.cs"),
    await renderTemplate("dotnet/Program.commandline.cs.ejs", {
      namespaceName,
      itemTypeName: ir.item.typeName,
      isPeopleConnector: ir.connection.contentCategory === "people",
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Datasource", "IItemSource.cs"),
    await renderTemplate("dotnet/Datasource/IItemSource.cs.ejs", { namespaceName, itemTypeName: ir.item.typeName }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Datasource", "CsvItemSource.cs"),
    await renderTemplate("dotnet/Datasource/CsvItemSource.cs.ejs", { namespaceName, itemTypeName: ir.item.typeName }),
    "utf8"
  );

  await writeFile(path.join(outDir, "data.csv"), buildSampleCsv(ir), "utf8");

  await writeFile(
    path.join(outDir, "appsettings.json"),
    await renderTemplate("dotnet/appsettings.json.ejs", {
      itemTypeName: ir.item.typeName,
      isPeopleConnector: ir.connection.contentCategory === "people",
      connectionId: ir.connection.connectionId ?? null,
      connectionDescription: ir.connection.connectionDescription ?? null,
      profileSourceWebUrl: ir.connection.profileSource?.webUrl ?? null,
      profileSourceDisplayName: ir.connection.profileSource?.displayName ?? null,
      profileSourcePriority: ir.connection.profileSource?.priority ?? null,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, ".gitignore"),
    await renderTemplate("dotnet/.gitignore.ejs", {}),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "README.md"),
    await renderTemplate("dotnet/README.md.ejs", {
      isPeopleConnector: ir.connection.contentCategory === "people",
      itemTypeName: ir.item.typeName,
    }),
    "utf8"
  );

  const copiedTspPath = path.join(outDir, "schema.tsp");
  await copyFile(path.resolve(options.tspPath), copiedTspPath);
  await writeFile(path.join(outDir, COCOGEN_CONFIG_FILE), projectConfigContents(outDir, copiedTspPath, "dotnet"), "utf8");

  await writeGeneratedDotnet(outDir, ir, namespaceName);

  return { outDir, ir };
}
