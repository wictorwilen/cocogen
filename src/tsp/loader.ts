import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NodeHost,
  compile,
  formatDiagnostic,
  getDoc,
  isArrayModelType,
  type Model,
  type ModelProperty,
  type Program,
  type Scalar,
  type Type,
} from "@typespec/compiler";

import type { ConnectorIr, GraphApiVersion, PropertyType, SearchFlags } from "../ir.js";
import {
  COCOGEN_STATE_CONNECTION_SETTINGS,
  COCOGEN_STATE_PROFILE_SOURCE_SETTINGS,
  COCOGEN_STATE_CONTENT_PROPERTIES,
  COCOGEN_STATE_ID_PROPERTIES,
  COCOGEN_STATE_ITEM_MODELS,
  COCOGEN_STATE_PROPERTY_ALIASES,
  COCOGEN_STATE_PROPERTY_DESCRIPTIONS,
  COCOGEN_STATE_PROPERTY_LABELS,
  COCOGEN_STATE_PROPERTY_NAME_OVERRIDES,
  COCOGEN_STATE_PROPERTY_SEARCH,
  COCOGEN_STATE_PROPERTY_SOURCE,
  COCOGEN_STATE_PROPERTY_PERSON_FIELDS,
  type CocogenConnectionSettings,
  type CocogenProfileSourceSettings,
  type CocogenSearchFlags,
  type CocogenSourceSettings,
  type CocogenPersonEntityField,
} from "../typespec/state.js";

export class CocogenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CocogenError";
  }
}

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
  explicit: boolean
): { csvHeaders: string[]; explicit: boolean } {
  const settings = (raw ?? {}) as CocogenSourceSettings | string | undefined;
  const csv = typeof settings === "string" ? settings : settings?.csv;

  let csvHeaders: string[] = [];
  if (typeof csv === "string") {
    csvHeaders = csv.trim().length > 0 ? [csv] : [];
  } else if (Array.isArray(csv)) {
    throw new CocogenError(
      "Source field merging is not supported. Use a single CSV header per property or preprocess your data."
    );
  }

  if (csvHeaders.length === 0) {
    csvHeaders = [fallbackName];
  }

  return {
    csvHeaders,
    explicit,
  };
}

function getSourceSettings(program: Program, prop: ModelProperty, fallbackName: string): {
  csvHeaders: string[];
  explicit: boolean;
} {
  const map = program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE);
  const raw = map.get(prop) as CocogenSourceSettings | string | undefined;
  const explicit = map.has(prop);
  return normalizeSourceSettings(raw, fallbackName, explicit);
}

function getPersonEntityMapping(
  program: Program,
  prop: ModelProperty
): {
  entity:
    | "userAccountInformation"
    | "personName"
    | "workPosition"
    | "itemAddress"
    | "itemEmail"
    | "itemPhone"
    | "personAward"
    | "personCertification"
    | "projectParticipation"
    | "skillProficiency"
    | "webAccount"
    | "personWebsite"
    | "personAnniversary"
    | "personAnnotation";
  fields: Array<{ path: string; source: { csvHeaders: string[]; explicit: boolean } }>;
} | undefined {
  const labelToEntity = new Map<
    string,
    | "userAccountInformation"
    | "personName"
    | "workPosition"
    | "itemAddress"
    | "itemEmail"
    | "itemPhone"
    | "personAward"
    | "personCertification"
    | "projectParticipation"
    | "skillProficiency"
    | "webAccount"
    | "personWebsite"
    | "personAnniversary"
    | "personAnnotation"
  >([
    ["personAccount", "userAccountInformation"],
    ["personName", "personName"],
    ["personCurrentPosition", "workPosition"],
    ["personAddresses", "itemAddress"],
    ["personEmails", "itemEmail"],
    ["personPhones", "itemPhone"],
    ["personAwards", "personAward"],
    ["personCertifications", "personCertification"],
    ["personProjects", "projectParticipation"],
    ["personSkills", "skillProficiency"],
    ["personWebAccounts", "webAccount"],
    ["personWebSite", "personWebsite"],
    ["personAnniversaries", "personAnniversary"],
    ["personNote", "personAnnotation"],
  ]);

  const labels = getStringArray(program, COCOGEN_STATE_PROPERTY_LABELS, prop);
  const entity = labels.map((label) => labelToEntity.get(label)).find(Boolean);

  const rawFields =
    (program.stateMap(COCOGEN_STATE_PROPERTY_PERSON_FIELDS).get(prop) as CocogenPersonEntityField[]) ?? [];

  const fields = rawFields
    .map((field) => {
      const path = typeof field.path === "string" ? field.path : "";
      if (!path) return undefined;
      const source = normalizeSourceSettings(field.source, path, true);
      return { path, source };
    })
    .filter((value): value is { path: string; source: { csvHeaders: string[]; explicit: boolean } } => Boolean(value));

  if (fields.length === 0) return undefined;
  if (!entity) {
    throw new CocogenError(
      `Property '${prop.name}' maps people entity fields but is missing a people label. Add @coco.label("person...").`
    );
  }

  return {
    entity,
    fields,
  };
}

