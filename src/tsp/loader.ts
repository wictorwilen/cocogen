import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NodeHost,
  compile,
  formatDiagnostic,
  getDoc,
  getExamples,
  serializeValueAsJson,
  getFormat,
  getPatternData,
  getDeprecated,
  getMinLengthAsNumeric,
  getMaxLengthAsNumeric,
  getMinValueAsNumeric,
  getMaxValueAsNumeric,
  isArrayModelType,
  type Model,
  type ModelProperty,
  type Program,
  type Scalar,
  type Type,
} from "@typespec/compiler";

import type { ConnectorIr, GraphApiVersion, PropertyType, SearchFlags } from "../ir.js";
import { getPeopleLabelDefinition, type PersonEntityName } from "../people/label-registry.js";
import { assertValidJsonPath, normalizeJsonPath } from "./jsonpath.js";
import { normalizeInputFormat } from "./input-format.js";
import {
  COCOGEN_STATE_CONNECTION_SETTINGS,
  COCOGEN_STATE_PROFILE_SOURCE_SETTINGS,
  COCOGEN_STATE_CONTENT_PROPERTIES,
  COCOGEN_STATE_CONTENT_SETTINGS,
  COCOGEN_STATE_ID_PROPERTIES,
  COCOGEN_STATE_ITEM_MODELS,
  COCOGEN_STATE_PROPERTY_ALIASES,
  COCOGEN_STATE_PROPERTY_SCHEMA_DESCRIPTIONS,
  COCOGEN_STATE_PROPERTY_LEGACY_DESCRIPTIONS,
  COCOGEN_STATE_PROPERTY_TYPESPEC_DESCRIPTIONS,
  COCOGEN_STATE_PROPERTY_LABELS,
  COCOGEN_STATE_PROPERTY_NAME_OVERRIDES,
  COCOGEN_STATE_PROPERTY_SEARCH,
  COCOGEN_STATE_PROPERTY_SOURCE,
  COCOGEN_STATE_PROPERTY_SOURCE_ENTRIES,
  COCOGEN_STATE_PROPERTY_SOURCE_DEFAULT,
  COCOGEN_STATE_PROPERTY_NO_SOURCE,
  COCOGEN_STATE_PROPERTY_PERSON_FIELDS,
  COCOGEN_STATE_PROPERTY_SERIALIZED,
  COCOGEN_STATE_ID_SETTINGS,
  type CocogenConnectionSettings,
  type CocogenContentSettings,
  type CocogenProfileSourceSettings,
  type CocogenSearchFlags,
  type CocogenSourceSettings,
  type CocogenSourceEntry,
  type CocogenPersonEntityField,
} from "../typespec/state.js";

export class CocogenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CocogenError";
  }
}

export type LoadIrOptions = {
  inputFormat?: "csv" | "json" | "yaml" | "rest" | "custom" | undefined;
};

type SourcePathSyntax = "csv" | "jsonpath";

function requireSingleItemModel(program: Program): Model {
  const items = [...program.stateSet(COCOGEN_STATE_ITEM_MODELS)].filter(
    (t): t is Model => t.kind === "Model"
  );
  if (items.length === 0) {
    throw new CocogenError(
      "No @coco.item() model found. Add @coco.item() to the model that represents an external item."
    );
  }
  if (items.length > 1) {
    throw new CocogenError(
      `Multiple @coco.item() models found (${items
        .map((m) => m.name)
        .join(", ")}). Use exactly one for now.`
    );
  }
  return items[0]!;
}

function getConnectionSettings(program: Program, itemModel: Model): CocogenConnectionSettings {
  return (program.stateMap(COCOGEN_STATE_CONNECTION_SETTINGS).get(itemModel) ?? {}) as CocogenConnectionSettings;
}

function getSourcePathSyntax(inputFormat: "csv" | "json" | "yaml" | "rest" | "custom"): SourcePathSyntax {
  return inputFormat === "csv" ? "csv" : "jsonpath";
}

function getProfileSourceSettings(program: Program, itemModel: Model): CocogenProfileSourceSettings | undefined {
  return program.stateMap(COCOGEN_STATE_PROFILE_SOURCE_SETTINGS).get(itemModel) as
    | CocogenProfileSourceSettings
    | undefined;
}

