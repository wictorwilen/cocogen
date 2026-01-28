import type { ConnectorIr } from "../../ir.js";
import { PEOPLE_LABEL_DEFINITIONS } from "../../people/label-registry.js";
import { graphProfileSchema, getProfileType, type GraphProfileProperty } from "../../people/profile-schema.js";
import { buildObjectTree } from "../object-tree.js";
import { toCsPascal, toTsIdentifier } from "../naming.js";
import type { PersonEntityField } from "../shared-types.js";

export type PeopleGraphFieldTemplate = {
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

export type PeopleGraphTypeTemplate = {
  alias: string;
  fields: PeopleGraphFieldTemplate[];
  baseAlias?: string;
};

export type PeopleGraphTypeAlias = {
  tsAlias: string;
  csName: string;
};

export type DerivedPeopleGraphType = {
  name: string;
  alias: string;
  csName: string;
  fields: PeopleGraphFieldTemplate[];
  csProperties: Array<{ name: string; csName: string; csType: string; nullable: boolean }>;
};

export const GRAPH_STRING_TYPES = new Set<string>([
  "graph.emailType",
  "graph.phoneType",
  "graph.skillProficiencyLevel",
  "graph.personAnnualEventType",
  "graph.itemBody",
]);

export const GRAPH_ENUM_TYPES = new Map<string, string[]>([
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

/** Strip the graph. prefix to get a profile schema type name. */
export function resolveGraphTypeName(typeName: string): string | null {
  return typeName.startsWith("graph.") ? typeName.slice("graph.".length) : null;
}

export type PeopleLabelSerializerTemplate = {
  label: string;
  serializerName: string;
  graphTypeAlias: string;
  isCollection: boolean;
  collectionLimit: number | null;
};

/** Build people graph type templates and alias mappings. */
export function buildPeopleGraphTypes(ir: ConnectorIr): {
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

/** Build serializer templates for person labels. */
export function buildPeopleLabelSerializers(): PeopleLabelSerializerTemplate[] {
  return [...PEOPLE_LABEL_DEFINITIONS.entries()].map(([label, def]) => ({
    label,
    serializerName: `serialize${toTsIdentifier(label)}`,
    graphTypeAlias: toTsIdentifier(def.graphTypeName),
    isCollection: def.payloadTypes.includes("stringCollection"),
    collectionLimit: def.constraints.collectionLimit ?? null,
  }));
}

/** Build enum templates for Graph enum-like types. */
export function buildGraphEnumTemplates(): Array<{ name: string; tsName: string; csName: string; values: string[] }> {
  return [...GRAPH_ENUM_TYPES.entries()].map(([name, values]) => ({
    name,
    tsName: toTsIdentifier(name),
    csName: toCsPascal(name),
    values: [...values],
  }));
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

/** Build derived graph types from mapped person-entity fields. */
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

/** Build mapping from graph type names to TS/C# aliases. */
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

/** Convert a graph schema property into a template field. */
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

/** Parse graph property types into TS type descriptors. */
export function parseGraphTypeDescriptor(
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

/** Resolve scalar descriptors for Graph/Edm types. */
function getScalarDescriptor(typeName: string): ScalarTypeDescriptor {
  switch (typeName) {
    case "Edm.String":
    case "Edm.Date":
    case "Edm.DateTimeOffset":
    case "Edm.TimeOfDay":
      return { tsType: "string", expected: "a string", check: (varName) => `typeof ${varName} === \"string\"` };
    case "Edm.Boolean":
      return { tsType: "boolean", expected: "a boolean", check: (varName) => `typeof ${varName} === \"boolean\"` };
    case "Edm.Int32":
    case "Edm.Int64":
    case "Edm.Double":
      return { tsType: "number", expected: "a number", check: (varName) => `typeof ${varName} === \"number\"` };
    default:
      throw new Error(`Unsupported Graph scalar type '${typeName}'. Update getScalarDescriptor to map this type.`);
  }
}

/** Create a unique JS variable name for a people field. */
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
