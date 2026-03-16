import {
  DecoratorContext,
  Model,
  ModelProperty,
  setTypeSpecNamespace,
} from "@typespec/compiler";

import {
  COCOGEN_STATE_CONNECTION_SETTINGS,
  COCOGEN_STATE_PROFILE_SOURCE_SETTINGS,
  COCOGEN_STATE_CONTENT_PROPERTIES,
  COCOGEN_STATE_CONTENT_SETTINGS,
  COCOGEN_STATE_ID_PROPERTIES,
  COCOGEN_STATE_ID_SETTINGS,
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
  COCOGEN_STATE_PROPERTY_SOURCE_TRANSFORMS,
  COCOGEN_STATE_PROPERTY_NO_SOURCE,
  COCOGEN_STATE_PROPERTY_PERSON_FIELDS,
  COCOGEN_STATE_PROPERTY_SERIALIZED,
  type CocogenConnectionSettings,
  type CocogenContentSettings,
  type CocogenIdSettings,
  type CocogenProfileSourceSettings,
  type CocogenSearchFlags,
  type CocogenSourceEntry,
  type CocogenSourceTransform,
  type CocogenSourceSettings,
  type CocogenPersonEntityField,
} from "./state.js";

type TypeSpecValue<T> = { value: T };
const supportedSourceTransforms = new Set(["trim", "lowercase", "uppercase"]);

function unwrapValue<T>(value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return value as T;
  if ("value" in value) return (value as TypeSpecValue<T>).value;
  return value as T;
}

function modelValueToObject(model: Model): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [name, prop] of model.properties) {
    const literal = normalizeValue((prop.type as unknown) as unknown);
    if (literal !== undefined) output[name] = literal;
  }
  return output;
}

