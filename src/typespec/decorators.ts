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
  COCOGEN_STATE_ID_PROPERTIES,
  COCOGEN_STATE_ID_SETTINGS,
  COCOGEN_STATE_ITEM_MODELS,
  COCOGEN_STATE_PROPERTY_ALIASES,
  COCOGEN_STATE_PROPERTY_DESCRIPTIONS,
  COCOGEN_STATE_PROPERTY_LABELS,
  COCOGEN_STATE_PROPERTY_NAME_OVERRIDES,
  COCOGEN_STATE_PROPERTY_SEARCH,
  COCOGEN_STATE_PROPERTY_SOURCE,
  COCOGEN_STATE_PROPERTY_NO_SOURCE,
  COCOGEN_STATE_PROPERTY_PERSON_FIELDS,
  COCOGEN_STATE_PROPERTY_SERIALIZED,
  type CocogenConnectionSettings,
  type CocogenIdSettings,
  type CocogenProfileSourceSettings,
  type CocogenSearchFlags,
  type CocogenSourceSettings,
  type CocogenPersonEntityField,
} from "./state.js";

type TypeSpecValue<T> = { value: T };

function unwrapValue<T>(value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return value as T;
  if ("value" in value) return (value as TypeSpecValue<T>).value;
  return value as T;
}

function modelValueToObject(model: Model): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [name, prop] of model.properties) {
    const literal = unwrapValue((prop.type as unknown) as unknown);
    if (literal !== undefined) output[name] = literal;
  }
  return output;
}

function normalizeObject<T extends Record<string, unknown>>(raw: unknown): T {
  if (isModel(raw)) {
    return modelValueToObject(raw) as T;
  }

  const input = (raw ?? {}) as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const unwrapped = unwrapValue(value);
    if (unwrapped !== undefined) output[key] = unwrapped;
  }
  return output as T;
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

export function $description(context: DecoratorContext, target: ModelProperty, value: string): void {
  if (!isModelProperty(target)) return;
  const text = unwrapValue<string>(value);
  if (typeof text !== "string") return;
  context.program.stateMap(COCOGEN_STATE_PROPERTY_DESCRIPTIONS).set(target, text);
}

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

export function $content(context: DecoratorContext, target: ModelProperty): void {
  if (!isModelProperty(target)) return;
  context.program.stateMap(COCOGEN_STATE_CONTENT_PROPERTIES).set(target, true);
}

export function $source(
  context: DecoratorContext,
  target: ModelProperty,
  from: CocogenSourceSettings | string,
  to?: string | { serialized?: Model; to?: string }
): void {
  if (!isModelProperty(target)) return;

  const rawTo = unwrapValue<unknown>(to);

  if (rawTo && typeof rawTo === "object" && !Array.isArray(rawTo)) {
    const targetSettings = normalizeObject<{ serialized?: unknown; to?: unknown }>(rawTo);
    const serialized = targetSettings.serialized;
    const path = typeof targetSettings.to === "string" ? targetSettings.to.trim() : "";

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

  const rawToString = typeof rawTo === "string" ? rawTo : undefined;
  const rawToText = rawToString?.trim();
  if (typeof rawToText === "string" && rawToText.length > 0) {
    const rawFrom = unwrapValue<unknown>(from);
    const entry: CocogenPersonEntityField = {
      path: rawToText,
      source: typeof rawFrom === "string" ? rawFrom : normalizeObject<CocogenSourceSettings>(from),
    };

    pushArrayValue(context.program.stateMap(COCOGEN_STATE_PROPERTY_PERSON_FIELDS), target, entry);
    return;
  }

  const rawFrom = unwrapValue<unknown>(from);
  if (typeof rawFrom === "string") {
    const text = rawFrom.trim();
    if (text.length > 0) {
      context.program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE).set(target, text);
    }
    return;
  }

  const normalized = normalizeObject<CocogenSourceSettings>(from);
  context.program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE).set(target, normalized);
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
  $description,
  $name,
  $connection,
  $profileSource,
  $search,
  $content,
  $source,
  $noSource
);
