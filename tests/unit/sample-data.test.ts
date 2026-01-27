import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";

import type { ConnectorIr } from "../../src/ir.js";
import {
  buildSampleCsv,
  buildSampleJson,
  buildSamplePersonEntityPayload,
  buildSampleYaml,
  exampleValueForPayload,
  exampleValueForType,
  samplePayloadValueForType,
} from "../../src/init/sample-data.js";

type SourceDescriptor = { csvHeaders: string[]; jsonPath?: string };

test("example helpers normalize values", () => {
  expect(exampleValueForType(["a", "b"], "stringCollection")).toBe("a;b");
  expect(exampleValueForType("a;b", "stringCollection")).toBe("a;b");
  expect(exampleValueForType(123, "stringCollection")).toBe("123");
  expect(exampleValueForType(true, "string")).toBe("true");
  expect(exampleValueForType({ foo: "bar" }, "string")).toBe("{\"foo\":\"bar\"}");

  expect(exampleValueForPayload("a; b", "stringCollection")).toEqual(["a", "b"]);
  expect(exampleValueForPayload(["x"], "stringCollection")).toEqual(["x"]);
  expect(exampleValueForPayload("solo", "string")).toBe("solo");
});

test("sample payload values include principal data", () => {
  const source: SourceDescriptor = { csvHeaders: ["owner"], jsonPath: "owner" };
  const fields = [{ path: "userPrincipalName", source }];

  const principal = samplePayloadValueForType("principal", fields, source) as Record<string, unknown>;
  expect(principal["@odata.type"]).toBe("microsoft.graph.externalConnectors.principal");
  expect(principal.upn).toBe("user@contoso.com");

  const principalCollection = samplePayloadValueForType(
    "principalCollection",
    fields,
    source
  ) as Array<Record<string, unknown>>;
  expect(principalCollection).toHaveLength(2);
  expect(principalCollection[0]?.upn).toBe("user@contoso.com");
  expect(principalCollection[1]?.upn).toBe("user1@contoso.com");
});

test("buildSamplePersonEntityPayload returns JSON strings", () => {
  const fields = [
    {
      path: "detail.jobTitle",
      source: { csvHeaders: ["job title"], jsonPath: "detail.jobTitle" },
    },
  ];

  const single = buildSamplePersonEntityPayload(fields, false);
  expect(typeof single).toBe("string");
  expect(JSON.parse(single as string)).toEqual({ detail: { jobTitle: "Software Engineer" } });

  const collection = buildSamplePersonEntityPayload(fields, true);
  expect(Array.isArray(collection)).toBe(true);
  const parsed = (collection as string[]).map((value) => JSON.parse(value));
  expect(parsed[0]).toEqual({ detail: { jobTitle: "Software Engineer" } });
});

