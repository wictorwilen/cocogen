import { access, copyFile, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { ConnectorIr, PropertyType } from "../ir.js";
import { loadIrFromTypeSpec } from "../tsp/loader.js";
import { PEOPLE_LABEL_DEFINITIONS, getPeopleLabelInfo, supportedPeopleLabels } from "../people/label-registry.js";
import { graphProfileSchema, getProfileType, type GraphProfileProperty } from "../people/profile-schema.js";
import { validateIr } from "../validate/validator.js";
import {
  toCsIdentifier,
  toCsNamespace,
  toCsPascal,
  toCsPropertyName,
  toCsType,
  toSchemaFolderName,
  toTsIdentifier,
  toTsSchemaFolderName,
  toTsType,
} from "./naming.js";
import { buildObjectTree } from "./object-tree.js";
import { COCOGEN_CONFIG_FILE, type CocogenProjectConfig, loadProjectConfig, projectConfigContents } from "./project-config.js";
import type { PersonEntityField, SourceDescriptor } from "./shared-types.js";
import {
  buildSampleCsv,
  buildSampleJson,
  buildSamplePersonEntityPayload,
  buildSampleYaml,
  exampleValueForPayload,
  exampleValueForType,
  samplePayloadValueForType,
} from "./sample-data.js";
import { renderTemplate } from "./template.js";

export type InitOptions = {
  tspPath: string;
  outDir: string;
  projectName?: string;
  force?: boolean;
  usePreviewFeatures?: boolean;
  inputFormat?: "csv" | "json" | "yaml" | "custom" | undefined;
};

export type UpdateOptions = {
  outDir: string;
  tspPath?: string;
  usePreviewFeatures?: boolean;
};

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
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

async function updateSchemaCopy(outDir: string, tspPath: string): Promise<void> {
  await copyFile(tspPath, path.join(outDir, "schema.tsp"));
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

  const hasPeopleSupport =
    ir.connection.contentCategory === "people" ||
    ir.properties.some((p) => p.labels.some((label) => label.startsWith("person")));
  const peopleGraphTypesBundle = hasPeopleSupport ? buildPeopleGraphTypes(ir) : null;
  const peopleGraphTypes = peopleGraphTypesBundle ? peopleGraphTypesBundle.templates : [];
  const graphAliases = peopleGraphTypesBundle ? peopleGraphTypesBundle.aliases : new Map<string, PeopleGraphTypeAlias>();

  const peopleProfileTypeInfoByAlias = new Map<string, TsPersonEntityTypeInfo>();
  if (hasPeopleSupport && peopleGraphTypesBundle) {
    for (const type of graphProfileSchema.types) {
      const alias = toTsIdentifier(type.name);
      const properties = new Map<string, string>();
      for (const prop of type.properties ?? []) {
        const descriptor = parseGraphTypeDescriptor(prop.type, graphAliases);
        properties.set(prop.name, descriptor.tsType);
      }
      peopleProfileTypeInfoByAlias.set(alias, { alias, properties });
    }
    for (const type of peopleGraphTypesBundle.derived) {
      const alias = type.alias;
      const properties = new Map<string, string>(type.fields.map((field) => [field.name, field.tsType]));
      peopleProfileTypeInfoByAlias.set(alias, { alias, properties });
    }
  }

  const collectPeopleEntityTypes = (fields: PersonEntityField[], typeInfo: TsPersonEntityTypeInfo | null): Set<string> => {
    const used = new Set<string>();
    if (!typeInfo) return used;

    const tree = buildObjectTree(fields);
    const visit = (node: Record<string, unknown>, info: TsPersonEntityTypeInfo | null): void => {
      if (!info) return;
      used.add(info.alias);
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "object" && value && !Array.isArray(value) && !("path" in (value as PersonEntityField))) {
          const propType = info.properties.get(key) ?? null;
          const nestedInfo = propType && !propType.endsWith("[]") ? peopleProfileTypeInfoByAlias.get(propType) ?? null : null;
          if (nestedInfo) {
            visit(value as Record<string, unknown>, nestedInfo);
          }
        }
      }
    };
    visit(tree, typeInfo);
    return used;
  };

  const peopleEntityTypes = new Set<string>();
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
    const personEntityType = p.personEntity ? toTsIdentifier(p.personEntity.entity) : null;
    const personEntityTypeInfo = personEntityType ? peopleProfileTypeInfoByAlias.get(personEntityType) ?? null : null;
    if (personEntityTypeInfo) {
      for (const typeName of collectPeopleEntityTypes(
        p.personEntity?.fields.map((field) => ({ path: field.path, source: field.source })) ?? [],
        personEntityTypeInfo
      )) {
        peopleEntityTypes.add(typeName);
      }
    }
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
              },
              personEntityTypeInfo,
              peopleProfileTypeInfoByAlias
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
              },
              personEntityTypeInfo,
              peopleProfileTypeInfoByAlias
            ))
      : null;

    const principalExpression =
      p.type === "principal"
        ? buildTsPrincipalExpression(p.personEntity?.fields ?? null, p.source)
        : p.type === "principalCollection"
        ? buildTsPrincipalCollectionExpression(p.personEntity?.fields ?? null, p.source)
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
      : `${parser}(readSourceValue(row, ${buildSourceLiteral(p.source)}))`;

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
  const idRawSource = idProperty?.personEntity?.fields[0]?.source ?? idProperty?.source;
  const idRawExpression = idRawSource
    ? `parseString(readSourceValue(row, ${buildSourceLiteral(idRawSource)}))`
    : '""';

  const usesPrincipal = ir.properties.some(
    (p) => p.type === "principal" || p.type === "principalCollection"
  );
  const peopleLabelSerializers = hasPeopleSupport ? buildPeopleLabelSerializers() : [];
  const serializerImports = new Set<string>();
  const payloadProperties = ir.properties
    .filter((p) => p.name !== ir.item.contentPropertyName)
    .map((p) => {
      const odataType = toOdataCollectionType(p.type);
      const personLabel = p.labels.find((label) => label.startsWith("person"));
      const serializerName =
        personLabel && PEOPLE_LABEL_DEFINITIONS.has(personLabel)
          ? `serialize${toTsIdentifier(personLabel)}`
          : null;
      if (serializerName) {
        serializerImports.add(serializerName);
      }
      const baseValue =
        p.type === "principal"
          ? `cleanPrincipal(item.${p.name} as Record<string, unknown> | null | undefined)`
          : p.type === "principalCollection"
          ? `cleanPrincipalCollection(item.${p.name} as Array<Record<string, unknown>> | null | undefined)`
          : `item.${p.name}`;
      const valueExpression = serializerName
        ? `${serializerName}(${baseValue}, ${JSON.stringify(p.name)})`
        : baseValue;
      return {
        name: p.name,
        odataType,
        valueExpression,
      };
    });

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
    await renderTemplate("ts/src/generated/row.ts.ejs", {
      inputFormat: ir.connection.inputFormat,
    }),
    "utf8"
  );

  if (ir.connection.inputFormat !== "csv") {
    await writeFile(
      path.join(outDir, "src", "datasource", "inputPath.ts"),
      await renderTemplate("ts/src/datasource/inputPath.ts.ejs", {}),
      "utf8"
    );
  }

  await writeFile(
    path.join(outDir, "src", schemaFolderName, "constants.ts"),
    await renderTemplate("ts/src/generated/constants.ts.ejs", {
      graphApiVersion: ir.connection.graphApiVersion,
      contentCategory: ir.connection.contentCategory ?? null,
      connectionName: ir.connection.connectionName ?? null,
      connectionId: ir.connection.connectionId ?? null,
      connectionDescription: ir.connection.connectionDescription ?? null,
      inputFormat: ir.connection.inputFormat,
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

  if (hasPeopleSupport) {
    await writeFile(
      path.join(outDir, "src", "core", "people.ts"),
      await renderTemplate("ts/src/core/people.ts.ejs", {
        graphTypes: peopleGraphTypes,
        labels: peopleLabelSerializers,
        graphEnums: buildGraphEnumTemplates(),
      }),
      "utf8"
    );
  }

  await writeFile(
    path.join(outDir, "src", schemaFolderName, "propertyTransformBase.ts"),
    await renderTemplate("ts/src/generated/propertyTransformBase.ts.ejs", {
      properties: transformProperties,
      usesPrincipal,
      peopleEntityTypes: Array.from(peopleEntityTypes),
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

  const contentValueExpression = ir.item.contentPropertyName
    ? "String((item as any)[contentPropertyName ?? \"\"] ?? \"\")"
    : "\"\"";
  await writeFile(
    path.join(outDir, "src", schemaFolderName, "itemPayload.ts"),
    await renderTemplate("ts/src/generated/itemPayload.ts.ejs", {
      properties: payloadProperties,
      peopleSerializers: Array.from(serializerImports),
      contentValueExpression,
      itemTypeName: ir.item.typeName,
      idEncoding: ir.item.idEncoding,
      usesPrincipal,
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
    case "principalCollection":
      return "Collection(microsoft.graph.externalConnectors.principal)";
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

function buildSourceLiteral(source: SourceDescriptor): string {
  if (source.jsonPath && source.jsonPath.trim().length > 0) {
    return JSON.stringify(source.jsonPath);
  }
  return JSON.stringify(source.csvHeaders);
}

function buildCsSourceLiteral(source: SourceDescriptor): string {
  if (source.jsonPath && source.jsonPath.trim().length > 0) {
    return JSON.stringify(source.jsonPath);
  }
  return `new[] { ${source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
}

type TsPersonEntityTypeInfo = {
  alias: string;
  properties: Map<string, string>;
};

type TsPersonEntityTypeMap = Map<string, TsPersonEntityTypeInfo>;

function buildTsPersonEntityExpression(
  fields: PersonEntityField[],
  valueExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `parseString(readSourceValue(row, ${sourceLiteral}))`,
  typeInfo: TsPersonEntityTypeInfo | null,
  typeMap: TsPersonEntityTypeMap
): string {
  const tree = buildObjectTree(fields);
  const indentUnit = "  ";
  const indentLines = (text: string, prefix: string): string =>
    text
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");

  const collectFields = (node: Record<string, unknown>): PersonEntityField[] => {
    const collected: PersonEntityField[] = [];
    const visit = (value: Record<string, unknown>): void => {
      for (const entry of Object.values(value)) {
        if (typeof entry === "object" && entry && "path" in (entry as PersonEntityField)) {
          collected.push(entry as PersonEntityField);
          continue;
        }
        if (typeof entry === "object" && entry && !Array.isArray(entry)) {
          visit(entry as Record<string, unknown>);
        }
      }
    };
    visit(node);
    return collected;
  };

  const renderNodeForCollection = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: TsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        return `${childIndent}${JSON.stringify(key)}: ${valueVar}`;
      }
      const propType = info?.properties.get(key) ?? null;
      const nestedType = propType && !propType.endsWith("[]") ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNodeForCollection(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${childIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  const renderNodeForCollectionMany = (
    node: Record<string, unknown>,
    info: TsPersonEntityTypeInfo | null,
    level: number,
    fieldVarByPath: Map<string, string>
  ): string => {
    const entryIndent = indentUnit.repeat(level);
    const closeIndent = indentUnit.repeat(Math.max(0, level - 1));
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        return `${entryIndent}${JSON.stringify(key)}: getValue(${varName}, index)`;
      }
      const propType = info?.properties.get(key) ?? null;
      const nestedType = propType && !propType.endsWith("[]") ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNodeForCollectionMany(value as Record<string, unknown>, nestedType, level + 1, fieldVarByPath);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${entryIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${closeIndent}}`;
  };

  const renderCollectionNode = (
    node: Record<string, unknown>,
    level: number,
    elementInfo: TsPersonEntityTypeInfo | null,
    elementType: string | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const bodyIndent = indentUnit.repeat(level + 1);
    const collected = collectFields(node);
    if (collected.length === 0) return "undefined";

    if (!elementInfo && elementType === "string") {
      const sourceLiteral = buildSourceLiteral(collected[0]!.source);
      return `(() => {\n${bodyIndent}const values = parseStringCollection(readSourceValue(row, ${sourceLiteral}));\n${bodyIndent}return values.length > 0 ? values : undefined;\n${indent}})()`;
    }

    if (collected.length === 1) {
      const field = collected[0]!;
      const sourceLiteral = buildSourceLiteral(field.source);
      const rendered = renderNodeForCollection(node, level + 1, "value", elementInfo);
      const typed = elementInfo ? `(${rendered} as ${elementInfo.alias})` : rendered;
      return `(() => {\n${bodyIndent}const values = parseStringCollection(readSourceValue(row, ${sourceLiteral}));\n${bodyIndent}if (values.length === 0) return undefined;\n${bodyIndent}return values.map((value) => ${typed});\n${indent}})()`;
    }

    const fieldVarByPath = new Map<string, string>();
    const fieldLines = collected.map((field, index) => {
      const varName = `field${index}`;
      fieldVarByPath.set(field.path, varName);
      const sourceLiteral = buildSourceLiteral(field.source);
      return `${bodyIndent}const ${varName} = parseStringCollection(readSourceValue(row, ${sourceLiteral}));`;
    });
    const fieldVars = [...fieldVarByPath.values()].join(", ");
    const lengthVars = fieldVars
      ? `${bodyIndent}const lengths = [${fieldVars}].map((value) => value.length);`
      : `${bodyIndent}const lengths = [0];`;
    const rendered = renderNodeForCollectionMany(node, elementInfo, level + 2, fieldVarByPath);
    const typed = elementInfo ? `(${rendered} as ${elementInfo.alias})` : rendered;

    return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n${bodyIndent}const maxLen = Math.max(0, ...lengths);\n${bodyIndent}if (maxLen === 0) return undefined;\n${bodyIndent}const getValue = (values: string[], index: number): string => {\n${bodyIndent}${indentUnit}if (values.length === 0) return "";\n${bodyIndent}${indentUnit}if (values.length === 1) return values[0] ?? "";\n${bodyIndent}${indentUnit}return values[index] ?? "";\n${bodyIndent}};\n${bodyIndent}const results: Array<${elementInfo ? elementInfo.alias : "unknown"}> = [];\n${bodyIndent}for (let index = 0; index < maxLen; index++) {\n${bodyIndent}${indentUnit}results.push(${typed});\n${bodyIndent}}\n${bodyIndent}return results;\n${indent}})()`;
  };

  const renderNode = (node: Record<string, unknown>, level: number, info: TsPersonEntityTypeInfo | null): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const sourceLiteral = buildSourceLiteral(field.source);
        return `${childIndent}${JSON.stringify(key)}: ${valueExpressionBuilder(sourceLiteral)}`;
      }

      const propType = info?.properties.get(key) ?? null;
      if (propType && propType.endsWith("[]")) {
        const elementType = propType.slice(0, -2);
        const elementInfo = typeMap.get(elementType) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, level + 1, elementInfo, elementType);
        return `${childIndent}${JSON.stringify(key)}: ${renderedCollection}`;
      }
      const nestedType = propType ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNode(value as Record<string, unknown>, level + 1, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${childIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  const rendered = renderNode(tree, 0, typeInfo);
  const typed = typeInfo ? `(${rendered} as ${typeInfo.alias})` : rendered;
  const typedIndented = indentLines(typed, indentUnit.repeat(3));
  return `JSON.stringify(\n${typedIndented}\n${indentUnit.repeat(2)})`;
}

function buildTsPersonEntityCollectionExpression(
  fields: PersonEntityField[],
  collectionExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `parseStringCollection(readSourceValue(row, ${sourceLiteral}))`,
  typeInfo: TsPersonEntityTypeInfo | null,
  typeMap: TsPersonEntityTypeMap
): string {
  const indentUnit = "  ";
  const bodyIndent = "      ";
  const closeIndent = "    ";
  const indentLines = (text: string, prefix: string): string =>
    text
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
  const renderNode = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: TsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        return `${childIndent}${JSON.stringify(key)}: ${valueVar}`;
      }
      const propType = info?.properties.get(key) ?? null;
      const nestedType = propType && !propType.endsWith("[]") ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNode(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${childIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  if (fields.length === 1) {
    const tree = buildObjectTree(fields);
    const field = fields[0]!;
    const sourceLiteral = buildSourceLiteral(field.source);
    const rendered = renderNode(tree, 0, "value", typeInfo);
    const typed = typeInfo ? `(${rendered} as ${typeInfo.alias})` : rendered;
    const typedIndented = indentLines(typed, indentUnit.repeat(4));

    return `${collectionExpressionBuilder(sourceLiteral)}
  ${indentUnit.repeat(2)}.map((value) => JSON.stringify(\n${typedIndented}\n${indentUnit.repeat(2)}))`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const sourceLiteral = buildSourceLiteral(field.source);
    return `${bodyIndent}const ${varName} = ${collectionExpressionBuilder(sourceLiteral)};`;
  });

  const renderNodeMany = (
    node: Record<string, unknown>,
    info: TsPersonEntityTypeInfo | null,
    level: number
  ): string => {
    const entryIndent = indentUnit.repeat(level);
    const closeIndent = indentUnit.repeat(Math.max(0, level - 1));
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        return `${entryIndent}${JSON.stringify(key)}: getValue(${varName}, index)`;
      }
      const propType = info?.properties.get(key) ?? null;
      const nestedType = propType && !propType.endsWith("[]") ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNodeMany(value as Record<string, unknown>, nestedType, level + 1);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${entryIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${closeIndent}}`;
  };

  const fieldVars = [...fieldVarByPath.values()].join(", ");
  const lengthVars = fieldVars
    ? `${bodyIndent}const lengths = [${fieldVars}].map((value) => value.length);`
    : `${bodyIndent}const lengths = [0];`;

  const renderedMany = renderNodeMany(tree, typeInfo, 1);
  const typedMany = typeInfo ? `(${renderedMany} as ${typeInfo.alias})` : renderedMany;
  const typedManyIndented = indentLines(typedMany, `${bodyIndent}${indentUnit}${indentUnit}`);

  return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n${bodyIndent}const maxLen = Math.max(0, ...lengths);\n${bodyIndent}const getValue = (values: string[], index: number): string => {\n${bodyIndent}${indentUnit}if (values.length === 0) return \"\";\n${bodyIndent}${indentUnit}if (values.length === 1) return values[0] ?? \"\";\n${bodyIndent}${indentUnit}return values[index] ?? \"\";\n${bodyIndent}};\n${bodyIndent}const results: string[] = [];\n${bodyIndent}for (let index = 0; index < maxLen; index++) {\n${bodyIndent}${indentUnit}results.push(JSON.stringify(\n${typedManyIndented}\n${bodyIndent}${indentUnit}));\n${bodyIndent}}\n${bodyIndent}return results;\n${closeIndent}})()`;
}

function buildPrincipalFieldEntries(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): Array<{ key: string; source: SourceDescriptor }> {
  if (fields && fields.length > 0) {
    return fields
      .map((field) => {
        const rawKey = field.path.split(".").pop() ?? field.path;
        const key = rawKey === "userPrincipalName" ? "upn" : rawKey;
        return {
          key,
          source: field.source,
        };
      })
      .filter((entry) => entry.key.length > 0);
  }

  if (fallbackSource.jsonPath || fallbackSource.csvHeaders.length > 0) {
    return [
      {
        key: "upn",
        source: fallbackSource,
      },
    ];
  }

  return [];
}

function buildTsPrincipalExpression(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource).map(
    (entry) =>
      `  ${JSON.stringify(entry.key)}: parseString(readSourceValue(row, ${buildSourceLiteral(entry.source)}))`
  );

  return `({\n  "@odata.type": "microsoft.graph.externalConnectors.principal"${entries.length ? ",\n" + entries.join(",\n") : ""}\n})`;
}

function buildCsPrincipalExpression(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource);
  const knownMap = new Map<string, string>([
    ["upn", "Upn"],
    ["userPrincipalName", "Upn"],
    ["tenantId", "TenantId"],
    ["externalName", "ExternalName"],
    ["externalId", "ExternalId"],
    ["entraDisplayName", "EntraDisplayName"],
    ["entraId", "EntraId"],
    ["email", "Email"],
  ]);

  const knownAssignments: string[] = [];
  const additionalDataEntries: string[] = [];

  for (const entry of entries) {
    const sourceLiteral = buildCsSourceLiteral(entry.source);
    const propertyName = knownMap.get(entry.key);
    if (propertyName) {
      knownAssignments.push(`    ${propertyName} = RowParser.ParseString(row, ${sourceLiteral}),`);
    } else {
      additionalDataEntries.push(`        [${JSON.stringify(entry.key)}] = RowParser.ParseString(row, ${sourceLiteral}),`);
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
    "    OdataType = \"microsoft.graph.externalConnectors.principal\",",
    ...knownAssignments,
    ...additionalDataBlock,
    "}"
  ].join("\n");
}

function buildTsPrincipalCollectionExpression(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource);
  if (entries.length === 0) return "[]";

  const fieldLines = entries.map(
    (entry, index) =>
      `  const field${index} = parseStringCollection(readSourceValue(row, ${buildSourceLiteral(entry.source)}));`
  );
  const lengthVars = entries.length
    ? `  const lengths = [${entries.map((_, index) => `field${index}.length`).join(", ")}];`
    : "  const lengths = [0];";

  const fieldsBlock = entries
    .map((entry, index) => `      ${JSON.stringify(entry.key)}: getValue(field${index}, index)`) 
    .join(",\n");

  return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n  const maxLen = Math.max(0, ...lengths);\n  const getValue = (values: string[], index: number): string => {\n    if (values.length === 0) return "";\n    if (values.length === 1) return values[0] ?? "";\n    return values[index] ?? "";\n  };\n  const results: Principal[] = [];\n  for (let index = 0; index < maxLen; index++) {\n    results.push({\n      "@odata.type": "microsoft.graph.externalConnectors.principal",\n${fieldsBlock}\n    });\n  }\n  return results;\n})()`;
}

function buildCsPrincipalCollectionExpression(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource);
  if (entries.length === 0) return "new List<Principal>()";

  const fieldLines = entries.map((entry, index) => {
    const sourceLiteral = buildCsSourceLiteral(entry.source);
    return `        var field${index} = RowParser.ParseStringCollection(row, ${sourceLiteral});`;
  });

  const knownMap = new Map<string, string>([
    ["upn", "Upn"],
    ["userPrincipalName", "Upn"],
    ["tenantId", "TenantId"],
    ["externalName", "ExternalName"],
    ["externalId", "ExternalId"],
    ["entraDisplayName", "EntraDisplayName"],
    ["entraId", "EntraId"],
    ["email", "Email"],
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
    "                OdataType = \"microsoft.graph.externalConnectors.principal\",",
    ...knownAssignments,
    ...additionalDataBlock,
    "            };",
    "            results.Add(principal);",
    "        }",
    "        return results;",
    "})()",
  ].join("\n");
}

type CsPersonEntityTypeInfo = {
  typeName: string;
  properties: Map<string, { csName: string; csType: string }>;
};

type CsPersonEntityTypeMap = Map<string, CsPersonEntityTypeInfo>;

function buildCsPersonEntityObjectExpression(
  fields: PersonEntityField[],
  fieldValueBuilder: (field: PersonEntityField) => string,
  typeInfo: CsPersonEntityTypeInfo | null,
  typeMap: CsPersonEntityTypeMap,
  indentLevel = 2
): string {
  const tree = buildObjectTree(fields);
  const indentUnit = "    ";

  const collectFields = (node: Record<string, unknown>): PersonEntityField[] => {
    const collected: PersonEntityField[] = [];
    const visit = (value: Record<string, unknown>): void => {
      for (const entry of Object.values(value)) {
        if (typeof entry === "object" && entry && "path" in (entry as PersonEntityField)) {
          collected.push(entry as PersonEntityField);
          continue;
        }
        if (typeof entry === "object" && entry && !Array.isArray(entry)) {
          visit(entry as Record<string, unknown>);
        }
      }
    };
    visit(node);
    return collected;
  };

  const extractListElementType = (csType: string): string | null => {
    const trimmed = csType.replace("?", "");
    const match = /^List<(.+)>$/.exec(trimmed);
    return match ? match[1]! : null;
  };

  const renderNodeForCollection = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: CsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        return `${childIndent}[${JSON.stringify(key)}] = ${valueVar}`;
      }
      const propType = info?.properties.get(key)?.csType ?? null;
      const nestedType = propType ? typeMap.get(propType.replace("?", "")) ?? null : null;
      const renderedChild = renderNodeForCollection(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      return `${childIndent}[${JSON.stringify(key)}] = ${renderedChild}`;
    });

    if (!info) {
      return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
    }

    const typedEntries = Object.entries(node).map(([key, value]) => {
      const propInfo = info.properties.get(key);
      if (!propInfo) {
        return null;
      }
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        return `${childIndent}${propInfo.csName} = ${valueVar}`;
      }
      const nestedType = typeMap.get(propInfo.csType.replace("?", "")) ?? null;
      const renderedChild = renderNodeForCollection(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      return `${childIndent}${propInfo.csName} = ${renderedChild}`;
    }).filter((entry): entry is string => Boolean(entry));

    return `new ${info.typeName}\n${indent}{\n${typedEntries.join(",\n")}\n${indent}}`;
  };

  const renderNodeForCollectionMany = (
    node: Record<string, unknown>,
    level: number,
    info: CsPersonEntityTypeInfo | null,
    fieldVarByPath: Map<string, string>
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        return `${childIndent}[${JSON.stringify(key)}] = GetValue(${varName}, index)`;
      }
      const propType = info?.properties.get(key)?.csType ?? null;
      const nestedType = propType ? typeMap.get(propType.replace("?", "")) ?? null : null;
      const renderedChild = renderNodeForCollectionMany(value as Record<string, unknown>, level + 1, nestedType, fieldVarByPath);
      return `${childIndent}[${JSON.stringify(key)}] = ${renderedChild}`;
    });

    if (!info) {
      return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
    }

    const typedEntries = Object.entries(node).map(([key, value]) => {
      const propInfo = info.properties.get(key);
      if (!propInfo) {
        return null;
      }
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        return `${childIndent}${propInfo.csName} = GetValue(${varName}, index)`;
      }
      const nestedType = typeMap.get(propInfo.csType.replace("?", "")) ?? null;
      const renderedChild = renderNodeForCollectionMany(value as Record<string, unknown>, level + 1, nestedType, fieldVarByPath);
      return `${childIndent}${propInfo.csName} = ${renderedChild}`;
    }).filter((entry): entry is string => Boolean(entry));

    return `new ${info.typeName}\n${indent}{\n${typedEntries.join(",\n")}\n${indent}}`;
  };

  const renderCollectionNode = (
    node: Record<string, unknown>,
    propCsType: string,
    level: number,
    elementInfo: CsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const bodyIndent = indentUnit.repeat(level + 1);
    const elementType = extractListElementType(propCsType) ?? "object";
    const collected = collectFields(node);
    if (collected.length === 0) return "null";

    if (!elementInfo && elementType === "string") {
      const sourceLiteral = buildCsSourceLiteral(collected[0]!.source);
      return `new Func<List<string>?>(() =>\n${indent}{\n${bodyIndent}var values = RowParser.ParseStringCollection(row, ${sourceLiteral});\n${bodyIndent}return values.Count == 0 ? null : values;\n${indent}}).Invoke()`;
    }

    if (collected.length === 1) {
      const field = collected[0]!;
      const sourceLiteral = buildCsSourceLiteral(field.source);
      const objectExpression = renderNodeForCollection(node, level + 2, "value", elementInfo);

      return `new Func<List<${elementType}>?>(() =>\n${indent}{\n${bodyIndent}var values = RowParser.ParseStringCollection(row, ${sourceLiteral});\n${bodyIndent}if (values.Count == 0) return null;\n${bodyIndent}var results = new List<${elementType}>();\n${bodyIndent}foreach (var value in values)\n${bodyIndent}{\n${bodyIndent}${indentUnit}results.Add(${objectExpression});\n${bodyIndent}}\n${bodyIndent}return results;\n${indent}}).Invoke()`;
    }

    const fieldVarByPath = new Map<string, string>();
    const fieldLines = collected.map((field, index) => {
      const varName = `field${index}`;
      fieldVarByPath.set(field.path, varName);
      const sourceLiteral = buildCsSourceLiteral(field.source);
      return `${bodyIndent}var ${varName} = RowParser.ParseStringCollection(row, ${sourceLiteral});`;
    });
    const fieldVars = [...fieldVarByPath.values()];
    const lengthLines = fieldVars.length > 0
      ? `${bodyIndent}var maxLen = new[] { ${fieldVars.map((v) => `${v}.Count`).join(", ")} }.Max();`
      : `${bodyIndent}var maxLen = 0;`;

    const objectExpression = renderNodeForCollectionMany(node, level + 1, elementInfo, fieldVarByPath);

    return `new Func<List<${elementType}>?>(() =>\n${indent}{\n${fieldLines.join("\n")}\n${bodyIndent}string GetValue(List<string> values, int index)\n${bodyIndent}{\n${bodyIndent}${indentUnit}if (values.Count == 0) return \"\";\n${bodyIndent}${indentUnit}if (values.Count == 1) return values[0] ?? \"\";\n${bodyIndent}${indentUnit}return index < values.Count ? (values[index] ?? \"\") : \"\";\n${bodyIndent}}\n${lengthLines}\n${bodyIndent}if (maxLen == 0) return null;\n${bodyIndent}var results = new List<${elementType}>();\n${bodyIndent}for (var index = 0; index < maxLen; index++)\n${bodyIndent}{\n${bodyIndent}${indentUnit}results.Add(${objectExpression});\n${bodyIndent}}\n${bodyIndent}return results;\n${indent}}).Invoke()`;
  };

  const renderDictionary = (
    node: Record<string, unknown>,
    level: number,
    parentInfo?: CsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        return `${childIndent}[${JSON.stringify(key)}] = ${fieldValueBuilder(field)}`;
      }
      const info = parentInfo?.properties.get(key);
      if (info && extractListElementType(info.csType)) {
        const elementTypeName = extractListElementType(info.csType) ?? "";
        const nestedType = typeMap.get(elementTypeName) ?? null;
        const renderedValue = renderCollectionNode(value as Record<string, unknown>, info.csType, level + 1, nestedType);
        return `${childIndent}[${JSON.stringify(key)}] = ${renderedValue}`;
      }
      const typeName = info?.csType.replace("?", "") ?? "";
      const nestedType = typeMap.get(typeName) ?? null;
      const renderedValue =
        info && nestedType && typeof value === "object" && value && !("path" in (value as PersonEntityField))
          ? renderTypedNode(value as Record<string, unknown>, nestedType, level + 1)
          : renderDictionary(value as Record<string, unknown>, level + 1, nestedType);
      return `${childIndent}[${JSON.stringify(key)}] = ${renderedValue}`;
    });

    return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
  };

  const renderTypedNode = (
    node: Record<string, unknown>,
    info: CsPersonEntityTypeInfo,
    level: number
  ): string => {
    const entries = Object.entries(node);
    const canUse = entries.every(([key]) => info.properties.has(key));
    if (!canUse) {
      return renderDictionary(node, level, info);
    }

    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const renderedEntries = entries.map(([key, value]) => {
      const propInfo = info.properties.get(key)!;
      const listElement = extractListElementType(propInfo.csType);
      if (listElement) {
        const nestedType = typeMap.get(listElement) ?? null;
        const renderedValue = renderCollectionNode(value as Record<string, unknown>, propInfo.csType, level + 1, nestedType);
        return `${childIndent}${propInfo.csName} = ${renderedValue}`;
      }
      const typeName = propInfo.csType.replace("?", "");
      const nestedType = typeMap.get(typeName) ?? null;
      const rawValue =
        typeof value === "object" && value && "path" in (value as PersonEntityField)
          ? fieldValueBuilder(value as PersonEntityField)
          : renderDictionary(value as Record<string, unknown>, level + 1, nestedType);
      const renderedValue =
        nestedType && typeof value === "object" && value && !("path" in (value as PersonEntityField))
          ? renderTypedNode(value as Record<string, unknown>, nestedType, level + 1)
          : rawValue;
      return `${childIndent}${propInfo.csName} = ${renderedValue}`;
    });

    return `new ${info.typeName}\n${indent}{\n${renderedEntries.join(",\n")}\n${indent}}`;
  };

  if (!typeInfo) {
    return renderDictionary(tree, indentLevel);
  }

  return renderTypedNode(tree, typeInfo, indentLevel);
}

function buildCsPersonEntityExpression(
  fields: PersonEntityField[],
  valueExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `RowParser.ParseString(row, ${sourceLiteral})`,
  typeInfo: CsPersonEntityTypeInfo | null,
  typeMap: CsPersonEntityTypeMap
): string {
  const indentUnit = "    ";
  const objectExpression = buildCsPersonEntityObjectExpression(
    fields,
    (field) => {
      const sourceLiteral = buildCsSourceLiteral(field.source);
      return valueExpressionBuilder(sourceLiteral);
    },
    typeInfo,
    typeMap,
    2
  );

  return `JsonSerializer.Serialize(\n${indentUnit.repeat(2)}${objectExpression}\n${indentUnit.repeat(2)})`;
}

function buildCsPersonEntityCollectionExpression(
  fields: PersonEntityField[],
  collectionExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `RowParser.ParseStringCollection(row, ${sourceLiteral})`,
  typeInfo: CsPersonEntityTypeInfo | null,
  typeMap: CsPersonEntityTypeMap,
  inputFormat: ConnectorIr["connection"]["inputFormat"]
): string {
  const indentUnit = "    ";

  const getCommonJsonArrayRoot = ():
    | { root: string; relativeByPath: Map<string, string> }
    | null => {
    const relativeByPath = new Map<string, string>();
    let root: string | null = null;
    for (const field of fields) {
      const jsonPath = field.source.jsonPath;
      if (!jsonPath) return null;
      const index = jsonPath.indexOf("[*]");
      if (index < 0) return null;
      const candidateRoot = jsonPath.slice(0, index + 3);
      if (root && root !== candidateRoot) return null;
      root = candidateRoot;
      const remainder = jsonPath.slice(index + 3);
      const relative = remainder.startsWith(".") ? remainder.slice(1) : remainder;
      relativeByPath.set(field.path, relative);
    }
    if (!root) return null;
    return { root, relativeByPath };
  };

  if (inputFormat !== "csv") {
    const common = getCommonJsonArrayRoot();
    if (common) {
      const objectExpression = buildCsPersonEntityObjectExpression(
        fields,
        (field) => {
          const relative = common.relativeByPath.get(field.path) ?? "";
          return relative
            ? `RowParser.ParseString(entry, ${JSON.stringify(relative)})`
            : "RowParser.ParseString(entry)";
        },
        typeInfo,
        typeMap,
        2
      );

      return `new Func<List<string>>(() =>\n    {\n        var results = new List<string>();\n        foreach (var entry in RowParser.ReadArrayEntries(row, ${JSON.stringify(common.root)}))\n        {\n            results.Add(JsonSerializer.Serialize(${objectExpression}));\n        }\n        return results;\n    }).Invoke()`;
    }
  }

  if (fields.length === 1) {
    const tree = buildObjectTree(fields);
    const field = fields[0]!;
    const sourceLiteral = buildCsSourceLiteral(field.source);
    const objectExpression = buildCsPersonEntityObjectExpression(
      fields,
      () => "value",
      typeInfo,
      typeMap,
      3
    );

    return `${collectionExpressionBuilder(sourceLiteral)}
                .Select(value => JsonSerializer.Serialize(\n${indentUnit.repeat(3)}${objectExpression}\n${indentUnit.repeat(3)}))
            .ToList()`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const sourceLiteral = buildCsSourceLiteral(field.source);
    return `        var ${varName} = ${collectionExpressionBuilder(sourceLiteral)};`;
  });

  const fieldVars = [...fieldVarByPath.values()];
  const lengthLines = fieldVars.length > 0
    ? `        var maxLen = new[] { ${fieldVars.map((v) => `${v}.Count`).join(", ")} }.Max();`
    : "        var maxLen = 0;";

  const objectExpression = buildCsPersonEntityObjectExpression(
    fields,
    (field) => {
      const varName = fieldVarByPath.get(field.path) ?? "";
      return `GetValue(${varName}, index)`;
    },
    typeInfo,
    typeMap,
    2
  );

  return `new Func<List<string>>(() =>\n    {\n${fieldLines.join("\n")}\n        string GetValue(List<string> values, int index)\n        {\n            if (values.Count == 0) return \"\";\n            if (values.Count == 1) return values[0] ?? \"\";\n            return index < values.Count ? (values[index] ?? \"\") : \"\";\n        }\n${lengthLines}\n        var results = new List<string>();\n        for (var index = 0; index < maxLen; index++)\n        {\n            results.Add(JsonSerializer.Serialize(${objectExpression}));\n        }\n        return results;\n    }).Invoke()`;
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
  sourceLiteral: string
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
      return `RowParser.ParseDateTime(Validation.ValidateString(${nameLiteral}, RowParser.ReadValue(row, ${sourceLiteral}), ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format}))`;
    case "stringCollection":
      return stringConstraints.hasAny
        ? `Validation.ValidateStringCollection(${nameLiteral}, ${expression}, ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format})`
        : expression;
    case "dateTimeCollection":
      if (!stringConstraints.hasAny) return expression;
        return `Validation.ValidateStringCollection(${nameLiteral}, RowParser.ParseStringCollection(RowParser.ReadValue(row, ${sourceLiteral})), ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format}).Select(value => RowParser.ParseDateTime(value)).ToList()`;
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

function buildRestConnectionPayload(ir: ConnectorIr): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: ir.connection.connectionId ?? "connection-id",
    name: ir.connection.connectionName ?? "Connector",
    description: ir.connection.connectionDescription ?? "Connector generated by cocogen",
  };
  if (ir.connection.contentCategory) {
    payload.contentCategory = ir.connection.contentCategory;
  }
  return payload;
}