function getDescription(program: Program, prop: ModelProperty): string | undefined {
  const fromDecorator = program.stateMap(COCOGEN_STATE_PROPERTY_DESCRIPTIONS).get(prop) as string | undefined;
  if (fromDecorator && fromDecorator.trim().length > 0) return fromDecorator;

  const fromDoc = getDoc(program, prop);
  if (fromDoc && fromDoc.trim().length > 0) return fromDoc;

  return undefined;
}

function getName(program: Program, prop: ModelProperty): string {
  const override = program.stateMap(COCOGEN_STATE_PROPERTY_NAME_OVERRIDES).get(prop) as string | undefined;
  return override ?? prop.name;
}

function isContentProperty(program: Program, prop: ModelProperty): boolean {
  return Boolean(program.stateMap(COCOGEN_STATE_CONTENT_PROPERTIES).get(prop));
}

function isIdProperty(program: Program, prop: ModelProperty): boolean {
  return Boolean(program.stateMap(COCOGEN_STATE_ID_PROPERTIES).get(prop));
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
      // Graph does not list principalCollection in externalConnectors.propertyType.
      throw new CocogenError(
        "principalCollection is not supported by Microsoft Graph external connectors schema (no official propertyType value). Use a different representation."
      );
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
        break;
    }
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

export async function loadIrFromTypeSpec(entryTspPath: string): Promise<ConnectorIr> {
  const program = await compileTypeSpec(entryTspPath);
  if (program.hasError()) {
    const formatted = program.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => formatDiagnostic(d, { pretty: true, pathRelativeTo: process.cwd() }))
      .join("\n");

    throw new CocogenError(`TypeSpec compilation failed:\n${formatted}`);
  }

  const itemModel = requireSingleItemModel(program);

  const connection = getConnectionSettings(program, itemModel);
  const profileSource = getProfileSourceSettings(program, itemModel);
  const properties = [...itemModel.properties.values()];

  const idProps = properties.filter((p) => isIdProperty(program, p));
  if (idProps.length !== 1) {
    throw new CocogenError(
      idProps.length === 0
        ? "Missing @coco.id property. Add @coco.id to the property that uniquely identifies items."
        : `Multiple @coco.id properties found (${idProps.map((p) => p.name).join(", ")}). Use exactly one.`
    );
  }

  const contentProps = properties.filter((p) => isContentProperty(program, p));
  const contentPropName = contentProps.length > 0 ? getName(program, contentProps[0]!) : undefined;

  const irProperties: ConnectorIr["properties"] = properties.map((prop) => {
    const name = getName(program, prop);
    const labels = getStringArray(program, COCOGEN_STATE_PROPERTY_LABELS, prop);
    const aliases = getStringArray(program, COCOGEN_STATE_PROPERTY_ALIASES, prop);
    const description = getDescription(program, prop);

    const personEntity = getPersonEntityMapping(program, prop);

    return {
      name,
      type: mapTypeToPropertyType(program, prop.type),
      ...(description ? { description } : {}),
      labels,
      aliases,
      search: getSearchFlags(program, prop),
      ...(personEntity ? { personEntity } : {}),
      source: getSourceSettings(program, prop, name),
    };
  });

  const usesPrincipal = irProperties.some((prop) => prop.type === "principal");
  const graphApiVersion = computeGraphApiVersion(connection.contentCategory, usesPrincipal);

  const connectionCategory = connection.contentCategory;
  const connectionId = typeof connection.connectionId === "string" ? connection.connectionId.trim() : "";
  const connectionDescription =
    typeof connection.connectionDescription === "string" ? connection.connectionDescription.trim() : "";
  return {
    connection: {
      ...(connectionCategory ? { contentCategory: connectionCategory } : {}),
      ...(connectionId ? { connectionId } : {}),
      ...(connectionDescription ? { connectionDescription } : {}),
      ...(profileSource ? { profileSource } : {}),
      graphApiVersion,
    },
    item: {
      typeName: itemModel.name,
      idPropertyName: getName(program, idProps[0]!),
      ...(contentPropName ? { contentPropertyName: contentPropName } : {}),
    },
    properties: irProperties,
  };
}