function computeGraphApiVersion(
  contentCategory: string | undefined,
  usesPrincipal: boolean
): GraphApiVersion {
  // Microsoft Graph exposes externalConnection.contentCategory on /beta.
  // If the schema specifies a category, we must use beta for provisioning.
  if (contentCategory) return "beta";

  // Graph propertyType 'principal' is only available on /beta.
  if (usesPrincipal) return "beta";

  return "v1.0";
}

function getStringArray(program: Program, key: symbol, prop: ModelProperty): string[] {
  const raw = program.stateMap(key).get(prop) as string[] | undefined;
  return raw ? [...raw] : [];
}

function getSearchFlags(program: Program, prop: ModelProperty): SearchFlags {
  const raw = (program.stateMap(COCOGEN_STATE_PROPERTY_SEARCH).get(prop) ?? {}) as CocogenSearchFlags;
  return { ...raw };
}

function normalizeSourceSettings(
  raw: unknown,
  fallbackName: string,
  explicit: boolean,
  noSource: boolean,
  sourcePathSyntax: SourcePathSyntax,
  defaultValue?: string
): { csvHeaders: string[]; jsonPath?: string; explicit: boolean; noSource: boolean; default?: string } {
  const settings = (raw ?? {}) as CocogenSourceSettings | string | undefined;
  const csv = typeof settings === "string" ? settings : settings?.csv;
  const jsonPath = typeof settings === "string" ? settings : settings?.jsonPath;
  const rawDefault = defaultValue ?? (typeof settings === "object" ? settings?.default : undefined);
  if (rawDefault !== undefined && typeof rawDefault !== "string") {
    throw new CocogenError("@coco.source default values must be strings.");
  }
  const normalizedDefault = typeof rawDefault === "string" ? rawDefault : undefined;

  if (sourcePathSyntax === "jsonpath") {
    if (settings && typeof settings === "object" && "csv" in settings && settings.csv) {
      throw new CocogenError("@coco.source csv settings are not valid for jsonpath input. Use jsonPath or a string path.");
    }

    let path = typeof jsonPath === "string" ? jsonPath : "";
    if (!path && !noSource) path = fallbackName;
    const normalized = path ? normalizeJsonPath(path) : "";
    if (normalized) assertValidJsonPath(normalized, (message) => new CocogenError(message));
    return {
      csvHeaders: [],
      jsonPath: normalized,
      explicit,
      noSource,
      ...(normalizedDefault !== undefined ? { default: normalizedDefault } : {}),
    };
  }

  let csvHeaders: string[] = [];
  if (typeof csv === "string") {
    csvHeaders = csv.trim().length > 0 ? [csv] : [];
  } else if (Array.isArray(csv)) {
    throw new CocogenError(
      "Source field merging is not supported. Use a single CSV header per property or preprocess your data."
    );
  }

  if (settings && typeof settings === "object" && "jsonPath" in settings && settings.jsonPath) {
    throw new CocogenError("@coco.source jsonPath settings are not valid for CSV input.");
  }

  if (csvHeaders.length === 0 && !noSource) {
    csvHeaders = [fallbackName];
  }

  return {
    csvHeaders,
    explicit,
    noSource,
    ...(normalizedDefault !== undefined ? { default: normalizedDefault } : {}),
  };
}

function getSourceSettings(
  program: Program,
  prop: ModelProperty,
  fallbackName: string,
  sourcePathSyntax: SourcePathSyntax
): {
  csvHeaders: string[];
  jsonPath?: string;
  explicit: boolean;
  noSource: boolean;
  default?: string;
} {
  const map = program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE);
  const raw = map.get(prop) as CocogenSourceSettings | string | undefined;
  const explicit = map.has(prop);
  const defaultOverride = program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE_DEFAULT).get(prop) as string | undefined;
  const noSource = Boolean(program.stateMap(COCOGEN_STATE_PROPERTY_NO_SOURCE).get(prop));
  if (noSource) {
    return normalizeSourceSettings(undefined, fallbackName, true, true, sourcePathSyntax, defaultOverride);
  }
  return normalizeSourceSettings(raw, fallbackName, explicit, false, sourcePathSyntax, defaultOverride);
}

