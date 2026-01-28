import { describe, expect, test } from "vitest";

import type { ConnectorIr } from "../../src/ir.js";
import {
  buildGraphEnumTemplates,
  buildPeopleGraphTypes,
  buildPeopleLabelSerializers,
  parseGraphTypeDescriptor,
  resolveGraphTypeName,
  type PeopleGraphTypeAlias,
} from "../../src/init/people/graph-types.js";

const baseIr: ConnectorIr = createIr([
  createIdProperty(),
  {
    name: "account",
    type: "string",
    labels: ["personAccount"],
    aliases: [],
    search: {},
    personEntity: {
      entity: "userAccountInformation",
      fields: [
        { path: "id", source: { csvHeaders: ["accountId"] } },
        { path: "detail.organization.name", source: { csvHeaders: ["organization"] } },
      ],
    },
    source: { csvHeaders: ["account"] },
  },
]);

function createIr(properties: ConnectorIr["properties"]): ConnectorIr {
  return {
    connection: {
      inputFormat: "csv",
      graphApiVersion: "beta",
      contentCategory: "people",
    },
    item: {
      typeName: "Item",
      idPropertyName: "id",
      idEncoding: "slug",
    },
    properties,
  };
}

function createIdProperty(): ConnectorIr["properties"][number] {
  return {
    name: "id",
    type: "string",
    labels: [],
    aliases: [],
    search: {},
    source: { csvHeaders: ["id"] },
  };
}