describe("sample data generation", () => {
  const ir: ConnectorIr = {
    connection: {
      inputFormat: "json",
      graphApiVersion: "beta",
    },
    item: {
      typeName: "Item",
      idPropertyName: "id",
      idEncoding: "slug",
    },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"], jsonPath: "$.id" },
      },
      {
        name: "tag",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["tag"], jsonPath: "$.tags[0]" },
      },
      {
        name: "sourceId",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["source"], jsonPath: "$.meta['source.id']" },
      },
      {
        name: "owner",
        type: "principal",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["owner"], jsonPath: "$.owner" },
      },
      {
        name: "skills",
        type: "stringCollection",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "skillProficiency",
          fields: [
            {
              path: "skills.name",
              source: { csvHeaders: ["skill"], jsonPath: "$.details.skills[*].name" },
            },
          ],
        },
        source: { csvHeaders: ["skill"], jsonPath: "$.details.skills[*].name" },
      },
    ],
  };

  test("buildSampleJson handles jsonPath arrays and quoted keys", () => {
    const json = buildSampleJson(ir);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    const item = parsed[0] ?? {};

    expect((item.tags as unknown[])[0]).toBe("sample");
    expect((item.meta as Record<string, unknown>)["source.id"]).toBe("sample");
    expect(Object.prototype.hasOwnProperty.call(item, "$"))
      .toBe(false);

    const details = item.details as Record<string, unknown>;
    const skills = details.skills as Array<Record<string, unknown>>;
    expect(skills[0]?.name).toBe("TypeScript");
    expect(skills[1]?.name).toBe("Python");
  });

  test("buildSampleYaml mirrors JSON output and ends with newline", () => {
    const yaml = buildSampleYaml(ir);
    expect(yaml.endsWith("\n")).toBe(true);

    const parsed = parseYaml(yaml) as Array<Record<string, unknown>>;
    const item = parsed[0] ?? {};
    expect((item.tags as unknown[])[0]).toBe("sample");
    expect((item.meta as Record<string, unknown>)["source.id"]).toBe("sample");
  });
  
  test("buildSampleCsv formats serialized values", () => {
    const serializedIr: ConnectorIr = {
      connection: { inputFormat: "csv", graphApiVersion: "v1.0" },
      item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
      properties: [
        {
          name: "id",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["id"] },
        },
        {
          name: "products",
          type: "stringCollection",
          labels: [],
          aliases: [],
          search: {},
          serialized: {
            name: "Product",
            fields: [
              { name: "name", type: "string" },
              { name: "productId", type: "string" },
            ],
          },
          source: { csvHeaders: ["products"] },
        },
      ],
    };

    const csv = buildSampleCsv(serializedIr);
    const [, values] = csv.trimEnd().split("\n");
    expect(values).toMatch(/productId/);
  });

  test("buildSampleJson handles serialized models", () => {
    const serializedIr: ConnectorIr = {
      connection: {
        inputFormat: "json",
        graphApiVersion: "v1.0",
      },
      item: {
        typeName: "Item",
        idPropertyName: "id",
        idEncoding: "slug",
      },
      properties: [
        {
          name: "id",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["id"], jsonPath: "$.id" },
        },
        {
          name: "products",
          type: "stringCollection",
          labels: [],
          aliases: [],
          search: {},
          serialized: {
            name: "Product",
            fields: [
              { name: "odata@type", type: "string", example: "https://schema.org/Product" },
              { name: "name", type: "string" },
              { name: "productId", type: "string" },
            ],
          },
          source: { csvHeaders: ["products"], jsonPath: "$.products" },
        },
      ],
    };
  
    const json = buildSampleJson(serializedIr);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    const item = parsed[0] ?? {};
    const products = item.products as Array<Record<string, unknown>>;
    expect(Array.isArray(products)).toBe(true);
    expect(products[0]?.name).toBe("sample");
    expect(products[0]?.productId).toBe("sample");
      expect(products[0]?.["odata@type"]).toBe("https://schema.org/Product");
  });

  test("buildSampleJson handles nested people arrays", () => {
    const nestedIr: ConnectorIr = {
      connection: {
        inputFormat: "json",
        graphApiVersion: "beta",
      },
      item: {
        typeName: "Item",
        idPropertyName: "id",
        idEncoding: "slug",
      },
      properties: [
        {
          name: "id",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["id"], jsonPath: "$.id" },
        },
        {
          name: "collaborationTags",
          type: "stringCollection",
          labels: ["personProject"],
          aliases: [],
          search: {},
          source: { csvHeaders: ["tags"], jsonPath: "$.detail.positions[*].collaborationTags[*]" },
          personEntity: {
            entity: "workPosition",
            fields: [
              {
                path: "detail.positions.collaborationTags",
                source: { csvHeaders: ["tags"], jsonPath: "$.detail.positions[*].collaborationTags[*]" },
              },
            ],
          },
        },
      ],
    };

    const json = buildSampleJson(nestedIr);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    const item = parsed[0] ?? {};
    const detail = item.detail as Record<string, unknown>;
    const positions = detail.positions as Array<Record<string, unknown>>;
    expect(Array.isArray(positions)).toBe(true);
    expect(Array.isArray(positions[0]?.collaborationTags)).toBe(true);
    expect((positions[0]?.collaborationTags as unknown[])[0]).toBe("alpha");
  });

  test("buildSampleJson handles bracket-style paths", () => {
    const bracketIr: ConnectorIr = {
      connection: { inputFormat: "json", graphApiVersion: "v1.0" },
      item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
      properties: [
        {
          name: "id",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["id"], jsonPath: "$.id" },
        },
        {
          name: "odd",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["odd"], jsonPath: "$['123key']" },
        },
      ],
    };

    const json = buildSampleJson(bracketIr);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    expect((parsed[0] as Record<string, unknown>)["123key"]).toBe("sample");
  });

  test("buildSampleCsv escapes headers and samples principals", () => {
    const csv = buildSampleCsv({
      ...ir,
      connection: { ...ir.connection, inputFormat: "csv" },
      properties: [
        {
          name: "special",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["header,with,comma"], jsonPath: "special" },
        },
        {
          name: "owner",
          type: "principal",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["owner"], jsonPath: "owner" },
        },
      ],
    });

    const [headers, values] = csv.trim().split("\n");
    expect(headers).toContain("\"header,with,comma\"");
    expect(values).toContain("alice@contoso.com");
  });
});