function getPersonEntityMapping(
  program: Program,
  prop: ModelProperty,
  propertyType: PropertyType,
  sourcePathSyntax: SourcePathSyntax
): {
  entity: PersonEntityName;
  fields: Array<{ path: string; source: { csvHeaders: string[]; jsonPath?: string } }>;
} | undefined {
  const labels = getStringArray(program, COCOGEN_STATE_PROPERTY_LABELS, prop);
  const entity = labels
    .map((label) => getPeopleLabelDefinition(label)?.graphTypeName)
    .find((value): value is PersonEntityName => typeof value === "string");

  const rawFields =
    (program.stateMap(COCOGEN_STATE_PROPERTY_PERSON_FIELDS).get(prop) as CocogenPersonEntityField[]) ?? [];

  const extractSourcePath = (source: CocogenSourceSettings | string): string | undefined => {
    if (typeof source === "string") return source.trim();
    const jsonPath = typeof source.jsonPath === "string" ? source.jsonPath.trim() : "";
    return jsonPath.length > 0 ? jsonPath : undefined;
  };

  const normalizePrefixCandidate = (raw: string): string | undefined => {
    let text = raw.trim();
    if (!text) return undefined;
    if (text.startsWith("$.")) text = text.slice(2);
    if (text.startsWith("$")) return undefined;
    if (text.startsWith("[")) return undefined;
    if (text.includes("[")) return undefined;
    return text;
  };

  const computeCommonPrefix = (): string | undefined => {
    if (sourcePathSyntax !== "jsonpath") return undefined;
    const candidates = rawFields
      .map((field) => extractSourcePath(field.source))
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => normalizePrefixCandidate(value))
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => value.split(".").filter(Boolean))
      .filter((segments) => segments.length > 1);

    if (candidates.length === 0) return undefined;
    let prefix = candidates[0]!;
    for (const segments of candidates.slice(1)) {
      let index = 0;
      while (index < prefix.length && index < segments.length && prefix[index] === segments[index]) {
        index += 1;
      }
      prefix = prefix.slice(0, index);
      if (prefix.length === 0) break;
    }
    return prefix.length > 0 ? prefix.join(".") : undefined;
  };

  const commonPrefix = computeCommonPrefix();

  const applyCommonPrefix = (source: CocogenSourceSettings | string): CocogenSourceSettings | string => {
    if (!commonPrefix || sourcePathSyntax !== "jsonpath") return source;
    const rawPath = extractSourcePath(source);
    if (!rawPath) return source;
    const trimmed = rawPath.trim();
    if (
      trimmed.startsWith("$") ||
      trimmed.includes("[") ||
      trimmed.includes(".")
    ) {
      return source;
    }
    const prefixed = `${commonPrefix}.${trimmed}`;
    if (typeof source === "string") return prefixed;
    return { ...source, jsonPath: prefixed };
  };

  const normalizeEntityPath = (rawPath: string): string => {
    const trimmed = rawPath.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("$.")) return trimmed.slice(2);
    if (trimmed.startsWith("$[")) {
      const parts: string[] = [];
      const regex = /\[['"]([^'"]+)['"]\]/g;
      let match: RegExpExecArray | null = null;
      while ((match = regex.exec(trimmed))) {
        parts.push(match[1]!);
      }
      if (parts.length > 0 && regex.lastIndex === trimmed.length) {
        return parts.join(".");
      }
    }
    return trimmed;
  };

  const fields = rawFields
    .map((field) => {
      const path = typeof field.path === "string" ? normalizeEntityPath(field.path) : "";
      if (!path) return undefined;
      const sourceSettings = normalizeSourceSettings(
        applyCommonPrefix(field.source),
        path,
        true,
        false,
        sourcePathSyntax,
        field.default
      );
      return {
        path,
        source: {
          csvHeaders: sourceSettings.csvHeaders,
          ...(sourceSettings.jsonPath ? { jsonPath: sourceSettings.jsonPath } : {}),
          ...(sourceSettings.default !== undefined ? { default: sourceSettings.default } : {}),
        },
      };
    })
    .filter((value): value is { path: string; source: { csvHeaders: string[]; jsonPath?: string } } => Boolean(value));

  if (fields.length === 0) return undefined;
  if (!entity) {
    if (propertyType === "principal" || propertyType === "principalCollection") {
      return {
        entity: "userAccountInformation",
        fields,
      };
    }

    throw new CocogenError(
      `Property '${prop.name}' maps people entity fields but is missing a people label. Add @coco.label("person...").`
    );
  }

  return {
    entity,
    fields,
  };
}