function buildRestItemPayload(ir: ConnectorIr, itemId: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const prop of ir.properties) {
    if (prop.name === ir.item.contentPropertyName) continue;
    const exampleValue = exampleValueForPayload(prop.example, prop.type);
    if (prop.personEntity && prop.type !== "principal" && prop.type !== "principalCollection") {
      const isCollection = prop.type.endsWith("Collection");
      properties[prop.name] = buildSamplePersonEntityPayload(prop.personEntity.fields, isCollection);
    } else {
      const value =
        exampleValue ??
        samplePayloadValueForType(
          prop.type,
          prop.personEntity ? prop.personEntity.fields : null,
          prop.source
        );
      properties[prop.name] = value;
    }

    const odataType = toOdataCollectionType(prop.type);
    if (odataType) {
      properties[`${prop.name}@odata.type`] = odataType;
    }
  }

  const payload: Record<string, unknown> = {
    id: itemId,
    acl: [{ type: "everyone", value: "everyone", accessType: "grant" }],
    properties,
  };

  if (ir.item.contentPropertyName) {
    const contentProp = ir.properties.find((p) => p.name === ir.item.contentPropertyName);
    const exampleValue = contentProp ? exampleValueForPayload(contentProp.example, contentProp.type) : undefined;
    const value = exampleValue ?? "Sample content";
    payload.content = { type: "text", value: String(value) };
  }

  return payload;
}
type PeopleGraphFieldTemplate = {
  name: string;
  varName: string;
  tsType: string;
  optional: boolean;
  isCollection: boolean;
  typeCheck: string;
  expected: string;
  elementTypeCheck?: string | undefined;
  elementExpected?: string | undefined;
};

