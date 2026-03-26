import { describe, expect, test, vi } from "vitest";

import {
  collectGraphRequirementReasons,
  formatPreviewFeatureRequirement,
  getGraphBetaNoteLines,
  getGraphOperationRequirements,
} from "../../src/graph/requirements.js";
import type { ConnectorIr } from "../../src/ir.js";

const baseIr: ConnectorIr = {
  connection: {
    graphApiVersion: "v1.0",
    inputFormat: "csv",
    connectionId: "test",
    connectionName: "Test",
    connectionDescription: "Test",
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
      source: { csvHeaders: ["id"] },
    },
  ],
};

describe("graph requirements", () => {
  test("collects precise beta reasons across operations", () => {
    const ir: ConnectorIr = {
      ...baseIr,
      connection: {
        ...baseIr.connection,
        graphApiVersion: "beta",
        contentCategory: "people",
        profileSource: {
          webUrl: "https://example.com",
          displayName: "Example people source",
        },
      },
      properties: [
        ...baseIr.properties,
        {
          name: "owners",
          type: "principalCollection",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["owners"] },
        },
        {
          name: "manager",
          type: "string",
          labels: ["personManager"],
          aliases: [],
          search: {},
          source: { csvHeaders: ["manager"] },
        },
      ],
    };

    const reasons = collectGraphRequirementReasons(ir);

    expect(reasons.map((reason) => reason.message)).toEqual(
      expect.arrayContaining([
        "connection.contentCategory uses Graph /beta property 'contentCategory' during connection provisioning",
        "connection.profileSource uses Graph /beta profile source registration",
        "property 'owners' uses Graph /beta property type 'principalCollection' for schema registration and item ingestion",
      ])
    );
  });

  test("groups reasons by graph operation", () => {
    const ir: ConnectorIr = {
      ...baseIr,
      connection: {
        ...baseIr.connection,
        graphApiVersion: "beta",
        contentCategory: "people",
      },
      properties: [
        ...baseIr.properties,
        {
          name: "owners",
          type: "principal",
          labels: ["personManager"],
          aliases: [],
          search: {},
          source: { csvHeaders: ["owners"] },
        },
      ],
    };

    const requirements = getGraphOperationRequirements(ir);
    const connectionRequirement = requirements.find(
      (requirement) => requirement.operation === "connectionProvisioning"
    );
    const schemaRequirement = requirements.find(
      (requirement) => requirement.operation === "schemaRegistration"
    );
    const profileSourceRequirement = requirements.find(
      (requirement) => requirement.operation === "profileSourceRegistration"
    );

    expect(connectionRequirement?.minGraphApiVersion).toBe("beta");
    expect(schemaRequirement?.minGraphApiVersion).toBe("beta");
    expect(profileSourceRequirement?.minGraphApiVersion).toBe("v1.0");
    expect(schemaRequirement?.reasons).toHaveLength(1);
  });

  test("collects beta-only label reasons when capability data marks a label as beta", async () => {
    vi.resetModules();
    vi.doMock("../../src/graph/capabilities.js", async (importActual) => {
      const actual = await importActual<typeof import("../../src/graph/capabilities.js")>();
      return {
        ...actual,
        getLabelCapability: (label: string) =>
          label === "betaOnlyLabel"
            ? { availableIn: ["beta"], minGraphApiVersion: "beta", kind: "people" as const }
            : actual.getLabelCapability(label),
      };
    });

    const { collectGraphRequirementReasons: collectReasons } = await import("../../src/graph/requirements.js");
    const ir: ConnectorIr = {
      ...baseIr,
      connection: {
        ...baseIr.connection,
        graphApiVersion: "beta",
      },
      properties: [
        ...baseIr.properties,
        {
          name: "manager",
          type: "string",
          labels: ["betaOnlyLabel"],
          aliases: [],
          search: {},
          source: { csvHeaders: ["manager"] },
        },
      ],
    };

    expect(collectReasons(ir).map((reason) => reason.message)).toContain(
      "property 'manager' uses Graph /beta label 'betaOnlyLabel' for schema registration and item ingestion"
    );

    vi.doUnmock("../../src/graph/capabilities.js");
    vi.resetModules();
  });

  test("formats detailed preview error message", () => {
    const ir: ConnectorIr = {
      ...baseIr,
      connection: {
        ...baseIr.connection,
        graphApiVersion: "beta",
        contentCategory: "people",
      },
    };

    const message = formatPreviewFeatureRequirement(ir);

    expect(message).toContain(
      "connection.contentCategory uses Graph /beta property 'contentCategory' during connection provisioning"
    );
    expect(message).toContain("Re-run with --use-preview-features.");
  });

  test("renders beta note lines for generation summaries", () => {
    const ir: ConnectorIr = {
      ...baseIr,
      connection: {
        ...baseIr.connection,
        graphApiVersion: "beta",
        contentCategory: "people",
      },
    };

    expect(getGraphBetaNoteLines(ir)).toContain(
      "connection.contentCategory uses Graph /beta property 'contentCategory' during connection provisioning; connection provisioning will use /beta"
    );
  });
});