function getSerializedModel(program: Program, prop: ModelProperty): {
  name: string;
  fields: Array<{ name: string; type: PropertyType; example?: unknown }>;
} | undefined {
  const raw = program.stateMap(COCOGEN_STATE_PROPERTY_SERIALIZED).get(prop) as Model | undefined;
  if (!raw) return undefined;

  let model = raw;
  if (isArrayModelType(program, model)) {
    const element = model.indexer.value;
    if (element.kind !== "Model") {
      throw new CocogenError("@coco.source serialized targets must reference a model type.");
    }
    model = element as Model;
  }
  const fields = [...model.properties.entries()].map(([name, field]) => {
    if (field.type.kind === "String") {
      return {
        name,
        type: "string" as const,
        example: field.type.value,
      };
    }
    return {
      name,
      type: mapTypeToPropertyType(program, field.type),
      example: getExampleValue(program, field),
    };
  });

  return {
    name: model.name,
    fields,
  };
}

type SchemaDescriptionSource = "coco.schemaDescription" | "coco.description" | "typespec.description";

function getTypeSpecDescription(program: Program, prop: ModelProperty): string | undefined {
  const fromDecorator = program.stateMap(COCOGEN_STATE_PROPERTY_TYPESPEC_DESCRIPTIONS).get(prop) as
    | string
    | undefined;
  if (fromDecorator && fromDecorator.trim().length > 0) return fromDecorator;

  if (!prop.decorators || prop.decorators.length === 0) return undefined;
  for (const decorator of prop.decorators) {
    const definition = decorator.definition;
    if (!definition || definition.name !== "@description") continue;
    if (definition.namespace?.name === "coco") continue;
    const arg = decorator.args?.[0];
    const text = typeof arg?.jsValue === "string" ? arg.jsValue.trim() : "";
    if (text.length > 0) return text;
  }
  return undefined;
}

function getSchemaDescription(
  program: Program,
  prop: ModelProperty
): { text?: string; source?: SchemaDescriptionSource } {
  const fromSchemaDecorator = program.stateMap(COCOGEN_STATE_PROPERTY_SCHEMA_DESCRIPTIONS).get(prop) as
    | string
    | undefined;
  if (fromSchemaDecorator && fromSchemaDecorator.trim().length > 0) {
    return { text: fromSchemaDecorator, source: "coco.schemaDescription" };
  }

  const fromLegacyDecorator = program.stateMap(COCOGEN_STATE_PROPERTY_LEGACY_DESCRIPTIONS).get(prop) as
    | string
    | undefined;
  if (fromLegacyDecorator && fromLegacyDecorator.trim().length > 0) {
    return { text: fromLegacyDecorator, source: "coco.description" };
  }

  const fromTypeSpec = getTypeSpecDescription(program, prop);
  if (fromTypeSpec && fromTypeSpec.trim().length > 0) {
    return { text: fromTypeSpec, source: "typespec.description" };
  }

  return {};
}

function getDocText(program: Program, prop: ModelProperty): string | undefined {
  const text = getTypeSpecDescription(program, prop) ?? getDoc(program, prop);
  return text && text.trim().length > 0 ? text : undefined;
}

function getItemDoc(program: Program, model: Model): string | undefined {
  const text = getDoc(program, model);
  return text && text.trim().length > 0 ? text : undefined;
}

function getExampleValue(program: Program, prop: ModelProperty): unknown | undefined {
  const examples = getExamples(program, prop);
  if (!examples || examples.length === 0) return undefined;
  try {
    return serializeValueAsJson(program, examples[0]!.value, prop.type);
  } catch {
    return undefined;
  }
}

function getPattern(program: Program, prop: ModelProperty): { regex: string; message?: string } | undefined {
  const data = getPatternData(program, prop);
  if (!data?.pattern) return undefined;
  const message = data?.validationMessage;
  return message ? { regex: data.pattern, message } : { regex: data.pattern };
}

