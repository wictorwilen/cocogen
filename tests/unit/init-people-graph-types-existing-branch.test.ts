import { describe, expect, test, vi } from "vitest";

import type { ConnectorIr } from "../../src/ir.js";

const createIr = (properties: ConnectorIr["properties"]): ConnectorIr => ({
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
});

const createIdProperty = (): ConnectorIr["properties"][number] => ({
  name: "id",
  type: "string",
  labels: [],
  aliases: [],
  search: {},
  source: { csvHeaders: ["id"] },
});

describe("init/people/graph-types existing branch", () => {
  test("merges fields when derived type already exists", async () => {
    vi.resetModules();
    vi.doMock("../../src/people/label-registry.js", () => ({
      PEOPLE_LABEL_DEFINITIONS: new Map([
        [
          "customLabel",
          {
            graphTypeName: "ownerType",
            payloadTypes: ["string"],
            constraints: {},
          },
        ],
      ]),
    }));
    vi.doMock("../../src/people/profile-schema.js", () => {
      const graphProfileSchema = {
        types: [
          { name: "itemFacet", properties: [] },
          {
            name: "ownerType",
            properties: [
              { name: "left", type: "graph.customDerived" },
              { name: "right", type: "graph.customDerived" },
            ],
          },
        ],
      } as const;
      const getProfileType = (name: string) =>
        graphProfileSchema.types.find((type) => type.name === name) ?? null;
      return { graphProfileSchema, getProfileType };
    });

    const { buildPeopleGraphTypes } = await import("../../src/init/people/graph-types.js");

    const ir = createIr([
      createIdProperty(),
      {
        name: "custom",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        personEntity: {
          entity: "ownerType",
          fields: [
            { path: "left.value", source: { csvHeaders: ["leftValue"] } },
            { path: "right.value2", source: { csvHeaders: ["rightValue"] } },
          ],
        },
        source: { csvHeaders: ["custom"] },
      },
    ]);

    const result = buildPeopleGraphTypes(ir);
    const derived = result.derived.find((type) => type.name === "customDerived");
    expect(derived).toBeDefined();
    expect(derived?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["value", "value2"])
    );
  });
});
