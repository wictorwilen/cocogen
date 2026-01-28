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
});