function getName(program: Program, prop: ModelProperty): string {
  const override = program.stateMap(COCOGEN_STATE_PROPERTY_NAME_OVERRIDES).get(prop) as string | undefined;
  return override ?? prop.name;
}

function isContentProperty(program: Program, prop: ModelProperty): boolean {
  return Boolean(program.stateMap(COCOGEN_STATE_CONTENT_PROPERTIES).get(prop));
}

function getContentSettings(program: Program, prop: ModelProperty): CocogenContentSettings | undefined {
  return program.stateMap(COCOGEN_STATE_CONTENT_SETTINGS).get(prop) as CocogenContentSettings | undefined;
}

function getContentSources(
  program: Program,
  prop: ModelProperty,
  sourcePathSyntax: SourcePathSyntax
): Array<{ label: string; source: { csvHeaders: string[]; jsonPath?: string } }> {
  const rawEntries = program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE_ENTRIES).get(prop) as
    | CocogenSourceEntry[]
    | undefined;
  if (!rawEntries || rawEntries.length === 0) return [];

  const normalizeLabel = (entry: CocogenSourceEntry): string => {
    if (entry.to && entry.to.trim().length > 0) return entry.to.trim();
    if (typeof entry.from === "string") return entry.from.trim();
    if (entry.from && typeof entry.from === "object") {
      if (typeof entry.from.csv === "string") return entry.from.csv.trim();
      if (typeof entry.from.jsonPath === "string") return entry.from.jsonPath.trim();
    }
    return "";
  };

  return rawEntries
    .map((entry) => {
      const label = normalizeLabel(entry);
      if (!label) return undefined;
      const sourceSettings = normalizeSourceSettings(entry.from, label, true, false, sourcePathSyntax, entry.default);
      return {
        label,
        source: {
          csvHeaders: sourceSettings.csvHeaders,
          ...(sourceSettings.jsonPath ? { jsonPath: sourceSettings.jsonPath } : {}),
          ...(sourceSettings.default !== undefined ? { default: sourceSettings.default } : {}),
        },
      };
    })
    .filter((value): value is { label: string; source: { csvHeaders: string[]; jsonPath?: string } } => Boolean(value));
}

function isIdProperty(program: Program, prop: ModelProperty): boolean {
  return Boolean(program.stateMap(COCOGEN_STATE_ID_PROPERTIES).get(prop));
}

function getIdEncoding(program: Program, prop: ModelProperty): "slug" | "base64" | "hash" {
  const settings = program.stateMap(COCOGEN_STATE_ID_SETTINGS).get(prop) as { encoding?: string } | undefined;
  const encoding = settings?.encoding;
  if (encoding === "base64" || encoding === "hash" || encoding === "slug") return encoding;
  return "slug";
}

function isPrincipalScalar(type: Type): boolean {
  if (type.kind !== "Scalar") return false;
  const scalar = type as Scalar;
  return scalar.name === "Principal" && scalar.namespace?.name === "coco";
}

function mapTypeToPropertyType(program: Program, type: Type): PropertyType {
  // Arrays
  if (type.kind === "Model" && isArrayModelType(program, type)) {
    const element = type.indexer.value;
    if (isPrincipalScalar(element)) {
      return "principalCollection";
    }
    return mapCollectionType(element);
  }

  // Scalars
  if (isPrincipalScalar(type)) return "principal";

  if (type.kind === "Scalar") {
    const scalarName = (type as Scalar).name;
    switch (scalarName) {
      case "string":
        return "string";
      case "boolean":
        return "boolean";
      case "int32":
      case "int64":
        return "int64";
      case "float32":
      case "float64":
        return "double";
      case "utcDateTime":
        return "dateTime";
      default:
        {
          const hint = scalarName === "double" ? " Did you mean 'float64'?" : "";
          throw new CocogenError(
            `Unsupported TypeSpec scalar type: ${scalarName}. Supported scalars: string, boolean, int64, float64, utcDateTime, coco.Principal.${hint}`
          );
        }
    }
  }

  if (type.kind === "Enum") {
    return "string";
  }

  if (type.kind === "Model") {
    throw new CocogenError(
      "Nested models are not supported for connector schema properties. Flatten the model so every property is a scalar or scalar collection."
    );
  }

  throw new CocogenError(`Unsupported TypeSpec property type kind: ${type.kind}`);
}