type PeopleGraphTypeTemplate = {
  alias: string;
  fields: PeopleGraphFieldTemplate[];
  baseAlias?: string;
};

type PeopleGraphTypeAlias = {
  tsAlias: string;
  csName: string;
};

type DerivedPeopleGraphType = {
  name: string;
  alias: string;
  csName: string;
  fields: PeopleGraphFieldTemplate[];
  csProperties: Array<{ name: string; csName: string; csType: string; nullable: boolean }>;
};

const GRAPH_STRING_TYPES = new Set<string>([
  "graph.emailType",
  "graph.phoneType",
  "graph.skillProficiencyLevel",
  "graph.personAnnualEventType",
  "graph.itemBody",
]);

const GRAPH_ENUM_TYPES = new Map<string, string[]>([
  [
    "personRelationship",
    [
      "manager",
      "colleague",
      "directReport",
      "dotLineReport",
      "assistant",
      "dotLineManager",
      "alternateContact",
      "friend",
      "spouse",
      "sibling",
      "child",
      "parent",
      "sponsor",
      "emergencyContact",
      "other",
      "unknownFutureValue",
    ],
  ],
]);

function resolveGraphTypeName(typeName: string): string | null {
  return typeName.startsWith("graph.") ? typeName.slice("graph.".length) : null;
}