test("exampleValueForPayload normalizes non-collection numbers to collection strings", () => {
  expect(exampleValueForPayload(123, "stringCollection")).toEqual(["123"]);
});

test("samplePayloadValueForType builds principal payload without source mappings", () => {
  const principal = samplePayloadValueForType("principal", null, { csvHeaders: [], jsonPath: undefined });
  expect((principal as Record<string, unknown>).upn).toBe("user@contoso.com");
});

test("buildSampleCsv uses header-aware sample values", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "csv", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"] },
      },
      {
        name: "level",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["skill level"] },
      },
      {
        name: "proficiency",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["proficiency"] },
      },
    ],
  };

  const csv = buildSampleCsv(ir);
  expect(csv).toContain("skill level");
  expect(csv).toContain("expert;intermediate");
  expect(csv).toContain("advancedProfessional;expert");
});

test("buildSampleJson handles wildcard array steps", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"], jsonPath: "$.items[*].id" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
  expect((parsed[0] as Record<string, unknown>).items).toBeDefined();
});

test("buildSampleJson preserves escaped dots in jsonPath", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"], jsonPath: "$.id" },
      },
      {
        name: "escaped",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["escaped"], jsonPath: "$.foo\\.bar.value" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, any>>;
  expect(parsed[0]?.foo?.value).toBe("sample");
});

test("buildSampleJson handles multi-dimensional indexes", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "MatrixItem", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"], jsonPath: "$[0]" },
      },
      {
        name: "cell",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["cell"], jsonPath: "$.matrix[0][1]" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, any>>;
  expect(Array.isArray(parsed[0]?.matrix)).toBe(true);
  expect(parsed[0]?.matrix[0]?.[1]).toBe("sample");
});

test("buildSampleJson skips empty jsonPath gracefully", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"], jsonPath: "   " },
      },
      {
        name: "title",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["title"], jsonPath: "" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, any>>;
  expect(parsed[0]?.id).toBeUndefined();
  expect(parsed[0]?.title).toBeUndefined();
});

test("buildSampleCsv escapes quotes in headers and values", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "csv", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ['he"ad'] },
      },
      {
        name: "quoteValue",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        example: 'va"lue',
        source: { csvHeaders: ["quoteValue"] },
      },
    ],
  };

  const csv = buildSampleCsv(ir);
  const [headerLine, valueLine] = csv.trimEnd().split("\n");
  expect(headerLine).toContain('\"he\"\"ad\"');
  expect(valueLine).toContain('\"va\"\"lue\"');
});

test("samplePayloadValueForType includes tenantId mapping", () => {
  const fields = [{ path: "tenantId", source: { csvHeaders: ["tenantId"] } }];
  const payload = samplePayloadValueForType("principal", fields, { csvHeaders: ["tenantId"] });
  expect((payload as Record<string, unknown>).tenantId).toBe("00000000-0000-0000-0000-000000000000");
});

test("buildSampleJson handles quoted bracket segments", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"], jsonPath: "$.id" },
      },
      {
        name: "quoted",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["quoted"], jsonPath: "$.foo[\"bar.baz\"]" },
      },
      {
        name: "emptyBracket",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["empty"], jsonPath: "$.empty[]" },
      },
      {
        name: "unmatched",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["unmatched"], jsonPath: "$.[foo" },
      },
      {
        name: "numericStart",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["numeric"], jsonPath: "$.123name" },
      },
      {
        name: "escapedBracket",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["escapedBracket"], jsonPath: "$.escape['a\\\\'b']" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, any>>;
  expect(parsed[0]?.foo?.["bar.baz"]).toBe("sample");
  expect(parsed[0]?.foo).toBeDefined();
  expect(parsed[0]?.["[foo"]).toBe("sample");
  expect(parsed[0]?.["123name"]).toBe("sample");
  expect(parsed[0]).toHaveProperty("escape");
});