function mapCollectionType(element: Type): PropertyType {
  if (element.kind === "Scalar") {
    const scalarName = (element as Scalar).name;
    switch (scalarName) {
      case "string":
        return "stringCollection";
      case "int32":
      case "int64":
        return "int64Collection";
      case "float32":
      case "float64":
        return "doubleCollection";
      case "utcDateTime":
        return "dateTimeCollection";
      default:
        break;
    }
  }
  if (element.kind === "Enum") {
    return "stringCollection";
  }
  throw new CocogenError("Unsupported collection element type.");
}

export async function compileTypeSpec(entryTspPath: string): Promise<Program> {
  const absolute = path.resolve(entryTspPath);

  // Ensure the cocogen decorator library declarations and JS implementations are available
  // even if the user's schema doesn't explicitly import the package yet.
  //
  // When running from a published package, these are present in the package file tree.
  const libraryTspMain = fileURLToPath(new URL("../../typespec/main.tsp", import.meta.url));

  return compile(NodeHost, absolute, {
    noEmit: true,
    additionalImports: [libraryTspMain],
    warningAsError: false,
  });
}

export async function loadIrFromTypeSpec(entryTspPath: string, options: LoadIrOptions = {}): Promise<ConnectorIr> {
  const program = await compileTypeSpec(entryTspPath);
  if (program.hasError()) {
    const missingConnectionSettings = program.diagnostics.some(
      (d) => d.severity === "error" && d.code === "invalid-argument" && String(d.message).includes("coco.ConnectionSettings")
    );
    const formatted = program.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => formatDiagnostic(d, { pretty: true, pathRelativeTo: process.cwd() }))
      .join("\n");
    const hint = missingConnectionSettings
      ? "\n\nHint: @coco.connection requires name and connectionId (connectionDescription is optional but recommended)."
      : "";

    throw new CocogenError(`TypeSpec compilation failed:\n${formatted}${hint}`);
  }

  const itemModel = requireSingleItemModel(program);

  const connection = getConnectionSettings(program, itemModel);
  const profileSource = getProfileSourceSettings(program, itemModel);
  const properties = [...itemModel.properties.values()];
  const itemDoc = getItemDoc(program, itemModel);
  let inputFormat: ReturnType<typeof normalizeInputFormat>;
  try {
    inputFormat = normalizeInputFormat(options.inputFormat);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CocogenError(message);
  }
  const sourcePathSyntax = getSourcePathSyntax(inputFormat);

  const deprecatedProps = new Set(properties.filter((prop) => Boolean(getDeprecated(program, prop))));

  const idProps = properties.filter((p) => isIdProperty(program, p));
  if (idProps.length !== 1) {
    throw new CocogenError(
      idProps.length === 0
        ? "Missing @coco.id property. Add @coco.id to the property that uniquely identifies items."
        : `Multiple @coco.id properties found (${idProps.map((p) => p.name).join(", ")}). Use exactly one.`
    );
  }

  if (deprecatedProps.has(idProps[0]!)) {
    throw new CocogenError("The @coco.id property cannot be marked #deprecated.");
  }

  const contentProps = properties.filter((p) => isContentProperty(program, p));
  const contentPropName = contentProps.length > 0 ? getName(program, contentProps[0]!) : undefined;
  const contentSettings = contentProps.length > 0 ? getContentSettings(program, contentProps[0]!) : undefined;
  const contentType = contentSettings?.type;
  const contentSources = contentProps.length > 0 ? getContentSources(program, contentProps[0]!, sourcePathSyntax) : [];
  if (contentProps.some((prop) => deprecatedProps.has(prop))) {
    throw new CocogenError("The @coco.content property cannot be marked #deprecated.");
  }

  const irProperties: ConnectorIr["properties"] = properties
    .filter((prop) => !deprecatedProps.has(prop))
    .map((prop) => {
    const name = getName(program, prop);
    const labels = getStringArray(program, COCOGEN_STATE_PROPERTY_LABELS, prop);
    const aliases = getStringArray(program, COCOGEN_STATE_PROPERTY_ALIASES, prop);
    const schemaDescription = getSchemaDescription(program, prop);
    const description = schemaDescription.text;
    const doc = getDocText(program, prop);
    const example = getExampleValue(program, prop);
    const pattern = getPattern(program, prop);
    const format = getFormat(program, prop);
    const minLengthRaw = getMinLengthAsNumeric(program, prop);
    const maxLengthRaw = getMaxLengthAsNumeric(program, prop);
    const minValueRaw = getMinValueAsNumeric(program, prop);
    const maxValueRaw = getMaxValueAsNumeric(program, prop);
    const minLength = minLengthRaw === undefined ? undefined : Number(minLengthRaw);
    const maxLength = maxLengthRaw === undefined ? undefined : Number(maxLengthRaw);
    const minValue = minValueRaw === undefined ? undefined : Number(minValueRaw);
    const maxValue = maxValueRaw === undefined ? undefined : Number(maxValueRaw);

    const propertyType = mapTypeToPropertyType(program, prop.type);
    const isContent = isContentProperty(program, prop);
    const personEntity = isContent ? undefined : getPersonEntityMapping(program, prop, propertyType, sourcePathSyntax);
    const serialized = getSerializedModel(program, prop);
    const source = getSourceSettings(program, prop, name, sourcePathSyntax);
    if (serialized) {
      const supported = propertyType === "string" || propertyType === "stringCollection";
      if (!supported) {
        throw new CocogenError("Serialized @coco.source targets are only supported for string or string[] properties.");
      }
      if (personEntity) {
        throw new CocogenError("Serialized @coco.source targets are not supported for people entity mappings.");
      }
    }

    if (source.default !== undefined) {
      const supportsDefault = propertyType === "string" || propertyType === "stringCollection";
      if (!supportsDefault) {
        throw new CocogenError("@coco.source default values are only supported for string or string[] properties.");
      }
    }

    return {
      name,
      type: propertyType,
      ...(description ? { description } : {}),
      ...(schemaDescription.source ? { descriptionSource: schemaDescription.source } : {}),
      ...(prop.optional ? { optional: true } : {}),
      ...(doc ? { doc } : {}),
      ...(example !== undefined ? { example } : {}),
      ...(format ? { format } : {}),
      ...(pattern ? { pattern } : {}),
      ...(minLength !== undefined && Number.isFinite(minLength) ? { minLength } : {}),
      ...(maxLength !== undefined && Number.isFinite(maxLength) ? { maxLength } : {}),
      ...(minValue !== undefined && Number.isFinite(minValue) ? { minValue } : {}),
      ...(maxValue !== undefined && Number.isFinite(maxValue) ? { maxValue } : {}),
      labels,
      aliases,
      search: getSearchFlags(program, prop),
      ...(personEntity ? { personEntity } : {}),
      ...(serialized ? { serialized } : {}),
      source,
    };
  });

  const usesPrincipal = irProperties.some((prop) => prop.type === "principal" || prop.type === "principalCollection");
  const graphApiVersion = computeGraphApiVersion(connection.contentCategory, usesPrincipal);
  const connectionCategory = connection.contentCategory;
  const connectionName = typeof connection.name === "string" ? connection.name.trim() : "";
  const connectionId = typeof connection.connectionId === "string" ? connection.connectionId.trim() : "";
  const connectionDescription =
    typeof connection.connectionDescription === "string" ? connection.connectionDescription.trim() : "";
  return {
    connection: {
      ...(connectionCategory ? { contentCategory: connectionCategory } : {}),
      ...(connectionName ? { connectionName } : {}),
      ...(connectionId ? { connectionId } : {}),
      ...(connectionDescription ? { connectionDescription } : {}),
      inputFormat,
      ...(profileSource ? { profileSource } : {}),
      graphApiVersion,
    },
    item: {
      typeName: itemModel.name,
      idPropertyName: getName(program, idProps[0]!),
      idEncoding: getIdEncoding(program, idProps[0]!),
      ...(contentPropName ? { contentPropertyName: contentPropName } : {}),
      ...(contentType ? { contentType } : {}),
      ...(contentSources.length > 0 ? { contentSources } : {}),
      ...(itemDoc ? { doc: itemDoc } : {}),
    },
    properties: irProperties,
  };
}