type PeopleLabelSerializerTemplate = {
  label: string;
  serializerName: string;
  graphTypeAlias: string;
  isCollection: boolean;
  collectionLimit: number | null;
};

function buildDerivedPeopleGraphTypes(ir: ConnectorIr): DerivedPeopleGraphType[] {
  const fieldsByEntity = new Map<string, PersonEntityField[]>();
  for (const prop of ir.properties) {
    if (!prop.personEntity) continue;
    const list = fieldsByEntity.get(prop.personEntity.entity) ?? [];
    list.push(
      ...prop.personEntity.fields.map((field) => ({
        path: field.path,
        source: field.source,
      }))
    );
    fieldsByEntity.set(prop.personEntity.entity, list);
  }

  const schemaTypes = new Map(graphProfileSchema.types.map((type) => [type.name, type]));
  const derived = new Map<string, DerivedPeopleGraphType>();

  const buildDerivedFromTree = (
    typeName: string,
    node: Record<string, unknown>
  ): DerivedPeopleGraphType => {
    const existing = derived.get(typeName);
    if (existing) {
      const existingNames = new Set(existing.fields.map((field) => field.name));
      const usedVarNames = new Set(existing.fields.map((field) => field.varName));
      for (const [key, value] of Object.entries(node)) {
        if (existingNames.has(key)) {
          if (typeof value === "object" && value && !("path" in (value as PersonEntityField))) {
            const nestedName = `${typeName}${toCsPascal(key)}`;
            buildDerivedFromTree(nestedName, value as Record<string, unknown>);
          }
          continue;
        }

        const varName = toPeopleFieldVarName(key, usedVarNames);
        if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
          existing.fields.push({
            name: key,
            varName,
            tsType: "string",
            optional: true,
            isCollection: false,
            typeCheck: `typeof ${varName} === "string"`,
            expected: "a string",
          });
          existing.csProperties.push({
            name: key,
            csName: toCsPascal(key),
            csType: "string?",
            nullable: true,
          });
        } else {
          const nestedName = `${typeName}${toCsPascal(key)}`;
          const nested = buildDerivedFromTree(nestedName, value as Record<string, unknown>);
          existing.fields.push({
            name: key,
            varName,
            tsType: nested.alias,
            optional: true,
            isCollection: false,
            typeCheck: "isRecord(" + varName + ")",
            expected: "an object",
          });
          existing.csProperties.push({
            name: key,
            csName: toCsPascal(key),
            csType: `${nested.csName}?`,
            nullable: true,
          });
        }
        existingNames.add(key);
      }
      return existing;
    }

    const alias = toTsIdentifier(typeName);
    const csName = toCsPascal(typeName);
    const usedVarNames = new Set<string>();
    const fields: PeopleGraphFieldTemplate[] = [];
    const csProperties: Array<{ name: string; csName: string; csType: string; nullable: boolean }> = [];

    for (const [key, value] of Object.entries(node)) {
      const varName = toPeopleFieldVarName(key, usedVarNames);
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        fields.push({
          name: key,
          varName,
          tsType: "string",
          optional: true,
          isCollection: false,
          typeCheck: `typeof ${varName} === "string"`,
          expected: "a string",
        });
        csProperties.push({
          name: key,
          csName: toCsPascal(key),
          csType: "string?",
          nullable: true,
        });
      } else {
        const nestedName = `${typeName}${toCsPascal(key)}`;
        const nested = buildDerivedFromTree(nestedName, value as Record<string, unknown>);
        fields.push({
          name: key,
          varName,
          tsType: nested.alias,
          optional: true,
          isCollection: false,
          typeCheck: "isRecord(" + varName + ")",
          expected: "an object",
        });
        csProperties.push({
          name: key,
          csName: toCsPascal(key),
          csType: `${nested.csName}?`,
          nullable: true,
        });
      }
    }

    const created: DerivedPeopleGraphType = {
      name: typeName,
      alias,
      csName,
      fields,
      csProperties,
    };
    derived.set(typeName, created);
    return created;
  };

  for (const [entity, fields] of fieldsByEntity) {
    const tree = buildObjectTree(fields);
    const schemaType = schemaTypes.get(entity);
    if (!schemaType) {
      buildDerivedFromTree(entity, tree);
      continue;
    }

    for (const prop of schemaType.properties ?? []) {
      const propType = prop.type;
      const graphName = resolveGraphTypeName(propType);
      const isCollection = /^Collection\(/.test(propType);
      const node = tree[prop.name];
      if (!graphName || isCollection || GRAPH_STRING_TYPES.has(propType) || GRAPH_ENUM_TYPES.has(graphName)) continue;
      if (schemaTypes.has(graphName)) continue;
      if (!node || typeof node !== "object") continue;
      buildDerivedFromTree(graphName, node as Record<string, unknown>);
    }
  }

  const referencedGraphTypes = new Set<string>();
  for (const schemaType of graphProfileSchema.types) {
    for (const prop of schemaType.properties ?? []) {
      const collectionMatch = /^Collection\((.+)\)$/.exec(prop.type);
      const elementType = collectionMatch ? collectionMatch[1]! : prop.type;
      if (GRAPH_STRING_TYPES.has(elementType)) continue;
      const graphName = resolveGraphTypeName(elementType);
      if (!graphName) continue;
      if (GRAPH_ENUM_TYPES.has(graphName)) continue;
      if (schemaTypes.has(graphName)) continue;
      if (derived.has(graphName)) continue;
      referencedGraphTypes.add(graphName);
    }
  }

  for (const graphName of referencedGraphTypes) {
    buildDerivedFromTree(graphName, {});
  }

  return [...derived.values()];
}