test("samplePayloadValueForType returns defaults for collections and doubles", () => {
  expect(samplePayloadValueForType("double", null, { csvHeaders: [] })).toBe(1.23);
  expect(samplePayloadValueForType("stringCollection", null, { csvHeaders: [] })).toEqual(["alpha", "beta"]);
});

test("samplePayloadValueForType uses sample value for unknown principal keys", () => {
  const fields = [{ path: "customKey", source: { csvHeaders: ["customKey"] } }];
  const payload = samplePayloadValueForType("principal", fields, { csvHeaders: ["customKey"] });
  expect((payload as Record<string, unknown>).customKey).toBe("sample-customKey");
});

test("buildSampleJson converts primitive array element to object when needed", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "rootValue",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["rootValue"], jsonPath: "$.arr[0]" },
      },
      {
        name: "child",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["child"], jsonPath: "$.arr[0].child" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, any>>;
  expect(parsed[0]?.arr?.[0]?.child).toBe("sample");
});

test("buildSampleJson handles unquoted bracket identifiers", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"], jsonPath: "$.foo[bar]" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, any>>;
  expect(parsed[0]?.foo?.bar).toBe("sample");
});

test("buildSampleJson handles serialized string payload", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"], jsonPath: "$.id" },
      },
      {
        name: "details",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        serialized: {
          name: "Detail",
          fields: [
            { name: "name", type: "string" },
            { name: "level", type: "string" },
          ],
        },
        source: { csvHeaders: ["details"], jsonPath: "$.details" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, any>>;
  expect(parsed[0]?.details?.name).toBe("sample");
  expect(parsed[0]?.details?.level).toBe("sample");
});

test("samplePayloadValueForType uses default principal key mapping for collections", () => {
  const fields = [{ path: "custom", source: { csvHeaders: ["custom"] } }];
  const payload = samplePayloadValueForType("principalCollection", fields, { csvHeaders: ["custom"] }) as Array<
    Record<string, unknown>
  >;
  expect(payload[0]?.custom).toBe("sample-custom");
});

test("samplePayloadValueForType maps display name principal keys", () => {
  const fields = [{ path: "externalName", source: { csvHeaders: ["displayName"] } }];
  const payload = samplePayloadValueForType("principal", fields, { csvHeaders: ["displayName"] }) as Record<
    string,
    unknown
  >;
  expect(payload.externalName).toBe("Ada Lovelace");
});

test("samplePayloadValueForType sets externalName suffix for principal collections", () => {
  const fields = [{ path: "externalName", source: { csvHeaders: ["displayName"] } }];
  const payload = samplePayloadValueForType("principalCollection", fields, { csvHeaders: ["displayName"] }) as Array<
    Record<string, unknown>
  >;
  expect(payload[1]?.externalName).toBe("Ada Lovelace 1");
});

test("buildSampleJson expands personEntity wildcards into arrays", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "json", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "skills",
        type: "stringCollection",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "workPosition",
          fields: [
            { path: "detail.skills.name", source: { csvHeaders: ["skill"], jsonPath: "$.detail.skills[*].name" } },
            { path: "detail.skills.level", source: { csvHeaders: ["level"], jsonPath: "$.detail.skills[*].level" } },
          ],
        },
        source: { csvHeaders: ["skill"], jsonPath: "$.detail.skills[*].name" },
      },
    ],
  };

  const json = buildSampleJson(ir);
  const parsed = JSON.parse(json) as Array<Record<string, any>>;
  const skills = parsed[0]?.detail?.skills as Array<Record<string, unknown>>;
  expect(Array.isArray(skills)).toBe(true);
  expect(skills[0]?.name).toBeDefined();
  expect(skills[0]?.level).toBeDefined();
});

test("buildSampleCsv uses personEntity example when single field provided", () => {
  const ir: ConnectorIr = {
    connection: { inputFormat: "csv", graphApiVersion: "v1.0" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "skills",
        type: "stringCollection",
        labels: [],
        aliases: [],
        search: {},
        example: "custom-skill",
        personEntity: {
          entity: "workPosition",
          fields: [{ path: "detail.skills.name", source: { csvHeaders: ["skill"], jsonPath: "$.detail.skills[*].name" } }],
        },
        source: { csvHeaders: ["skill"], jsonPath: "$.detail.skills[*].name" },
      },
    ],
  };

  const csv = buildSampleCsv(ir);
  const values = csv.trim().split("\n")[1] ?? "";
  expect(values).toContain("custom-skill");
});
