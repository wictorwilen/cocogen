import { readFileSync } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
}

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
      return "Principal";
    case "principalCollection":
      return "Principal[]";
    default:
      return "unknown";
  }
}

function toCsType(type: PropertyType): string {
  switch (type) {
    case "string":
      return "string";
    case "principal":
      return "Principal";
    case "principalCollection":
      return "List<Principal>";
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

function toCsPropertyName(name: string, itemTypeName: string, used: Set<string>): string {
  const base = toCsIdentifier(name);
  const forbidden = itemTypeName.toLowerCase();
  let candidate = base.toLowerCase() === forbidden ? `${base}Value` : base;
  let suffix = 1;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function toTsIdentifier(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/g).filter(Boolean);
  if (parts.length === 0) return "Item";

  const pascal = parts.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join("");
  const sanitized = pascal.replaceAll(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function toSchemaFolderName(connectionName: string | undefined): string {
  const cleaned = (connectionName ?? "").trim();
  if (!cleaned) return "Schema";
  const candidate = toCsIdentifier(cleaned);
  return candidate || "Schema";
}

function toTsSchemaFolderName(connectionName: string | undefined): string {
  const cleaned = (connectionName ?? "").trim();
  if (!cleaned) return "schema";
  const candidate = toTsIdentifier(cleaned);
  return candidate || "schema";
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
    const candidates = [
      path.resolve(dir, "..", "package.json"),
      path.resolve(dir, "..", "..", "package.json"),
      path.resolve(dir, "..", "..", "..", "package.json"),
      path.resolve(process.cwd(), "package.json"),
    ];

    for (const pkgPath of candidates) {
      try {
        const raw = readFileSync(pkgPath, "utf8");
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        const name = parsed.name?.trim();
        if (name && name !== "@wictorwilen/cocogen" && name !== "cocogen") {
          continue;
        }
        if (parsed.version && parsed.version.trim().length > 0) {
          return parsed.version.trim();
        }
      } catch {
        continue;
      }
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
    throw new Error(`Missing ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`);
  }

  const parsed = JSON.parse(raw) as Partial<CocogenProjectConfig>;
  if ((parsed.lang !== "ts" && parsed.lang !== "dotnet") || typeof parsed.tsp !== "string") {
    throw new Error(`Invalid ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`);
  }
  return {
    config: {
      lang: parsed.lang,
      tsp: parsed.tsp,
      ...(parsed.cocogenVersion ? { cocogenVersion: parsed.cocogenVersion } : {}),
    },
  };
}

async function writeGeneratedTs(outDir: string, ir: ConnectorIr, schemaFolderName: string): Promise<void> {
  await mkdir(path.join(outDir, "src", "datasource"), { recursive: true });
  await mkdir(path.join(outDir, "src", schemaFolderName), { recursive: true });
  await mkdir(path.join(outDir, "src", "core"), { recursive: true });

  await removeIfExists(path.join(outDir, "src", schemaFolderName, "fromCsvRow.ts"));
  await removeIfExists(path.join(outDir, "src", "datasource", "csv.ts"));

  const modelProperties = ir.properties.map((p) => ({
    name: p.name,
    tsType: toTsType(p.type),
    docComment: p.doc ? formatDocComment(p.doc, "  ") : undefined,
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
        case "principalCollection":
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

    const nameLiteral = JSON.stringify(p.name);
    const stringConstraints = buildTsStringConstraintsLiteral(p);
    const personEntity = p.personEntity
      ? (p.type === "stringCollection"
          ? buildTsPersonEntityCollectionExpression(
              p.personEntity.fields.map((field) => ({
                path: field.path,
                source: field.source,
              })),
              (headersLiteral) => {
                const base = `parseStringCollection(readSourceValue(row, ${headersLiteral}))`;
                return stringConstraints
                  ? `validateStringCollection(${nameLiteral}, ${base}, ${stringConstraints})`
                  : base;
              }
            )
          : buildTsPersonEntityExpression(
              p.personEntity.fields.map((field) => ({
                path: field.path,
                source: field.source,
              })),
              (headersLiteral) => {
                const base = `parseString(readSourceValue(row, ${headersLiteral}))`;
                return stringConstraints
                  ? `validateString(${nameLiteral}, ${base}, ${stringConstraints})`
                  : base;
              }
            ))
      : null;

    const principalExpression =
      p.type === "principal"
        ? buildTsPrincipalExpression(p.personEntity?.fields ?? null, p.source.csvHeaders)
        : p.type === "principalCollection"
        ? buildTsPrincipalCollectionExpression(p.personEntity?.fields ?? null, p.source.csvHeaders)
        : null;

    const isPeopleLabel = p.labels.some((label) => label.startsWith("person"));
    const needsManualEntity = isPeopleLabel && !p.personEntity;
    const noSource = Boolean(p.source.noSource);
    const expression = needsManualEntity
      ? `(() => { throw new Error("Missing @coco.source(..., to) mappings for people entity '${p.name}'. Implement transform in propertyTransform.ts."); })()`
      : noSource
      ? `undefined as unknown as ${toTsType(p.type)}`
      : (p.type === "principal" || p.type === "principalCollection") && principalExpression
      ? principalExpression
      : personEntity
      ? personEntity
      : `${parser}(readSourceValue(row, ${JSON.stringify(p.source.csvHeaders)}))`;

    const validationMetadata = {
      name: p.name,
      type: p.type,
      ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
      ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
      ...(p.pattern ? { pattern: p.pattern } : {}),
      ...(p.format ? { format: p.format } : {}),
      ...(p.minValue !== undefined ? { minValue: p.minValue } : {}),
      ...(p.maxValue !== undefined ? { maxValue: p.maxValue } : {}),
    };

    const validatedExpression = needsManualEntity || noSource || personEntity || p.type === "principal" || p.type === "principalCollection"
      ? expression
      : applyTsValidationExpression(validationMetadata, expression);

    return {
      name: p.name,
      parser,
      expression: validatedExpression,
      isCollection: p.type === "stringCollection",
      transformName: toTsIdentifier(p.name),
      tsType: toTsType(p.type),
    };
  });

  const idProperty = ir.properties.find((p) => p.name === ir.item.idPropertyName);
  const idRawHeaders = idProperty?.personEntity?.fields[0]?.source.csvHeaders ?? idProperty?.source.csvHeaders ?? [];
  const idRawExpression = idRawHeaders.length
    ? `parseString(readSourceValue(row, ${JSON.stringify(idRawHeaders)}))`
    : '""';

  const usesPrincipal = ir.properties.some(
    (p) => p.type === "principal" || p.type === "principalCollection"
  );

  await writeFile(
    path.join(outDir, "src", schemaFolderName, "model.ts"),
    await renderTemplate("ts/src/generated/model.ts.ejs", {
      itemTypeName: ir.item.typeName,
      properties: modelProperties,
      itemDocComment: ir.item.doc ? formatDocComment(ir.item.doc) : undefined,
      usesPrincipal,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", "datasource", "row.ts"),
    await renderTemplate("ts/src/generated/row.ts.ejs", {}),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", schemaFolderName, "constants.ts"),
    await renderTemplate("ts/src/generated/constants.ts.ejs", {
      graphApiVersion: ir.connection.graphApiVersion,
      contentCategory: ir.connection.contentCategory ?? null,
      connectionName: ir.connection.connectionName ?? null,
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
    path.join(outDir, "src", schemaFolderName, "schemaPayload.ts"),
    await renderTemplate("ts/src/generated/schemaPayload.ts.ejs", {
      schemaPayloadJson: JSON.stringify(schemaPayload(ir), null, 2),
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", schemaFolderName, "propertyTransformBase.ts"),
    await renderTemplate("ts/src/generated/propertyTransformBase.ts.ejs", {
      properties: transformProperties,
      usesPrincipal,
    }),
    "utf8"
  );

  const transformOverridesPath = path.join(outDir, "src", schemaFolderName, "propertyTransform.ts");
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
    path.join(outDir, "src", schemaFolderName, "fromRow.ts"),
    await renderTemplate("ts/src/generated/fromRow.ts.ejs", {
      properties: transformProperties,
      itemTypeName: ir.item.typeName,
      idRawExpression,
      usesPrincipal,
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
  const contentValueExpression = ir.item.contentPropertyName
    ? "String((item as any)[contentPropertyName ?? \"\"] ?? \"\")"
    : "\"\"";
  const contentBlock = `,\n    content: {\n      type: \"text\",\n      value: ${contentValueExpression},\n    }`;

  await writeFile(
    path.join(outDir, "src", schemaFolderName, "itemPayload.ts"),
    await renderTemplate("ts/src/generated/itemPayload.ts.ejs", {
      propertiesObjectLines,
      contentBlock,
      itemTypeName: ir.item.typeName,
      idEncoding: ir.item.idEncoding,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", schemaFolderName, "index.ts"),
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

  await writeFile(
    path.join(outDir, "src", "core", "validation.ts"),
    await renderTemplate("ts/src/core/validation.ts.ejs", {}),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "src", "core", "itemId.ts"),
    await renderTemplate("ts/src/core/itemId.ts.ejs", {}),
    "utf8"
  );

  if (usesPrincipal) {
    await writeFile(
      path.join(outDir, "src", "core", "principal.ts"),
      await renderTemplate("ts/src/core/principal.ts.ejs", {}),
      "utf8"
    );
  }
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
    case "principalCollection":
      return "PrincipalCollection";
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
      return "RowParser.ParseStringCollection";
    case "int64Collection":
      return "RowParser.ParseInt64Collection";
    case "doubleCollection":
      return "RowParser.ParseDoubleCollection";
    case "dateTimeCollection":
      return "RowParser.ParseDateTimeCollection";
    case "boolean":
      return "RowParser.ParseBoolean";
    case "int64":
      return "RowParser.ParseInt64";
    case "double":
      return "RowParser.ParseDouble";
    case "dateTime":
      return "RowParser.ParseDateTime";
    case "principal":
    case "principalCollection":
    case "string":
    default:
      return "RowParser.ParseString";
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

function formatDocComment(doc: string, indent = ""): string {
  const lines = doc.split(/\r?\n/).map((line) => `${indent} * ${line}`);
  return `${indent}/**\n${lines.join("\n")}\n${indent} */`;
}

function formatCsDocSummary(doc: string): string[] {
  const lines = doc.split(/\r?\n/).map((line) => `/// ${line}`);
  return ["/// <summary>", ...lines, "/// </summary>"];
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

function buildTsPersonEntityExpression(
  fields: PersonEntityField[],
  valueExpressionBuilder: (headersLiteral: string) => string = (headersLiteral) =>
    `parseString(readSourceValue(row, ${headersLiteral}))`
): string {
  const tree = buildObjectTree(fields);
  const indentUnit = "  ";

  const renderNode = (node: Record<string, unknown>, level: number): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const headers = JSON.stringify(field.source.csvHeaders);
        return `${childIndent}${JSON.stringify(key)}: ${valueExpressionBuilder(headers)}`;
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

function buildTsPersonEntityCollectionExpression(
  fields: PersonEntityField[],
  collectionExpressionBuilder: (headersLiteral: string) => string = (headersLiteral) =>
    `parseStringCollection(readSourceValue(row, ${headersLiteral}))`
): string {
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

    return `${collectionExpressionBuilder(headers)}
  .map((value) => JSON.stringify(\n${indentUnit.repeat(2)}${rendered}\n${indentUnit.repeat(2)}))`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const headers = JSON.stringify(field.source.csvHeaders);
    return `  const ${varName} = ${collectionExpressionBuilder(headers)};`;
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

function buildPrincipalFieldEntries(
  fields: PersonEntityField[] | null,
  fallbackHeaders: string[]
): Array<{ key: string; headersLiteral: string }> {
  if (fields && fields.length > 0) {
    return fields
      .map((field) => {
        const key = field.path.split(".").pop() ?? field.path;
        return {
          key,
          headersLiteral: JSON.stringify(field.source.csvHeaders),
        };
      })
      .filter((entry) => entry.headersLiteral.length > 2 && entry.key.length > 0);
  }

  if (fallbackHeaders.length > 0) {
    return [
      {
        key: "userPrincipalName",
        headersLiteral: JSON.stringify([fallbackHeaders[0]!]),
      },
    ];
  }

  return [];
}

function buildTsPrincipalExpression(
  fields: PersonEntityField[] | null,
  fallbackHeaders: string[]
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackHeaders).map(
    (entry) => `  ${JSON.stringify(entry.key)}: parseString(readSourceValue(row, ${entry.headersLiteral}))`
  );

  return `({\n  "@odata.type": "#microsoft.graph.externalConnectors.principal"${entries.length ? ",\n" + entries.join(",\n") : ""}\n})`;
}

function buildCsPrincipalExpression(
  fields: PersonEntityField[] | null,
  fallbackHeaders: string[]
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackHeaders);
  const knownMap = new Map<string, string>([
    ["userPrincipalName", "UserPrincipalName"],
    ["tenantId", "TenantId"],
    ["id", "Id"],
    ["type", "Type"],
    ["displayName", "DisplayName"],
  ]);

  const knownAssignments: string[] = [];
  const additionalDataEntries: string[] = [];

  for (const entry of entries) {
    const headers = `new[] { ${JSON.parse(entry.headersLiteral).map((h: string) => JSON.stringify(h)).join(", ")} }`;
    const propertyName = knownMap.get(entry.key);
    if (propertyName) {
      knownAssignments.push(`    ${propertyName} = RowParser.ParseString(row, ${headers}),`);
    } else {
      additionalDataEntries.push(`        [${JSON.stringify(entry.key)}] = RowParser.ParseString(row, ${headers}),`);
    }
  }

  const additionalDataBlock = additionalDataEntries.length
    ? [
        "    AdditionalData = new Dictionary<string, object?>",
        "    {",
        ...additionalDataEntries,
        "    },",
      ]
    : [];

  return [
    "new Principal",
    "{",
    "    OdataType = \"#microsoft.graph.externalConnectors.principal\",",
    ...knownAssignments,
    ...additionalDataBlock,
    "}"
  ].join("\n");
}

function buildTsPrincipalCollectionExpression(
  fields: PersonEntityField[] | null,
  fallbackHeaders: string[]
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackHeaders);
  if (entries.length === 0) return "[]";

  const fieldLines = entries.map(
    (entry, index) => `  const field${index} = parseStringCollection(readSourceValue(row, ${entry.headersLiteral}));`
  );
  const lengthVars = entries.length
    ? `  const lengths = [${entries.map((_, index) => `field${index}.length`).join(", ")}];`
    : "  const lengths = [0];";

  const fieldsBlock = entries
    .map((entry, index) => `      ${JSON.stringify(entry.key)}: getValue(field${index}, index)`) 
    .join(",\n");

  return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n  const maxLen = Math.max(0, ...lengths);\n  const getValue = (values: string[], index: number): string => {\n    if (values.length === 0) return "";\n    if (values.length === 1) return values[0] ?? "";\n    return values[index] ?? "";\n  };\n  const results: Principal[] = [];\n  for (let index = 0; index < maxLen; index++) {\n    results.push({\n      "@odata.type": "#microsoft.graph.externalConnectors.principal",\n${fieldsBlock}\n    });\n  }\n  return results;\n})()`;
}

function buildCsPrincipalCollectionExpression(
  fields: PersonEntityField[] | null,
  fallbackHeaders: string[]
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackHeaders);
  if (entries.length === 0) return "new List<Principal>()";

  const fieldLines = entries.map((entry, index) => {
    const headers = `new[] { ${JSON.parse(entry.headersLiteral).map((h: string) => JSON.stringify(h)).join(", ")} }`;
    return `        var field${index} = RowParser.ParseStringCollection(row, ${headers});`;
  });

  const knownMap = new Map<string, string>([
    ["userPrincipalName", "UserPrincipalName"],
    ["tenantId", "TenantId"],
    ["id", "Id"],
    ["type", "Type"],
    ["displayName", "DisplayName"],
  ]);

  const knownAssignments = entries
    .map((entry, index) => {
      const propertyName = knownMap.get(entry.key);
      return propertyName ? `                ${propertyName} = GetValue(field${index}, index),` : null;
    })
    .filter((line): line is string => Boolean(line));

  const additionalDataEntries = entries
    .map((entry, index) => {
      if (knownMap.has(entry.key)) return null;
      return `                    [${JSON.stringify(entry.key)}] = GetValue(field${index}, index),`;
    })
    .filter((line): line is string => Boolean(line));

  const additionalDataBlock = additionalDataEntries.length
    ? [
        "                AdditionalData = new Dictionary<string, object?>",
        "                {",
        ...additionalDataEntries,
        "                },",
      ]
    : [];

  const lengthsLine = entries.map((_, index) => `field${index}.Count`).join(", ");

  return [
    "new Func<List<Principal>>(() =>",
    "{",
    ...fieldLines,
    `        var lengths = new[] { ${lengthsLine} };`,
    "        var maxLen = 0;",
    "        foreach (var len in lengths)",
    "        {",
    "            if (len > maxLen) maxLen = len;",
    "        }",
    "        string GetValue(IReadOnlyList<string> values, int index)",
    "        {",
    "            if (values.Count == 0) return \"\";",
    "            if (values.Count == 1) return values[0] ?? \"\";",
    "            return index < values.Count ? (values[index] ?? \"\") : \"\";",
    "        }",
    "        var results = new List<Principal>();",
    "        for (var index = 0; index < maxLen; index++)",
    "        {",
    "            var principal = new Principal",
    "            {",
    "                OdataType = \"#microsoft.graph.externalConnectors.principal\",",
    ...knownAssignments,
    ...additionalDataBlock,
    "            };",
    "            results.Add(principal);",
    "        }",
    "        return results;",
    "})()",
  ].join("\n");
}

function buildCsPersonEntityExpression(
  fields: PersonEntityField[],
  valueExpressionBuilder: (headersLiteral: string) => string = (headersLiteral) =>
    `RowParser.ParseString(row, ${headersLiteral})`
): string {
  const tree = buildObjectTree(fields);
  const indentUnit = "    ";

  const renderNode = (node: Record<string, unknown>, level: number): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const headers = `new[] { ${field.source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
        return `${childIndent}[${JSON.stringify(key)}] = ${valueExpressionBuilder(headers)}`;
      }
      return `${childIndent}[${JSON.stringify(key)}] = ${renderNode(value as Record<string, unknown>, level + 1)}`;
    });

    return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
  };

  const rendered = renderNode(tree, 2);
  return `JsonSerializer.Serialize(\n${indentUnit.repeat(2)}${rendered}\n${indentUnit.repeat(2)})`;
}

function buildCsPersonEntityCollectionExpression(
  fields: PersonEntityField[],
  collectionExpressionBuilder: (headersLiteral: string) => string = (headersLiteral) =>
    `RowParser.ParseStringCollection(row, ${headersLiteral})`
): string {
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

    return `${collectionExpressionBuilder(headers)}
            .Select(value => JsonSerializer.Serialize(\n${indentUnit.repeat(3)}${rendered}\n${indentUnit.repeat(3)}))
            .ToList()`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const headers = `new[] { ${field.source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
    return `        var ${varName} = ${collectionExpressionBuilder(headers)};`;
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
    case "principalCollection":
      return "alice@contoso.com;bob@contoso.com";
    case "string":
    default:
      return "sample";
  }
}

function buildTsStringConstraintsLiteral(prop: {
  minLength?: number;
  maxLength?: number;
  pattern?: { regex: string; message?: string };
  format?: string;
}): string | undefined {
  const parts: string[] = [];
  if (prop.minLength !== undefined) parts.push(`minLength: ${prop.minLength}`);
  if (prop.maxLength !== undefined) parts.push(`maxLength: ${prop.maxLength}`);
  if (prop.pattern?.regex) parts.push(`pattern: ${JSON.stringify(prop.pattern.regex)}`);
  if (prop.format) parts.push(`format: ${JSON.stringify(prop.format)}`);
  return parts.length > 0 ? `{ ${parts.join(", ")} }` : undefined;
}

function buildTsNumberConstraintsLiteral(prop: { minValue?: number; maxValue?: number }): string | undefined {
  const parts: string[] = [];
  if (prop.minValue !== undefined) parts.push(`minValue: ${prop.minValue}`);
  if (prop.maxValue !== undefined) parts.push(`maxValue: ${prop.maxValue}`);
  return parts.length > 0 ? `{ ${parts.join(", ")} }` : undefined;
}

function applyTsValidationExpression(
  prop: {
    name: string;
    type: PropertyType;
    minLength?: number;
    maxLength?: number;
    pattern?: { regex: string; message?: string };
    format?: string;
    minValue?: number;
    maxValue?: number;
  },
  expression: string
): string {
  const stringConstraints = buildTsStringConstraintsLiteral(prop);
  const numberConstraints = buildTsNumberConstraintsLiteral(prop);
  const nameLiteral = JSON.stringify(prop.name);

  switch (prop.type) {
    case "string":
    case "principal":
    case "dateTime":
      return stringConstraints ? `validateString(${nameLiteral}, ${expression}, ${stringConstraints})` : expression;
    case "stringCollection":
    case "dateTimeCollection":
      return stringConstraints
        ? `validateStringCollection(${nameLiteral}, ${expression}, ${stringConstraints})`
        : expression;
    case "int64":
    case "double":
      return numberConstraints ? `validateNumber(${nameLiteral}, ${expression}, ${numberConstraints})` : expression;
    case "int64Collection":
    case "doubleCollection":
      return numberConstraints
        ? `validateNumberCollection(${nameLiteral}, ${expression}, ${numberConstraints})`
        : expression;
    default:
      return expression;
  }
}

function buildCsStringConstraintsLiteral(prop: {
  minLength?: number;
  maxLength?: number;
  pattern?: { regex: string; message?: string };
  format?: string;
}): { minLength: string; maxLength: string; pattern: string; format: string; hasAny: boolean } {
  const minLength = prop.minLength !== undefined ? prop.minLength.toString() : "null";
  const maxLength = prop.maxLength !== undefined ? prop.maxLength.toString() : "null";
  const pattern = prop.pattern?.regex ? JSON.stringify(prop.pattern.regex) : "null";
  const format = prop.format ? JSON.stringify(prop.format) : "null";
  const hasAny = prop.minLength !== undefined || prop.maxLength !== undefined || Boolean(prop.pattern?.regex) || Boolean(prop.format);
  return { minLength, maxLength, pattern, format, hasAny };
}

function buildCsNumberConstraintsLiteral(prop: { minValue?: number; maxValue?: number }): { minValue: string; maxValue: string; hasAny: boolean } {
  const minValue = prop.minValue !== undefined ? prop.minValue.toString() : "null";
  const maxValue = prop.maxValue !== undefined ? prop.maxValue.toString() : "null";
  const hasAny = prop.minValue !== undefined || prop.maxValue !== undefined;
  return { minValue, maxValue, hasAny };
}

function applyCsValidationExpression(
  prop: {
    name: string;
    type: PropertyType;
    minLength?: number;
    maxLength?: number;
    pattern?: { regex: string; message?: string };
    format?: string;
    minValue?: number;
    maxValue?: number;
  },
  expression: string,
  csvHeadersLiteral: string
): string {
  const stringConstraints = buildCsStringConstraintsLiteral(prop);
  const numberConstraints = buildCsNumberConstraintsLiteral(prop);
  const nameLiteral = JSON.stringify(prop.name);

  switch (prop.type) {
    case "string":
    case "principal":
      return stringConstraints.hasAny
        ? `Validation.ValidateString(${nameLiteral}, ${expression}, ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format})`
        : expression;
    case "dateTime":
      if (!stringConstraints.hasAny) return expression;
      return `RowParser.ParseDateTime(Validation.ValidateString(${nameLiteral}, RowParser.ReadValue(row, ${csvHeadersLiteral}), ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format}))`;
    case "stringCollection":
      return stringConstraints.hasAny
        ? `Validation.ValidateStringCollection(${nameLiteral}, ${expression}, ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format})`
        : expression;
    case "dateTimeCollection":
      if (!stringConstraints.hasAny) return expression;
        return `Validation.ValidateStringCollection(${nameLiteral}, RowParser.ParseStringCollection(RowParser.ReadValue(row, ${csvHeadersLiteral})), ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format}).Select(value => RowParser.ParseDateTime(value)).ToList()`;
    case "int64":
      return numberConstraints.hasAny
        ? `Validation.ValidateInt64(${nameLiteral}, ${expression}, ${numberConstraints.minValue}, ${numberConstraints.maxValue})`
        : expression;
    case "double":
      return numberConstraints.hasAny
        ? `Validation.ValidateDouble(${nameLiteral}, ${expression}, ${numberConstraints.minValue}, ${numberConstraints.maxValue})`
        : expression;
    case "int64Collection":
      return numberConstraints.hasAny
        ? `Validation.ValidateInt64Collection(${nameLiteral}, ${expression}, ${numberConstraints.minValue}, ${numberConstraints.maxValue})`
        : expression;
    case "doubleCollection":
      return numberConstraints.hasAny
        ? `Validation.ValidateDoubleCollection(${nameLiteral}, ${expression}, ${numberConstraints.minValue}, ${numberConstraints.maxValue})`
        : expression;
    default:
      return expression;
  }
}

function exampleValueForType(example: unknown, type: PropertyType): string | undefined {
  if (example === undefined || example === null) return undefined;

  if (type.endsWith("Collection")) {
    if (Array.isArray(example)) {
      return example.map((value) => (value === undefined || value === null ? "" : String(value))).join(";");
    }
    if (typeof example === "string") return example;
    return JSON.stringify(example);
  }

  if (typeof example === "string") return example;
  if (typeof example === "number" || typeof example === "boolean") return String(example);
  return JSON.stringify(example);
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
      const exampleValue = exampleValueForType(prop.example, prop.type);
      if (exampleValue && prop.personEntity.fields.length === 1) {
        const headers = prop.personEntity.fields[0]?.source.csvHeaders ?? [];
        for (const header of headers) {
          if (!valueByHeader.has(header)) valueByHeader.set(header, exampleValue);
        }
      }
      for (const field of prop.personEntity.fields) {
        for (const header of field.source.csvHeaders) {
          if (!valueByHeader.has(header)) valueByHeader.set(header, sampleValueForHeader(header));
        }
      }
      continue;
    }

    const exampleValue = exampleValueForType(prop.example, prop.type);
    for (const header of prop.source.csvHeaders) {
      if (!valueByHeader.has(header)) {
        valueByHeader.set(header, exampleValue ?? sampleValueForHeader(header, prop.type));
      }
    }
  }

  const headerLine = headers.map(csvEscape).join(",");
  const valueLine = headers.map((h) => csvEscape(valueByHeader.get(h) ?? "sample")).join(",");
  return `${headerLine}\n${valueLine}\n`;
}

async function writeGeneratedDotnet(
  outDir: string,
  ir: ConnectorIr,
  namespaceName: string,
  schemaFolderName: string,
  schemaNamespace: string
): Promise<void> {
  await mkdir(path.join(outDir, schemaFolderName), { recursive: true });
  await mkdir(path.join(outDir, "Datasource"), { recursive: true });
  await mkdir(path.join(outDir, "Core"), { recursive: true });

  await removeIfExists(path.join(outDir, schemaFolderName, "FromCsvRow.cs"));
  await removeIfExists(path.join(outDir, "Datasource", "CsvParser.cs"));

  const usedPropertyNames = new Set<string>();
  const itemTypeName = toCsIdentifier(ir.item.typeName);
  const properties = ir.properties.map((p) => {
    const parseFn = toCsParseFunction(p.type);
    const csvHeadersLiteral = `new[] { ${p.source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
    const isCollection = p.type === "stringCollection";
    const nameLiteral = JSON.stringify(p.name);
    const csStringConstraints = buildCsStringConstraintsLiteral(p);
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
    const noSource = Boolean(p.source.noSource);
    const principalExpression =
      p.type === "principal"
        ? buildCsPrincipalExpression(p.personEntity?.fields ?? null, p.source.csvHeaders)
        : p.type === "principalCollection"
        ? buildCsPrincipalCollectionExpression(p.personEntity?.fields ?? null, p.source.csvHeaders)
        : null;
    const transformExpression = needsManualEntity
      ? `throw new NotImplementedException("Missing @coco.source(..., to) mappings for people entity '${p.name}'. Implement in PropertyTransform.cs.")`
      : noSource
      ? "default!"
      : (p.type === "principal" || p.type === "principalCollection") && principalExpression
      ? principalExpression
      : personEntity
      ? isCollection
          ? buildCsPersonEntityCollectionExpression(personEntity.fields, (headersLiteral) => {
            const base = `RowParser.ParseStringCollection(row, ${headersLiteral})`;
            return csStringConstraints.hasAny
              ? `Validation.ValidateStringCollection(${nameLiteral}, ${base}, ${csStringConstraints.minLength}, ${csStringConstraints.maxLength}, ${csStringConstraints.pattern}, ${csStringConstraints.format})`
              : base;
          })
        : buildCsPersonEntityExpression(personEntity.fields, (headersLiteral) => {
            const base = `RowParser.ParseString(row, ${headersLiteral})`;
            return csStringConstraints.hasAny
              ? `Validation.ValidateString(${nameLiteral}, ${base}, ${csStringConstraints.minLength}, ${csStringConstraints.maxLength}, ${csStringConstraints.pattern}, ${csStringConstraints.format})`
              : base;
          })
      : `${parseFn}(row, ${csvHeadersLiteral})`;

    const validationMetadata = {
      name: p.name,
      type: p.type,
      ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
      ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
      ...(p.pattern ? { pattern: p.pattern } : {}),
      ...(p.format ? { format: p.format } : {}),
      ...(p.minValue !== undefined ? { minValue: p.minValue } : {}),
      ...(p.maxValue !== undefined ? { maxValue: p.maxValue } : {}),
    };

    const validatedExpression = needsManualEntity || noSource || personEntity || p.type === "principal" || p.type === "principalCollection"
      ? transformExpression
      : applyCsValidationExpression(validationMetadata, transformExpression, csvHeadersLiteral);

    return {
      name: p.name,
      csName: toCsPropertyName(p.name, itemTypeName, usedPropertyNames),
      csType: toCsType(p.type),
      csvHeaders: p.source.csvHeaders,
      csvHeadersLiteral,
      isCollection,
      personEntity,
      parseFn,
      transformExpression: validatedExpression,
      transformThrows: needsManualEntity,
      graphTypeEnumName: toGraphPropertyTypeEnumName(p.type),
      description: p.description,
      doc: p.doc,
      labels: p.labels,
      aliases: p.aliases,
      search: p.search,
      type: p.type,
      format: p.format,
      pattern: p.pattern,
      minLength: p.minLength,
      maxLength: p.maxLength,
      minValue: p.minValue,
      maxValue: p.maxValue,
    };
  });

  const recordDocLines: string[] = [];
  if (ir.item.doc) {
    recordDocLines.push(...formatCsDocSummary(ir.item.doc));
  }
  for (const prop of properties) {
    if (!prop.doc) continue;
    const docLines = prop.doc.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (docLines.length === 0) continue;
    recordDocLines.push(`/// <param name=\"${prop.csName}\">${docLines.join(" ")}</param>`);
  }

  const schemaPropertyLines = properties
    .filter((p) => p.name !== ir.item.contentPropertyName)
    .map((p) => {
      const isPrincipalCollection =
        ir.connection.graphApiVersion === "beta" && p.type === "principalCollection";
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
      if (isPrincipalCollection) additionalDataEntries.push(`                        ["type"] = "principalCollection",`);

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
        ...(isPrincipalCollection ? [] : [`                    Type = PropertyType.${p.graphTypeEnumName},`]),
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

  const itemIdProperty = properties.find((p) => p.name === ir.item.idPropertyName);
  const idRawHeadersDotnet =
    itemIdProperty?.personEntity?.fields[0]?.source.csvHeaders ?? itemIdProperty?.csvHeaders ?? [];
  const idRawHeadersLiteral = `new[] { ${idRawHeadersDotnet.map((h) => JSON.stringify(h)).join(", ")} }`;
  const idRawExpressionDotnet = idRawHeadersDotnet.length
    ? `RowParser.ParseString(row, ${idRawHeadersLiteral})`
    : "string.Empty";
  const constructorArgs = [
    ...properties.map((p) => `(${p.csType})transforms.TransformProperty(${JSON.stringify(p.name)}, row)`),
    idRawExpressionDotnet,
  ];
  const constructorArgLines = constructorArgs
    .map((arg, index) => {
      const comma = index < constructorArgs.length - 1 ? "," : "";
      return `            ${arg}${comma}`;
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

  const itemIdExpression = itemIdProperty
    ? `!string.IsNullOrEmpty(item.InternalId) ? item.InternalId : (item.${itemIdProperty.csName} ?? string.Empty)`
    : "\"\"";

  const contentValueExpression = ir.item.contentPropertyName
    ? `Convert.ToString(item.${toCsIdentifier(ir.item.contentPropertyName)}) ?? string.Empty`
    : "string.Empty";
  const contentBlock = [
    "        externalItem.Content = new ExternalItemContent",
    "        {",
    "            Type = ExternalItemContentType.Text,",
    `            Value = ${contentValueExpression},`,
    "        };",
  ].join("\n");

  const usesPrincipal = properties.some(
    (p) => p.type === "principal" || p.type === "principalCollection"
  );

  await writeFile(
    path.join(outDir, schemaFolderName, "Model.cs"),
    await renderTemplate("dotnet/Generated/Model.cs.ejs", {
      namespaceName,
      schemaNamespace,
      itemTypeName: ir.item.typeName,
      properties: properties.map((p) => ({ csName: p.csName, csType: p.csType })),
      recordDocLines,
      graphApiVersion: ir.connection.graphApiVersion,
      usesPrincipal,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, schemaFolderName, "Constants.cs"),
    await renderTemplate("dotnet/Generated/Constants.cs.ejs", {
      schemaNamespace,
      graphApiVersion: ir.connection.graphApiVersion,
      contentCategory: ir.connection.contentCategory ?? null,
      connectionId: ir.connection.connectionId ?? null,
      connectionName: ir.connection.connectionName ?? null,
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
    path.join(outDir, schemaFolderName, "SchemaPayload.cs"),
    await renderTemplate("dotnet/Generated/SchemaPayload.cs.ejs", {
      schemaNamespace,
      schemaPropertyLines,
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Datasource", "RowParser.cs"),
    await renderTemplate("dotnet/Generated/RowParser.cs.ejs", {
      namespaceName,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, schemaFolderName, "PropertyTransformBase.cs"),
    await renderTemplate("dotnet/Generated/PropertyTransformBase.cs.ejs", {
      namespaceName,
      schemaNamespace,
      properties,
      usesPersonEntity: properties.some((p) => p.personEntity),
      usesLinq: properties.some(
        (p) =>
          p.type === "dateTimeCollection" &&
          (p.minLength !== undefined ||
            p.maxLength !== undefined ||
            Boolean(p.pattern?.regex) ||
            Boolean(p.format))
      ),
    }),
    "utf8"
  );

  const transformOverridesPath = path.join(outDir, schemaFolderName, "PropertyTransform.cs");
  try {
    await access(transformOverridesPath);
  } catch {
    await writeFile(
      transformOverridesPath,
      await renderTemplate("dotnet/PropertyTransform.cs.ejs", {
        schemaNamespace,
      }),
      "utf8"
    );
  }

  await writeFile(
    path.join(outDir, schemaFolderName, "FromRow.cs"),
    await renderTemplate("dotnet/Generated/FromRow.cs.ejs", {
      namespaceName,
      schemaNamespace,
      itemTypeName: ir.item.typeName,
      constructorArgLines,
      usesPrincipal,
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );


  await writeFile(
    path.join(outDir, schemaFolderName, "ItemPayload.cs"),
    await renderTemplate("dotnet/Generated/ItemPayload.cs.ejs", {
      namespaceName,
      schemaNamespace,
      itemTypeName: ir.item.typeName,
      itemIdExpression,
      propertiesObjectLines,
      contentBlock,
      graphApiVersion: ir.connection.graphApiVersion,
      idEncoding: ir.item.idEncoding,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Core", "ConnectorCore.cs"),
    await renderTemplate("dotnet/Core/ConnectorCore.cs.ejs", {
      namespaceName,
      schemaNamespace,
      itemTypeName: ir.item.typeName,
      isPeopleConnector: ir.connection.contentCategory === "people",
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Core", "Validation.cs"),
    await renderTemplate("dotnet/Core/Validation.cs.ejs", {
      namespaceName,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Core", "ItemId.cs"),
    await renderTemplate("dotnet/Core/ItemId.cs.ejs", {
      namespaceName,
    }),
    "utf8"
  );

  if (usesPrincipal && ir.connection.graphApiVersion === "beta") {
    await writeFile(
      path.join(outDir, "Core", "Principal.cs"),
      await renderTemplate("dotnet/Core/Principal.cs.ejs", {
        namespaceName,
        graphApiVersion: ir.connection.graphApiVersion,
      }),
      "utf8"
    );
  }
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
    throw new Error(`This project is '${config.lang}'. Use cocogen generate/update for that language.`);
  }

  const ir = await loadIrFromTypeSpec(tspPath);
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  const schemaFolderName = toTsSchemaFolderName(ir.connection.connectionName);
  await writeGeneratedTs(outDir, ir, schemaFolderName);
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
    throw new Error(`This project is '${config.lang}'. Use cocogen generate/update for that language.`);
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
  const schemaFolderName = toSchemaFolderName(ir.connection.connectionName);
  const schemaNamespace = `${namespaceName}.${schemaFolderName}`;
  await writeGeneratedDotnet(outDir, ir, namespaceName, schemaFolderName, schemaNamespace);
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
  const schemaFolderName = toTsSchemaFolderName(ir.connection.connectionName);

  await mkdir(path.join(outDir, "src"), { recursive: true });
  await mkdir(path.join(outDir, "src", "datasource"), { recursive: true });
  await mkdir(path.join(outDir, "src", schemaFolderName), { recursive: true });

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
      connectionName: ir.connection.connectionName ?? null,
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
      schemaFolderName,
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
      schemaFolderName,
    }),
    "utf8"
  );
  await writeFile(
    path.join(outDir, "src", "datasource", "itemSource.ts"),
    await renderTemplate("ts/src/datasource/itemSource.ts.ejs", {
      itemTypeName: ir.item.typeName,
      schemaFolderName,
    }),
    "utf8"
  );
  await writeFile(
    path.join(outDir, "src", "datasource", "csvItemSource.ts"),
    await renderTemplate("ts/src/datasource/csvItemSource.ts.ejs", {
      itemTypeName: ir.item.typeName,
      schemaFolderName,
    }),
    "utf8"
  );

  await writeFile(path.join(outDir, "data.csv"), buildSampleCsv(ir), "utf8");

  await writeGeneratedTs(outDir, ir, schemaFolderName);

  await writeFile(
    path.join(outDir, "src", "index.ts"),
    await renderTemplate("ts/src/index.ts.ejs", { schemaFolderName }),
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
  const schemaFolderName = toSchemaFolderName(ir.connection.connectionName);
  const schemaNamespace = `${namespaceName}.${schemaFolderName}`;

  await mkdir(path.join(outDir, "Datasource"), { recursive: true });
  await mkdir(path.join(outDir, schemaFolderName), { recursive: true });

  await writeFile(
    path.join(outDir, `${projectName}.csproj`),
    await renderTemplate("dotnet/project.csproj.ejs", {
      graphApiVersion: ir.connection.graphApiVersion,
      userSecretsId: randomUUID(),
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
      schemaNamespace,
      itemTypeName: ir.item.typeName,
      isPeopleConnector: ir.connection.contentCategory === "people",
      graphApiVersion: ir.connection.graphApiVersion,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Datasource", "IItemSource.cs"),
    await renderTemplate("dotnet/Datasource/IItemSource.cs.ejs", {
      namespaceName,
      schemaNamespace,
      itemTypeName: ir.item.typeName,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "Datasource", "CsvItemSource.cs"),
    await renderTemplate("dotnet/Datasource/CsvItemSource.cs.ejs", {
      namespaceName,
      schemaNamespace,
      itemTypeName: ir.item.typeName,
    }),
    "utf8"
  );

  await writeFile(path.join(outDir, "data.csv"), buildSampleCsv(ir), "utf8");

  await writeFile(
    path.join(outDir, "appsettings.json"),
    await renderTemplate("dotnet/appsettings.json.ejs", {
      itemTypeName: ir.item.typeName,
      isPeopleConnector: ir.connection.contentCategory === "people",
      connectionName: ir.connection.connectionName ?? null,
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
      schemaFolderName,
    }),
    "utf8"
  );

  const copiedTspPath = path.join(outDir, "schema.tsp");
  await copyFile(path.resolve(options.tspPath), copiedTspPath);
  await writeFile(path.join(outDir, COCOGEN_CONFIG_FILE), projectConfigContents(outDir, copiedTspPath, "dotnet"), "utf8");

  await writeGeneratedDotnet(outDir, ir, namespaceName, schemaFolderName, schemaNamespace);

  return { outDir, ir };
}