function buildPeopleGraphTypeAliases(
  derived: DerivedPeopleGraphType[]
): Map<string, PeopleGraphTypeAlias> {
  const map = new Map<string, PeopleGraphTypeAlias>();
  for (const type of graphProfileSchema.types) {
    map.set(type.name, {
      tsAlias: toTsIdentifier(type.name),
      csName: toCsPascal(type.name),
    });
  }
  for (const type of derived) {
    map.set(type.name, { tsAlias: type.alias, csName: type.csName });
  }
  return map;
}

function buildPeopleGraphTypes(ir: ConnectorIr): {
  templates: PeopleGraphTypeTemplate[];
  derived: DerivedPeopleGraphType[];
  aliases: Map<string, PeopleGraphTypeAlias>;
} {
  const graphTypeNames = new Set<string>();
  for (const def of PEOPLE_LABEL_DEFINITIONS.values()) {
    graphTypeNames.add(def.graphTypeName);
  }
  graphTypeNames.add("itemFacet");

  let added = true;
  while (added) {
    added = false;
    for (const name of [...graphTypeNames]) {
      const schemaType = getProfileType(name);
      if (!schemaType?.baseType) continue;
      if (!graphTypeNames.has(schemaType.baseType)) {
        graphTypeNames.add(schemaType.baseType);
        added = true;
      }
    }
  }

  const schemaTypeByName = new Map(graphProfileSchema.types.map((type) => [type.name, type]));
  const resolveReferencedGraphType = (propType: string): string | null => {
    const collectionMatch = /^Collection\((.+)\)$/.exec(propType);
    const elementType = collectionMatch ? collectionMatch[1]! : propType;
    if (GRAPH_STRING_TYPES.has(elementType)) return null;
    if (elementType.startsWith("Edm.")) return null;
    const graphName = resolveGraphTypeName(elementType);
    return graphName && schemaTypeByName.has(graphName) ? graphName : null;
  };

  let addedReference = true;
  while (addedReference) {
    addedReference = false;
    for (const name of [...graphTypeNames]) {
      const schemaType = schemaTypeByName.get(name);
      if (!schemaType) continue;
      for (const prop of schemaType.properties ?? []) {
        const referenced = resolveReferencedGraphType(prop.type);
        if (!referenced) continue;
        if (graphTypeNames.has(referenced)) continue;
        graphTypeNames.add(referenced);
        addedReference = true;
      }
    }
  }

  const derived = buildDerivedPeopleGraphTypes(ir);
  const aliases = buildPeopleGraphTypeAliases(derived);

  const templates = [...graphTypeNames].map((typeName) => {
    const schemaType = getProfileType(typeName);
    if (!schemaType) {
      throw new Error(`Graph profile schema is missing type '${typeName}'. Run npm run update-graph-profile-schema.`);
    }
    const usedVarNames = new Set<string>();
    const fields = (schemaType.properties ?? []).map((prop) =>
      convertGraphProperty(prop, usedVarNames, aliases)
    );
    return {
      alias: toTsIdentifier(typeName),
      fields,
      ...(schemaType.baseType ? { baseAlias: toTsIdentifier(schemaType.baseType) } : {}),
    };
  });

  for (const type of derived) {
    templates.push({
      alias: type.alias,
      fields: type.fields,
    });
  }

  return { templates, derived, aliases };
}

