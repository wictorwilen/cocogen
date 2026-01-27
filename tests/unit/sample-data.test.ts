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