describe("init/people/graph-types", () => {
  test("buildPeopleGraphTypes produces derived types for nested mappings", () => {
    const result = buildPeopleGraphTypes(baseIr);
    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.aliases.size).toBeGreaterThan(0);
    expect(result.derived.length).toBeGreaterThan(0);
    expect(result.templates.some((template) => template.fields.length > 0)).toBe(true);
  });

  test("buildPeopleLabelSerializers emits entries for every label", () => {
    const serializers = buildPeopleLabelSerializers();
    const accountSerializer = serializers.find((s) => s.label === "personAccount");
    expect(accountSerializer).toBeDefined();
    expect(accountSerializer?.serializerName).toBe("serializePersonAccount");
  });

  test("buildGraphEnumTemplates exposes enum metadata", () => {
    const enums = buildGraphEnumTemplates();
    const relationship = enums.find((entry) => entry.name === "personRelationship");
    expect(relationship?.values).toContain("manager");
    expect(relationship?.tsName).toBe("PersonRelationship");
  });

  test("parseGraphTypeDescriptor handles collections, enums, aliases, and scalars", () => {
    const aliases = new Map<string, PeopleGraphTypeAlias>([
      ["userAccountInformation", { tsAlias: "userAccountInformation", csName: "UserAccountInformation" }],
    ]);

    const enumDescriptor = parseGraphTypeDescriptor("Collection(graph.personRelationship)", aliases);
    expect(enumDescriptor.isCollection).toBe(true);
    expect(enumDescriptor.elementExpected).toBe("personRelationship value");

    const aliasDescriptor = parseGraphTypeDescriptor("graph.userAccountInformation", aliases);
    expect(aliasDescriptor.tsType).toBe("userAccountInformation");
    expect(aliasDescriptor.typeCheck).toBe("isRecord(value)");

    const scalarCollection = parseGraphTypeDescriptor("Collection(Edm.String)", aliases);
    expect(scalarCollection.tsType).toBe("string[]");
    expect(scalarCollection.elementTypeCheck).toBe(`typeof entry === "string"`);

    expect(() => parseGraphTypeDescriptor("Edm.Guid", aliases)).toThrow(/Unsupported Graph scalar type/);
  });

  test("resolveGraphTypeName strips graph prefixes", () => {
    expect(resolveGraphTypeName("graph.userAccountInformation")).toBe("userAccountInformation");
    expect(resolveGraphTypeName("Edm.String")).toBeNull();
  });

  test("buildPeopleGraphTypes merges custom derived fields from multiple properties", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "customOne",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "customEntity",
          fields: [
            { path: "primary.value", source: { csvHeaders: ["primary"] } },
            { path: "details.manager.name", source: { csvHeaders: ["managerName"] } },
          ],
        },
        source: { csvHeaders: ["primary"] },
      },
      {
        name: "customTwo",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "customEntity",
          fields: [
            { path: "secondary.label", source: { csvHeaders: ["secondary"] } },
            { path: "details.manager.email", source: { csvHeaders: ["managerEmail"] } },
          ],
        },
        source: { csvHeaders: ["secondary"] },
      },
    ]);

    const result = buildPeopleGraphTypes(ir);
    const custom = result.derived.find((type) => type.name === "customEntity");
    expect(custom).toBeDefined();
    expect(custom?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["primary", "secondary", "details"])
    );

    const nested = result.derived.find((type) => type.name === "customEntityDetails");
    expect(nested).toBeDefined();
    expect(nested?.fields.some((field) => field.name === "manager")).toBe(true);
    expect(result.aliases.get("customEntityDetails")?.tsAlias).toBe(nested?.alias);
  });

  test("buildPeopleGraphTypes always includes itemFacet template", () => {
    const result = buildPeopleGraphTypes(baseIr);
    expect(result.templates.map((template) => template.alias)).toContain("ItemFacet");
  });

  test("parseGraphTypeDescriptor handles scalar collections and throws on unknown scalars", () => {
    const descriptor = parseGraphTypeDescriptor("Collection(Edm.Int64)", new Map());
    expect(descriptor.elementTypeCheck).toBe('typeof entry === "number"');
    expect(() => parseGraphTypeDescriptor("Edm.Guid", new Map())).toThrow(/Unsupported Graph scalar type/i);
  });

  test("parseGraphTypeDescriptor resolves graph aliases for objects and collections", () => {
    const aliases = new Map<string, PeopleGraphTypeAlias>([
      ["customType", { tsAlias: "customType", csName: "CustomType" }],
    ]);
    const single = parseGraphTypeDescriptor("graph.customType", aliases);
    expect(single.tsType).toBe("customType");
    expect(single.typeCheck).toBe("isRecord(value)");

    const collection = parseGraphTypeDescriptor("Collection(graph.customType)", aliases);
    expect(collection.tsType).toBe("customType[]");
    expect(collection.elementTypeCheck).toBe("isRecord(entry)");
  });

  test("buildDerivedFromTree handles nested object fields", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "nested",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "customEntity",
          fields: [
            { path: "level1.level2.value", source: { csvHeaders: ["value"] } },
          ],
        },
        source: { csvHeaders: ["nested"] },
      },
    ]);
    const result = buildPeopleGraphTypes(ir);
    const level1Type = result.derived.find((type) => type.name === "customEntityLevel1");
    expect(level1Type).toBeDefined();
    expect(level1Type?.fields.some((field) => field.name === "level2")).toBe(true);
  });

  test("buildDerivedFromTree merges fields when type already exists", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "prop1",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "sharedType",
          fields: [
            { path: "existing.field1", source: { csvHeaders: ["field1"] } },
          ],
        },
        source: { csvHeaders: ["prop1"] },
      },
      {
        name: "prop2",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "sharedType",
          fields: [
            { path: "existing.field1", source: { csvHeaders: ["field1-dup"] } },
            { path: "existing.field2", source: { csvHeaders: ["field2"] } },
          ],
        },
        source: { csvHeaders: ["prop2"] },
      },
    ]);
    const result = buildPeopleGraphTypes(ir);
    const sharedType = result.derived.find((type) => type.name === "sharedType");
    expect(sharedType?.fields.length).toBeGreaterThan(0);
    const existingNested = result.derived.find((type) => type.name === "sharedTypeExisting");
    expect(existingNested).toBeDefined();
    expect(existingNested?.fields.some((f) => f.name === "field2")).toBe(true);
  });

  test("buildDerivedFromTree refreshes nested types when key already exists", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "prop1",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "sharedType",
          fields: [
            { path: "details.manager.name", source: { csvHeaders: ["managerName"] } },
          ],
        },
        source: { csvHeaders: ["prop1"] },
      },
      {
        name: "prop2",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "sharedType",
          fields: [
            { path: "details.manager.title", source: { csvHeaders: ["managerTitle"] } },
          ],
        },
        source: { csvHeaders: ["prop2"] },
      },
    ]);

    const result = buildPeopleGraphTypes(ir);
    const nestedManager = result.derived.find((type) => type.name === "sharedTypeDetailsManager");
    expect(nestedManager).toBeDefined();
    expect(nestedManager?.fields.some((field) => field.name === "title")).toBe(true);
  });

  test("buildDerivedFromTree handles field name collision with suffix incrementation", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "collision",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "entityWithCollision",
          fields: [
            { path: "value", source: { csvHeaders: ["value1"] } },
            { path: "other", source: { csvHeaders: ["other"] } },
          ],
        },
        source: { csvHeaders: ["collision"] },
      },
    ]);
    const result = buildPeopleGraphTypes(ir);
    const entity = result.derived.find((type) => type.name === "entityWithCollision");
    expect(entity?.fields.map((f) => f.varName)).toContain("value");
    expect(entity?.fields.map((f) => f.varName)).toContain("other");
  });

  test("parseGraphTypeDescriptor handles GRAPH_STRING_TYPES in collections", () => {
    const aliases = new Map<string, PeopleGraphTypeAlias>();
    const descriptor = parseGraphTypeDescriptor("Collection(graph.emailType)", aliases);
    expect(descriptor.tsType).toBe("string[]");
    expect(descriptor.elementTypeCheck).toBe('typeof entry === "string"');
    expect(descriptor.elementExpected).toBe("a string");
  });

  test("parseGraphTypeDescriptor handles graph entity collections with aliases", () => {
    const aliases = new Map<string, PeopleGraphTypeAlias>([
      ["userAccountInformation", { tsAlias: "userAccountInformation", csName: "UserAccountInformation" }],
    ]);
    const descriptor = parseGraphTypeDescriptor("Collection(graph.userAccountInformation)", aliases);
    expect(descriptor.tsType).toBe("userAccountInformation[]");
    expect(descriptor.isCollection).toBe(true);
    expect(descriptor.elementTypeCheck).toBe("isRecord(entry)");
  });

  test("buildDerivedFromTree creates new type when not existing", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "newType",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "brandNewType",
          fields: [
            { path: "field1", source: { csvHeaders: ["f1"] } },
            { path: "field2", source: { csvHeaders: ["f2"] } },
          ],
        },
        source: { csvHeaders: ["newType"] },
      },
    ]);
    const result = buildPeopleGraphTypes(ir);
    const newType = result.derived.find((type) => type.name === "brandNewType");
    expect(newType).toBeDefined();
    expect(newType?.fields.length).toBe(2);
    expect(newType?.csProperties.length).toBe(2);
  });

  test("parseGraphTypeDescriptor handles collection of enum types", () => {
    const aliases = new Map<string, PeopleGraphTypeAlias>();
    const descriptor = parseGraphTypeDescriptor("Collection(graph.personRelationship)", aliases);
    expect(descriptor.tsType).toBe("PersonRelationship[]");
    expect(descriptor.isCollection).toBe(true);
    expect(descriptor.elementTypeCheck).toBe("isPersonRelationship(entry)");
    expect(descriptor.elementExpected).toBe("personRelationship value");
  });

  test("parseGraphTypeDescriptor handles single enum types", () => {
    const aliases = new Map<string, PeopleGraphTypeAlias>();
    const descriptor = parseGraphTypeDescriptor("graph.personRelationship", aliases);
    expect(descriptor.tsType).toBe("PersonRelationship");
    expect(descriptor.isCollection).toBe(false);
    expect(descriptor.typeCheck).toBe("isPersonRelationship(value)");
    expect(descriptor.expected).toBe("personRelationship value");
  });

  test("buildPeopleGraphTypes processes custom graph types not in schema", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "customGraph",
        type: "graph.customGraphType",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "customGraphType",
          fields: [
            { path: "prop1", source: { csvHeaders: ["prop1"] } },
            { path: "prop2", source: { csvHeaders: ["prop2"] } },
          ],
        },
        source: { csvHeaders: ["customGraph"] },
      },
    ]);
    const result = buildPeopleGraphTypes(ir);
    const customType = result.derived.find((type) => type.name === "customGraphType");
    expect(customType).toBeDefined();
    expect(customType?.fields.length).toBe(2);
  });

  test("toPeopleFieldVarName handles naming collisions with incrementing suffix", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "dup",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "duplicateEntity",
          fields: [
            { path: "data", source: { csvHeaders: ["data1"] } },
          ],
        },
        source: { csvHeaders: ["dup"] },
      },
    ]);
    const result = buildPeopleGraphTypes(ir);
    const entity = result.derived.find((type) => type.name === "duplicateEntity");
    expect(entity?.fields.length).toBeGreaterThan(0);
    expect(entity?.fields[0]?.varName).toBe("data");
  });

  test("handles graph type property that references non-schema custom type", () => {
    const ir = createIr([
      createIdProperty(),
      {
        name: "customRef",
        type: "graph.customNonSchemaType",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "customNonSchemaType",
          fields: [
            { path: "field1", source: { csvHeaders: ["field1"] } },
            { path: "field2", source: { csvHeaders: ["field2"] } },
          ],
        },
        source: { csvHeaders: ["customRef"] },
      },
    ]);
    const result = buildPeopleGraphTypes(ir);
    const customType = result.derived.find((t) => t.name === "customNonSchemaType");
    expect(customType).toBeDefined();
    expect(customType?.fields.length).toBe(2);
  });
});