function normalizeValue(value: unknown): unknown {
  const unwrapped = unwrapValue(value);
  if (unwrapped === undefined) return undefined;
  if (Array.isArray(unwrapped)) {
    return unwrapped
      .map((entry) => normalizeValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (
    typeof unwrapped === "object" &&
    unwrapped !== null &&
    "kind" in unwrapped &&
    (unwrapped as { kind?: unknown }).kind === "Tuple" &&
    "values" in unwrapped &&
    Array.isArray((unwrapped as { values?: unknown }).values)
  ) {
    return (unwrapped as { values: unknown[] }).values
      .map((entry) => normalizeValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (isModel(unwrapped)) {
    return modelValueToObject(unwrapped);
  }
  return unwrapped;
}

function normalizeObject<T extends Record<string, unknown>>(raw: unknown): T {
  if (isModel(raw)) {
    return modelValueToObject(raw) as T;
  }

  const input = (raw ?? {}) as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const unwrapped = normalizeValue(value);
    if (unwrapped !== undefined) output[key] = unwrapped;
  }
  return output as T;
}

function getObjectMemberValue(raw: unknown, key: string, preserveModel = false): unknown {
  if (raw === undefined || raw === null || typeof raw !== "object") return undefined;
  if (isModel(raw)) {
    const prop = raw.properties.get(key);
    if (!prop) return undefined;
    return preserveModel ? unwrapValue(prop.type as unknown) : normalizeValue(prop.type as unknown);
  }
  const value = (raw as Record<string, unknown>)[key];
  return preserveModel ? unwrapValue(value) : normalizeValue(value);
}

function pushArrayValue<T>(map: Map<any, T[]>, key: any, value: T): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

function isModel(target: unknown): target is Model {
  return typeof target === "object" && target !== null && (target as Model).kind === "Model";
}

function isModelProperty(target: unknown): target is ModelProperty {
  return (
    typeof target === "object" &&
    target !== null &&
    (target as ModelProperty).kind === "ModelProperty" &&
    typeof (target as ModelProperty).name === "string"
  );
}


export function $item(context: DecoratorContext, target: Model): void {
  if (!isModel(target)) return;
  context.program.stateSet(COCOGEN_STATE_ITEM_MODELS).add(target);
}

export function $id(context: DecoratorContext, target: ModelProperty, settings?: CocogenIdSettings): void {
  if (!isModelProperty(target)) return;
  context.program.stateMap(COCOGEN_STATE_ID_PROPERTIES).set(target, true);
  if (settings) {
    context.program.stateMap(COCOGEN_STATE_ID_SETTINGS).set(
      target,
      normalizeObject<CocogenIdSettings>(settings)
    );
  }
}

export function $label(context: DecoratorContext, target: ModelProperty, value: string): void {
  if (!isModelProperty(target)) return;
  const text = unwrapValue<string>(value);
  if (typeof text !== "string") return;
  pushArrayValue(context.program.stateMap(COCOGEN_STATE_PROPERTY_LABELS), target, text);
}


export function $aliases(context: DecoratorContext, target: ModelProperty, value: string): void {
  if (!isModelProperty(target)) return;
  const text = unwrapValue<string>(value);
  if (typeof text !== "string") return;
  pushArrayValue(context.program.stateMap(COCOGEN_STATE_PROPERTY_ALIASES), target, text);
}

export function $schemaDescription(context: DecoratorContext, target: ModelProperty, value: string): void {
  if (!isModelProperty(target)) return;
  const text = unwrapValue<string>(value);
  if (typeof text !== "string") return;
  context.program.stateMap(COCOGEN_STATE_PROPERTY_SCHEMA_DESCRIPTIONS).set(target, text);
}

export function $description(context: DecoratorContext, target: ModelProperty, value: string): void {
  if (!isModelProperty(target)) return;
  const text = unwrapValue<string>(value);
  if (typeof text !== "string") return;
  context.program.stateMap(COCOGEN_STATE_PROPERTY_LEGACY_DESCRIPTIONS).set(target, text);
}

export function $typespecDescription(context: DecoratorContext, target: ModelProperty, value: string): void {
  if (!isModelProperty(target)) return;
  const text = unwrapValue<string>(value);
  if (typeof text !== "string") return;
  context.program.stateMap(COCOGEN_STATE_PROPERTY_TYPESPEC_DESCRIPTIONS).set(target, text);
}

export const $decorators = {
  "": {
    description: $typespecDescription,
  },
};

export function $name(context: DecoratorContext, target: ModelProperty, value: string): void {
  if (!isModelProperty(target)) return;
  const text = unwrapValue<string>(value);
  if (typeof text !== "string") return;
  context.program.stateMap(COCOGEN_STATE_PROPERTY_NAME_OVERRIDES).set(target, text);
}

export function $connection(context: DecoratorContext, target: Model, settings: CocogenConnectionSettings): void {
  if (!isModel(target)) return;
  context.program.stateMap(COCOGEN_STATE_CONNECTION_SETTINGS).set(
    target,
    normalizeObject<CocogenConnectionSettings>(settings)
  );
}

export function $profileSource(
  context: DecoratorContext,
  target: Model,
  settings: CocogenProfileSourceSettings
): void {
  if (!isModel(target)) return;
  context.program.stateMap(COCOGEN_STATE_PROFILE_SOURCE_SETTINGS).set(
    target,
    normalizeObject<CocogenProfileSourceSettings>(settings)
  );
}

export function $search(context: DecoratorContext, target: ModelProperty, flags: CocogenSearchFlags): void {
  if (!isModelProperty(target)) return;
  context.program.stateMap(COCOGEN_STATE_PROPERTY_SEARCH).set(target, normalizeObject<CocogenSearchFlags>(flags));
}

export function $content(context: DecoratorContext, target: ModelProperty, settings?: CocogenContentSettings): void {
  if (!isModelProperty(target)) return;
  context.program.stateMap(COCOGEN_STATE_CONTENT_PROPERTIES).set(target, true);
  if (settings) {
    context.program.stateMap(COCOGEN_STATE_CONTENT_SETTINGS).set(
      target,
      normalizeObject<CocogenContentSettings>(settings)
    );
  }
}

export function $source(
  context: DecoratorContext,
  target: ModelProperty,
  from: CocogenSourceSettings | string,
  to?: string | { serialized?: Model; to?: string; default?: string; transforms?: CocogenSourceTransform[] }
): void {
  if (!isModelProperty(target)) return;

  const rawTo = unwrapValue<unknown>(to);
  const rawFrom = unwrapValue<unknown>(from);
  const fromValue = typeof rawFrom === "string" ? rawFrom : normalizeObject<CocogenSourceSettings>(from);
  const toSettings = rawTo && typeof rawTo === "object" && !Array.isArray(rawTo)
    ? {
        serialized: getObjectMemberValue(rawTo, "serialized", true),
        to: getObjectMemberValue(rawTo, "to"),
        default: getObjectMemberValue(rawTo, "default"),
        transforms: getObjectMemberValue(rawTo, "transforms"),
      }
    : undefined;
  const rawToString = typeof rawTo === "string" ? rawTo.trim() : typeof toSettings?.to === "string" ? toSettings.to.trim() : "";
  if (toSettings && "default" in toSettings && toSettings.default !== undefined && typeof toSettings.default !== "string") {
    throw new Error("@coco.source default values must be strings.");
  }
  const defaultOverride = typeof toSettings?.default === "string" ? toSettings.default : undefined;
  const defaultFromValue = typeof fromValue === "object" && fromValue && "default" in fromValue
    ? (fromValue as { default?: unknown }).default
    : undefined;
  if (defaultFromValue !== undefined && typeof defaultFromValue !== "string") {
    throw new Error("@coco.source default values must be strings.");
  }
  const transformsFromValue = typeof fromValue === "object" && fromValue && "transforms" in fromValue
    ? (fromValue as { transforms?: unknown }).transforms
    : undefined;
  const transformsOverride = toSettings?.transforms;
  for (const transformsValue of [transformsFromValue, transformsOverride]) {
    if (transformsValue === undefined) continue;
    if (!Array.isArray(transformsValue)) {
      throw new Error("@coco.source transforms must be an array of strings.");
    }
    for (const transform of transformsValue) {
      if (typeof transform !== "string" || !supportedSourceTransforms.has(transform)) {
        throw new Error(
          `@coco.source transform '${String(transform)}' is not supported. Supported transforms: trim, lowercase, uppercase.`
        );
      }
    }
  }
  const resolvedTransforms = Array.isArray(transformsOverride)
    ? transformsOverride as CocogenSourceTransform[]
    : Array.isArray(transformsFromValue)
    ? transformsFromValue as CocogenSourceTransform[]
    : undefined;
  const defaultValue = typeof defaultOverride === "string" ? defaultOverride : typeof defaultFromValue === "string" ? defaultFromValue : undefined;
  const sourceEntry: CocogenSourceEntry = rawToString
    ? {
        from: fromValue,
        to: rawToString,
        ...(defaultValue !== undefined ? { default: defaultValue } : {}),
        ...(resolvedTransforms && resolvedTransforms.length > 0 ? { transforms: resolvedTransforms } : {}),
      }
    : { from: fromValue };
  pushArrayValue(context.program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE_ENTRIES), target, sourceEntry);

  if (rawTo && typeof rawTo === "object" && !Array.isArray(rawTo)) {
    const serialized = toSettings?.serialized;
    const path = typeof toSettings?.to === "string" ? toSettings.to.trim() : "";

    if (serialized) {
      if (path.length > 0) {
        throw new Error("@coco.source serialized targets cannot include a 'to' path. Use string 'to' for people entity mappings only.");
      }
      if (!isModel(serialized)) {
        throw new Error("@coco.source serialized targets must reference a model type.");
      }
      context.program.stateMap(COCOGEN_STATE_PROPERTY_SERIALIZED).set(target, serialized);
    }
  }

  const rawToText = rawToString?.trim();
  if (typeof rawToText === "string" && rawToText.length > 0) {
    const entry: CocogenPersonEntityField = {
      path: rawToText,
      source: fromValue,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      ...(resolvedTransforms && resolvedTransforms.length > 0 ? { transforms: resolvedTransforms } : {}),
    };

    pushArrayValue(context.program.stateMap(COCOGEN_STATE_PROPERTY_PERSON_FIELDS), target, entry);
    return;
  }

  if (defaultValue !== undefined) {
    context.program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE_DEFAULT).set(target, defaultValue);
  }
  if (resolvedTransforms && resolvedTransforms.length > 0) {
    context.program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE_TRANSFORMS).set(target, resolvedTransforms);
  }

  if (typeof rawFrom === "string") {
    const text = rawFrom.trim();
    if (text.length > 0) {
      context.program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE).set(target, text);
    }
    return;
  }

  context.program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE).set(target, fromValue);
}

export function $noSource(context: DecoratorContext, target: ModelProperty): void {
  if (!isModelProperty(target)) return;
  context.program.stateMap(COCOGEN_STATE_PROPERTY_NO_SOURCE).set(target, true);
}

// Ensure the decorators are registered under the `coco` namespace.
setTypeSpecNamespace(
  "coco",
  $item,
  $id,
  $label,
  $aliases,
  $schemaDescription,
  $description,
  $name,
  $connection,
  $profileSource,
  $search,
  $content,
  $source,
  $noSource
);