function buildPeopleLabelSerializers(): PeopleLabelSerializerTemplate[] {
  return [...PEOPLE_LABEL_DEFINITIONS.entries()].map(([label, def]) => ({
    label,
    serializerName: `serialize${toTsIdentifier(label)}`,
    graphTypeAlias: toTsIdentifier(def.graphTypeName),
    isCollection: def.payloadTypes.includes("stringCollection"),
    collectionLimit: def.constraints.collectionLimit ?? null,
  }));
}

function buildGraphEnumTemplates(): Array<{ name: string; tsName: string; csName: string; values: string[] }> {
  return [...GRAPH_ENUM_TYPES.entries()].map(([name, values]) => ({
    name,
    tsName: toTsIdentifier(name),
    csName: toCsPascal(name),
    values: [...values],
  }));
}

function convertGraphProperty(
  prop: GraphProfileProperty,
  usedVarNames: Set<string>,
  graphAliases: Map<string, PeopleGraphTypeAlias>
): PeopleGraphFieldTemplate {
  const descriptor = parseGraphTypeDescriptor(prop.type, graphAliases);
  const varName = toPeopleFieldVarName(prop.name, usedVarNames);
  const typeCheck = descriptor.typeCheck.replaceAll("value", varName);
  return {
    name: prop.name,
    varName,
    tsType: descriptor.tsType,
    optional: prop.nullable !== false,
    isCollection: descriptor.isCollection,
    typeCheck,
    expected: descriptor.expected,
    elementTypeCheck: descriptor.elementTypeCheck,
    elementExpected: descriptor.elementExpected,
  };
}

type GraphTypeDescriptor = {
  tsType: string;
  isCollection: boolean;
  typeCheck: string;
  expected: string;
  elementTypeCheck?: string;
  elementExpected?: string;
};

type ScalarTypeDescriptor = {
  tsType: string;
  expected: string;
  check: (varName: string) => string;
};

function parseGraphTypeDescriptor(
  typeName: string,
  graphAliases: Map<string, PeopleGraphTypeAlias>
): GraphTypeDescriptor {
  const collectionMatch = /^Collection\((.+)\)$/.exec(typeName);
  if (collectionMatch) {
    const elementType = collectionMatch[1]!;
    const elementGraphName = resolveGraphTypeName(elementType);
    if (elementGraphName && GRAPH_ENUM_TYPES.has(elementGraphName)) {
      const alias = toTsIdentifier(elementGraphName);
      return {
        tsType: `${alias}[]`,
        isCollection: true,
        typeCheck: "Array.isArray(value)",
        expected: "an array",
        elementTypeCheck: `is${alias}(entry)`,
        elementExpected: `${elementGraphName} value`,
      };
    }
    if (GRAPH_STRING_TYPES.has(elementType)) {
      return {
        tsType: "string[]",
        isCollection: true,
        typeCheck: "Array.isArray(value)",
        expected: "an array",
        elementTypeCheck: `typeof entry === "string"`,
        elementExpected: "a string",
      };
    }
    const graphName = resolveGraphTypeName(elementType);
    if (graphName && graphAliases.has(graphName)) {
      const alias = graphAliases.get(graphName)!.tsAlias;
      return {
        tsType: `${alias}[]`,
        isCollection: true,
        typeCheck: "Array.isArray(value)",
        expected: "an array",
        elementTypeCheck: "isRecord(entry)",
        elementExpected: "an object",
      };
    }
    const element = getScalarDescriptor(elementType);
    return {
      tsType: `${element.tsType}[]`,
      isCollection: true,
      typeCheck: "Array.isArray(value)",
      expected: "an array",
      elementTypeCheck: element.check("entry"),
      elementExpected: element.expected,
    };
  }
  if (GRAPH_STRING_TYPES.has(typeName)) {
    return {
      tsType: "string",
      isCollection: false,
      typeCheck: `typeof value === "string"`,
      expected: "a string",
    };
  }
  const enumName = resolveGraphTypeName(typeName);
  if (enumName && GRAPH_ENUM_TYPES.has(enumName)) {
    const alias = toTsIdentifier(enumName);
    return {
      tsType: alias,
      isCollection: false,
      typeCheck: `is${alias}(value)`,
      expected: `${enumName} value`,
    };
  }
  const graphName = resolveGraphTypeName(typeName);
  if (graphName && graphAliases.has(graphName)) {
    const alias = graphAliases.get(graphName)!.tsAlias;
    return {
      tsType: alias,
      isCollection: false,
      typeCheck: "isRecord(value)",
      expected: "an object",
    };
  }
  const scalar = getScalarDescriptor(typeName);
  return {
    tsType: scalar.tsType,
    isCollection: false,
    typeCheck: scalar.check("value"),
    expected: scalar.expected,
  };
}

function getScalarDescriptor(typeName: string): ScalarTypeDescriptor {
  switch (typeName) {
    case "Edm.String":
    case "Edm.Date":
    case "Edm.DateTimeOffset":
    case "Edm.TimeOfDay":
      return {
        tsType: "string",
        expected: "a string",
        check: (varName) => `typeof ${varName} === "string"`,
      };
    case "Edm.Boolean":
      return {
        tsType: "boolean",
        expected: "a boolean",
        check: (varName) => `typeof ${varName} === "boolean"`,
      };
    case "Edm.Int32":
    case "Edm.Int64":
    case "Edm.Double":
      return {
        tsType: "number",
        expected: "a number",
        check: (varName) => `typeof ${varName} === "number" && Number.isFinite(${varName})`,
      };
    default:
      throw new Error(`Unsupported Graph scalar type '${typeName}'. Update getScalarDescriptor to map this type.`);
  }
}

function toPeopleFieldVarName(name: string, used: Set<string>): string {
  const identifier = toTsIdentifier(name);
  const base = identifier.length > 0 ? identifier[0]!.toLowerCase() + identifier.slice(1) : "value";
  let candidate = base || "value";
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
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
  const peopleLabelDefinitions = supportedPeopleLabels().map((label) => {
    const info = getPeopleLabelInfo(label);
    return {
      label: info.label,
      payloadType: info.payloadType,
      graphTypeName: info.graphTypeName,
      requiredFields: info.requiredFields,
      collectionLimit: info.collectionLimit ?? null,
    };
  });
  const peopleGraphTypesBundle = buildPeopleGraphTypes(ir);
  const graphAliases = peopleGraphTypesBundle.aliases;

  const resolveCsType = (rawType: string): { csType: string; isCollection: boolean } => {
    const collectionMatch = /^Collection\((.+)\)$/.exec(rawType);
    if (collectionMatch) {
      const elementType = collectionMatch[1]!;
      if (GRAPH_STRING_TYPES.has(elementType)) {
        return { csType: "List<string>", isCollection: true };
      }
      const enumGraphName = resolveGraphTypeName(elementType);
      if (enumGraphName && GRAPH_ENUM_TYPES.has(enumGraphName)) {
        return { csType: `List<${toCsPascal(enumGraphName)}>`, isCollection: true };
      }
      const graphName = resolveGraphTypeName(elementType);
      if (graphName && graphAliases.has(graphName)) {
        const alias = graphAliases.get(graphName)!.csName;
        return { csType: `List<${alias}>`, isCollection: true };
      }
      const element = (() => {
        switch (elementType) {
          case "Edm.String":
            return "string";
          case "Edm.Date":
            return "string";
          case "Edm.Int32":
            return "int";
          case "Edm.Int64":
            return "long";
          case "Edm.Double":
            return "double";
          case "Edm.Boolean":
            return "bool";
          case "Edm.DateTimeOffset":
            return "DateTimeOffset";
          default:
            throw new Error(`Unsupported Graph scalar type '${elementType}'. Update resolveCsType to map this type.`);
        }
      })();
      return { csType: `List<${element}>`, isCollection: true };
    }

    if (GRAPH_STRING_TYPES.has(rawType)) {
      return { csType: "string", isCollection: false };
    }

    const enumGraphName = resolveGraphTypeName(rawType);
    if (enumGraphName && GRAPH_ENUM_TYPES.has(enumGraphName)) {
      return { csType: toCsPascal(enumGraphName), isCollection: false };
    }

    const graphName = resolveGraphTypeName(rawType);
    if (graphName && graphAliases.has(graphName)) {
      return { csType: graphAliases.get(graphName)!.csName, isCollection: false };
    }

    switch (rawType) {
      case "Edm.String":
        return { csType: "string", isCollection: false };
      case "Edm.Date":
        return { csType: "string", isCollection: false };
      case "Edm.Int32":
        return { csType: "int", isCollection: false };
      case "Edm.Int64":
        return { csType: "long", isCollection: false };
      case "Edm.Double":
        return { csType: "double", isCollection: false };
      case "Edm.Boolean":
        return { csType: "bool", isCollection: false };
      case "Edm.DateTimeOffset":
        return { csType: "DateTimeOffset", isCollection: false };
      default:
        throw new Error(`Unsupported Graph scalar type '${rawType}'. Update resolveCsType to map this type.`);
    }
  };

  const baseProfileTypes = graphProfileSchema.types.map((type) => {
    const properties = type.properties.map((prop) => {
      const resolved = resolveCsType(prop.type);
      const resolvedType = resolved.csType;
      const isValueType = ["int", "long", "double", "bool", "DateTimeOffset"].includes(resolvedType);
      const nullable = prop.nullable || !isValueType;
      const nullableSuffix = nullable ? "?" : "";
      return {
        name: prop.name,
        csName: toCsPascal(prop.name),
        csType: `${resolvedType}${nullableSuffix}`,
        nullable,
      };
    });
    return {
      name: type.name,
      csName: toCsPascal(type.name),
      baseType: type.baseType ? toCsPascal(type.baseType) : null,
      properties,
    };
  });
  const derivedProfileTypes = peopleGraphTypesBundle.derived.map((type) => ({
    name: type.name,
    csName: type.csName,
    baseType: null,
    properties: type.csProperties.map((prop) => ({
      name: prop.name,
      csName: prop.csName,
      csType: prop.csType,
      nullable: prop.nullable,
    })),
  }));
  const peopleProfileTypes = [...baseProfileTypes, ...derivedProfileTypes].sort((a, b) => {
    if (a.csName === "ItemFacet") return -1;
    if (b.csName === "ItemFacet") return 1;
    return a.csName.localeCompare(b.csName);
  });
  const baseTypeNames = new Set(
    peopleProfileTypes.map((type) => type.baseType).filter((name): name is string => Boolean(name))
  );
  const schemaBaseTypeByName = new Map(
    graphProfileSchema.types.map((type) => [type.name, type.baseType])
  );
  const isItemFacetType = (typeName: string): boolean => {
    if (typeName === "itemFacet") return true;
    let current = schemaBaseTypeByName.get(typeName);
    while (current) {
      if (current === "itemFacet") return true;
      current = schemaBaseTypeByName.get(current);
    }
    return false;
  };
  const itemFacetTypeNames = graphProfileSchema.types
    .map((type) => type.name)
    .filter((typeName) => isItemFacetType(typeName));
  const peopleProfileTypeInfoByName = new Map(
    peopleProfileTypes.map((type) => [
      type.csName,
      {
        typeName: type.csName,
        properties: new Map(type.properties.map((prop) => [prop.name, { csName: prop.csName, csType: prop.csType }]))
      } satisfies CsPersonEntityTypeInfo,
    ])
  );
  const peopleProfileTypeByName = new Map(
    peopleProfileTypes.map((type) => [type.name, type])
  );
  const itemTypeName = toCsIdentifier(ir.item.typeName);
  const properties = ir.properties.map((p) => {
    const parseFn = toCsParseFunction(p.type);
    const sourceLiteral = buildCsSourceLiteral(p.source);
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
    const personEntityType = personEntity ? peopleProfileTypeByName.get(personEntity.entity) : null;
    const personEntityTypeInfo = personEntityType
      ? {
          typeName: personEntityType.csName,
          properties: new Map(
            personEntityType.properties.map((prop) => [prop.name, { csName: prop.csName, csType: prop.csType }])
          ),
        }
      : null;
    const isPeopleLabel = p.labels.some((label) => label.startsWith("person"));
    const needsManualEntity = isPeopleLabel && !p.personEntity;
    const noSource = Boolean(p.source.noSource);
    const principalExpression =
      p.type === "principal"
        ? buildCsPrincipalExpression(p.personEntity?.fields ?? null, p.source)
        : p.type === "principalCollection"
        ? buildCsPrincipalCollectionExpression(p.personEntity?.fields ?? null, p.source)
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
          }, personEntityTypeInfo, peopleProfileTypeInfoByName, ir.connection.inputFormat)
        : buildCsPersonEntityExpression(personEntity.fields, (headersLiteral) => {
            const base = `RowParser.ParseString(row, ${headersLiteral})`;
            return csStringConstraints.hasAny
              ? `Validation.ValidateString(${nameLiteral}, ${base}, ${csStringConstraints.minLength}, ${csStringConstraints.maxLength}, ${csStringConstraints.pattern}, ${csStringConstraints.format})`
              : base;
          }, personEntityTypeInfo, peopleProfileTypeInfoByName)
      : `${parseFn}(row, ${sourceLiteral})`;

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
      : applyCsValidationExpression(validationMetadata, transformExpression, sourceLiteral);

    return {
      name: p.name,
      csName: toCsPropertyName(p.name, itemTypeName, usedPropertyNames),
      csType: toCsType(p.type),
      csvHeaders: p.source.csvHeaders,
      csvHeadersLiteral: sourceLiteral,
      isCollection,
      source: p.source,
      personEntity,
      parseFn,
      transformExpression: validatedExpression,
      transformThrows: needsManualEntity,
      graphTypeEnumName: toGraphPropertyTypeEnumName(p.type),
      description: p.description,
      doc: p.doc,
      labels: p.labels,
      peopleLabel: p.labels.find((label) => label.startsWith("person")) ?? null,
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
  const idRawSourceDotnet =
    itemIdProperty?.personEntity?.fields[0]?.source ?? itemIdProperty?.source;
  const idRawExpressionDotnet = idRawSourceDotnet
    ? `RowParser.ParseString(row, ${buildCsSourceLiteral(idRawSourceDotnet)})`
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
      let valueExpression = toCsPropertyValueExpression(p.type, p.csName);
      if (p.peopleLabel) {
        const labelLiteral = JSON.stringify(p.peopleLabel);
        const propertyLiteral = JSON.stringify(p.name);
        if (p.type === "string") {
          valueExpression = `PeoplePayload.SerializeStringLabel(${labelLiteral}, item.${p.csName}, ${propertyLiteral})`;
        } else if (p.type === "stringCollection") {
          valueExpression = `PeoplePayload.SerializeCollectionLabel(${labelLiteral}, item.${p.csName}, ${propertyLiteral})`;
        }
      }
      lines.push(`                { ${JSON.stringify(p.name)}, ${valueExpression} },`);
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
  const usesPeopleLabels = properties.some((p) => p.peopleLabel);

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
      inputFormat: ir.connection.inputFormat,
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
      inputFormat: ir.connection.inputFormat,
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
    path.join(outDir, "Core", "IItemPayload.cs"),
    await renderTemplate("dotnet/Core/IItemPayload.cs.ejs", {
      namespaceName,
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

  if (usesPeopleLabels) {
    await writeFile(
      path.join(outDir, "Core", "PeoplePayload.cs"),
      await renderTemplate("dotnet/Core/PeoplePayload.cs.ejs", {
        namespaceName,
        peopleLabelDefinitions,
        peopleProfileTypes,
        baseTypeNames,
        itemFacetTypeNames,
        graphEnums: buildGraphEnumTemplates(),
        itemFacetReadOnlyFields: [
          "id",
          "createdBy",
          "createdDateTime",
          "lastModifiedBy",
          "lastModifiedDateTime",
          "source",
          "sources",
        ],
      }),
      "utf8"
    );
  }

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

async function writeRestFiles(outDir: string, ir: ConnectorIr): Promise<void> {
  const connectionId = ir.connection.connectionId ?? "connection-id";
  const connectionPayloadJson = JSON.stringify(buildRestConnectionPayload(ir), null, 2);
  const schemaPayloadJson = JSON.stringify(schemaPayload(ir), null, 2);

  const idProp = ir.properties.find((p) => p.name === ir.item.idPropertyName);
  const idExample = idProp ? exampleValueForPayload(idProp.example, idProp.type) : undefined;
  const itemId =
    typeof idExample === "string"
      ? idExample
      : Array.isArray(idExample)
      ? String(idExample[0] ?? "sample-id")
      : idExample !== undefined && idExample !== null
      ? String(idExample)
      : "sample-id";

  const itemPayloadJson = JSON.stringify(buildRestItemPayload(ir, itemId), null, 2);

  await writeFile(
    path.join(outDir, "create-connection.http"),
    await renderTemplate("rest/create-connection.http.ejs", {
      graphBaseUrl: graphBaseUrl(ir),
      connectionId,
      connectionPayloadJson,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "patch-schema.http"),
    await renderTemplate("rest/patch-schema.http.ejs", {
      graphBaseUrl: graphBaseUrl(ir),
      connectionId,
      schemaPayloadJson,
    }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "ingest-item.http"),
    await renderTemplate("rest/ingest-item.http.ejs", {
      graphBaseUrl: graphBaseUrl(ir),
      connectionId,
      itemId,
      itemPayloadJson,
    }),
    "utf8"
  );

  if (ir.connection.contentCategory === "people") {
    const profileSourceWebUrl = ir.connection.profileSource?.webUrl ?? "https://example.com/people";
    const profileSourceDisplayName =
      ir.connection.profileSource?.displayName ?? ir.connection.connectionName ?? ir.item.typeName;
    const profileSourcePriority = ir.connection.profileSource?.priority ?? "first";

    await writeFile(
      path.join(outDir, "profile-source.http"),
      await renderTemplate("rest/profile-source.http.ejs", {
        graphBaseUrl: graphBaseUrl(ir),
        connectionId,
        profileSourceWebUrl,
        profileSourceDisplayName,
        profileSourcePriority,
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

  const ir = await loadIrFromTypeSpec(tspPath, { inputFormat: config.inputFormat });
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  await updateSchemaCopy(outDir, tspPath);

  const schemaFolderName = toTsSchemaFolderName(ir.connection.connectionName);
  await writeGeneratedTs(outDir, ir, schemaFolderName);
  if (options.tspPath) {
    await writeFile(
      path.join(outDir, COCOGEN_CONFIG_FILE),
      projectConfigContents(outDir, tspPath, "ts", config.inputFormat),
      "utf8"
    );
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

  const ir = await loadIrFromTypeSpec(tspPath, { inputFormat: config.inputFormat });
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  await updateSchemaCopy(outDir, tspPath);

  const namespaceName = toCsNamespace(path.basename(outDir));
  const schemaFolderName = toSchemaFolderName(ir.connection.connectionName);
  const schemaNamespace = `${namespaceName}.${schemaFolderName}`;
  await writeGeneratedDotnet(outDir, ir, namespaceName, schemaFolderName, schemaNamespace);
  if (options.tspPath) {
    await writeFile(
      path.join(outDir, COCOGEN_CONFIG_FILE),
      projectConfigContents(outDir, tspPath, "dotnet", config.inputFormat),
      "utf8"
    );
  }

  return { outDir, ir };
}

export async function updateRestProject(options: UpdateOptions): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  const { config } = await loadProjectConfig(outDir);
  const tspPath = options.tspPath ? path.resolve(options.tspPath) : path.resolve(outDir, config.tsp);

  if (config.lang !== "rest") {
    throw new Error(`This project is '${config.lang}'. Use cocogen generate/update for that language.`);
  }

  const ir = await loadIrFromTypeSpec(tspPath, { inputFormat: config.inputFormat });
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  await updateSchemaCopy(outDir, tspPath);

  await writeRestFiles(outDir, ir);
  if (options.tspPath) {
    await writeFile(
      path.join(outDir, COCOGEN_CONFIG_FILE),
      projectConfigContents(outDir, tspPath, "rest", config.inputFormat),
      "utf8"
    );
  }

  return { outDir, ir };
}

export async function updateProject(options: UpdateOptions): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  const { config } = await loadProjectConfig(outDir);
  if (config.lang === "dotnet") {
    return updateDotnetProject(options);
  }
  if (config.lang === "rest") {
    return updateRestProject(options);
  }
  return updateTsProject(options);
}

export async function initRestProject(options: InitOptions): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  await ensureEmptyDir(outDir, Boolean(options.force));

  const ir = await loadIrFromTypeSpec(options.tspPath, { inputFormat: options.inputFormat });
  if (ir.connection.graphApiVersion === "beta" && !options.usePreviewFeatures) {
    throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
  }
  const validationMessage = formatValidationErrors(ir);
  if (validationMessage) {
    throw new Error(`Schema validation failed:\n${validationMessage}`);
  }

  const copiedTspPath = path.join(outDir, "schema.tsp");
  await copyFile(path.resolve(options.tspPath), copiedTspPath);
  await writeFile(
    path.join(outDir, COCOGEN_CONFIG_FILE),
    projectConfigContents(outDir, copiedTspPath, "rest", ir.connection.inputFormat),
    "utf8"
  );

  await writeRestFiles(outDir, ir);
  return { outDir, ir };
}

export async function initTsProject(options: InitOptions): Promise<{ outDir: string; ir: ConnectorIr }> {
  const outDir = path.resolve(options.outDir);
  await ensureEmptyDir(outDir, Boolean(options.force));

  const ir = await loadIrFromTypeSpec(options.tspPath, { inputFormat: options.inputFormat });
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
      inputFormat: ir.connection.inputFormat,
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
      inputFormat: ir.connection.inputFormat,
    }),
    "utf8"
  );
  const copiedTspPath = path.join(outDir, "schema.tsp");
  await copyFile(path.resolve(options.tspPath), copiedTspPath);
  await writeFile(
    path.join(outDir, COCOGEN_CONFIG_FILE),
    projectConfigContents(outDir, copiedTspPath, "ts", ir.connection.inputFormat),
    "utf8"
  );

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
      inputFormat: ir.connection.inputFormat,
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
  if (ir.connection.inputFormat === "json") {
    await writeFile(
      path.join(outDir, "src", "datasource", "jsonItemSource.ts"),
      await renderTemplate("ts/src/datasource/jsonItemSource.ts.ejs", {
        itemTypeName: ir.item.typeName,
        schemaFolderName,
      }),
      "utf8"
    );
  } else if (ir.connection.inputFormat === "yaml") {
    await writeFile(
      path.join(outDir, "src", "datasource", "yamlItemSource.ts"),
      await renderTemplate("ts/src/datasource/yamlItemSource.ts.ejs", {
        itemTypeName: ir.item.typeName,
        schemaFolderName,
      }),
      "utf8"
    );
  } else if (ir.connection.inputFormat === "custom") {
    await writeFile(
      path.join(outDir, "src", "datasource", "customItemSource.ts"),
      await renderTemplate("ts/src/datasource/customItemSource.ts.ejs", {
        itemTypeName: ir.item.typeName,
        schemaFolderName,
      }),
      "utf8"
    );
  } else {
    await writeFile(
      path.join(outDir, "src", "datasource", "csvItemSource.ts"),
      await renderTemplate("ts/src/datasource/csvItemSource.ts.ejs", {
        itemTypeName: ir.item.typeName,
        schemaFolderName,
      }),
      "utf8"
    );
  }

  if (ir.connection.inputFormat === "json") {
    await writeFile(path.join(outDir, "data.json"), buildSampleJson(ir), "utf8");
  } else if (ir.connection.inputFormat === "yaml") {
    await writeFile(path.join(outDir, "data.yaml"), buildSampleYaml(ir), "utf8");
  } else if (ir.connection.inputFormat === "csv") {
    await writeFile(path.join(outDir, "data.csv"), buildSampleCsv(ir), "utf8");
  }

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

  const ir = await loadIrFromTypeSpec(options.tspPath, { inputFormat: options.inputFormat });
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
      inputFormat: ir.connection.inputFormat,
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
      inputFormat: ir.connection.inputFormat,
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
  if (ir.connection.inputFormat === "json") {
    await writeFile(
      path.join(outDir, "Datasource", "JsonItemSource.cs"),
      await renderTemplate("dotnet/Datasource/JsonItemSource.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: ir.item.typeName,
      }),
      "utf8"
    );
  } else if (ir.connection.inputFormat === "yaml") {
    await writeFile(
      path.join(outDir, "Datasource", "YamlItemSource.cs"),
      await renderTemplate("dotnet/Datasource/YamlItemSource.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: ir.item.typeName,
      }),
      "utf8"
    );
  } else if (ir.connection.inputFormat === "custom") {
    await writeFile(
      path.join(outDir, "Datasource", "CustomItemSource.cs"),
      await renderTemplate("dotnet/Datasource/CustomItemSource.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: ir.item.typeName,
      }),
      "utf8"
    );
  } else {
    await writeFile(
      path.join(outDir, "Datasource", "CsvItemSource.cs"),
      await renderTemplate("dotnet/Datasource/CsvItemSource.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: ir.item.typeName,
      }),
      "utf8"
    );
  }

  if (ir.connection.inputFormat === "json") {
    await writeFile(path.join(outDir, "data.json"), buildSampleJson(ir), "utf8");
  } else if (ir.connection.inputFormat === "yaml") {
    await writeFile(path.join(outDir, "data.yaml"), buildSampleYaml(ir), "utf8");
  } else if (ir.connection.inputFormat === "csv") {
    await writeFile(path.join(outDir, "data.csv"), buildSampleCsv(ir), "utf8");
  }

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
      inputFormat: ir.connection.inputFormat,
    }),
    "utf8"
  );

  const copiedTspPath = path.join(outDir, "schema.tsp");
  await copyFile(path.resolve(options.tspPath), copiedTspPath);
  await writeFile(
    path.join(outDir, COCOGEN_CONFIG_FILE),
    projectConfigContents(outDir, copiedTspPath, "dotnet", ir.connection.inputFormat),
    "utf8"
  );

  await writeGeneratedDotnet(outDir, ir, namespaceName, schemaFolderName, schemaNamespace);

  return { outDir, ir };
}
