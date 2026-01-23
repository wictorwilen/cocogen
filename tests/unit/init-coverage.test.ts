import { describe, expect, test, beforeEach, vi } from "vitest";
import path from "node:path";

import type { ConnectorIr } from "../../src/ir.js";
import { initDotnetProject, initRestProject, initTsProject } from "../../src/init/init.js";
import { writeTempDir, writeTempTspFile } from "../test-utils.js";

const mocks = vi.hoisted(() => ({
  loadIrMock: vi.fn<
    Parameters<typeof import("../../src/tsp/loader.js").loadIrFromTypeSpec>,
    Promise<ConnectorIr>
  >(),
  validateIrMock: vi.fn<
    Parameters<typeof import("../../src/validate/validator.js").validateIr>,
    ReturnType<typeof import("../../src/validate/validator.js").validateIr>
  >(),
}));

vi.mock("../../src/tsp/loader.js", () => ({ loadIrFromTypeSpec: mocks.loadIrMock }));
vi.mock("../../src/validate/validator.js", () => ({ validateIr: mocks.validateIrMock }));

type IrOverrides = Partial<ConnectorIr> & { connection?: Partial<ConnectorIr["connection"]>; item?: Partial<ConnectorIr["item"]> };

const baseIr: ConnectorIr = {
  connection: {
    graphApiVersion: "v1.0",
    contentCategory: "people",
    connectionName: "123 People",
    connectionId: "peopleconnector",
    connectionDescription: "People connector",
    inputFormat: "csv",
    profileSource: {
      webUrl: "https://example.com/people",
      displayName: "Example People Source",
      priority: "last",
    },
  },
  item: {
    typeName: "PersonProfile",
    idPropertyName: "id",
    idEncoding: "hash",
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
    {
      name: "account",
      type: "string",
      labels: ["personAccount"],
      aliases: [],
      search: {},
      personEntity: {
        entity: "userAccountInformation",
        fields: [{ path: "userPrincipalName", source: { csvHeaders: ["upn"] } }],
      },
      source: { csvHeaders: ["upn"] },
    },
    {
      name: "skills",
      type: "stringCollection",
      labels: ["personSkills"],
      aliases: [],
      search: {},
      personEntity: {
        entity: "skillProficiency",
        fields: [
          { path: "displayName", source: { csvHeaders: ["skill"] } },
          { path: "proficiency", source: { csvHeaders: ["skill level"] } },
        ],
      },
      source: { csvHeaders: ["skill"] },
    },
    {
      name: "currentPosition",
      type: "string",
      labels: ["personCurrentPosition"],
      aliases: [],
      search: {},
      personEntity: {
        entity: "workPosition",
        fields: [
          { path: "detail.role", source: { csvHeaders: ["role"] } },
          { path: "detail.company.displayName", source: { csvHeaders: ["company"] } },
          { path: "detail.jobTitle", source: { csvHeaders: ["job title"] } },
        ],
      },
      source: { csvHeaders: ["role"] },
    },
    {
      name: "scores",
      type: "doubleCollection",
      labels: [],
      aliases: ["ratings"],
      search: { retrievable: true },
      minValue: 0,
      maxValue: 10,
      source: { csvHeaders: ["scores"] },
    },
    {
      name: "counts",
      type: "int64Collection",
      labels: [],
      aliases: [],
      search: { retrievable: true },
      source: { csvHeaders: ["counts"] },
    },
    {
      name: "createdAt",
      type: "dateTime",
      labels: ["createdDateTime"],
      aliases: [],
      search: { retrievable: true },
      source: { csvHeaders: ["created"] },
    },
    {
      name: "updatedAt",
      type: "dateTimeCollection",
      labels: [],
      aliases: [],
      search: { retrievable: true },
      minLength: 1,
      source: { csvHeaders: ["updated"] },
    },
    {
      name: "isActive",
      type: "boolean",
      labels: [],
      aliases: [],
      search: { retrievable: true },
      source: { csvHeaders: ["active"] },
    },
    {
      name: "rank",
      type: "int64",
      labels: [],
      aliases: [],
      search: { refinable: true, retrievable: true },
      minValue: 0,
      maxValue: 100,
      source: { csvHeaders: ["rank"] },
    },
    {
      name: "principal",
      type: "principal",
      labels: [],
      aliases: [],
      search: { retrievable: true },
      source: { csvHeaders: ["principal upn"] },
    },
    {
      name: "principals",
      type: "principalCollection",
      labels: [],
      aliases: [],
      search: { retrievable: true },
      source: { csvHeaders: ["principals"] },
    },
    {
      name: "notes",
      type: "string",
      labels: [],
      aliases: [],
      search: {},
      source: { csvHeaders: [], noSource: true },
    },
  ],
};

const withOverrides = (overrides: IrOverrides): ConnectorIr => ({
  ...baseIr,
  connection: { ...baseIr.connection, ...(overrides.connection ?? {}) },
  item: { ...baseIr.item, ...(overrides.item ?? {}) },
  properties: overrides.properties ?? baseIr.properties,
});

beforeEach(() => {
  mocks.loadIrMock.mockReset();
  mocks.validateIrMock.mockReset();
  mocks.validateIrMock.mockReturnValue([]);
});

describe("init coverage", () => {
  test("initTsProject handles people and nested graph types", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const outDir = await writeTempDir("cocogen-coverage-ts-");

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: { connectionName: "123 People" },
      item: { contentPropertyName: undefined },
    }));

    const result = await initTsProject({
      tspPath,
      outDir,
      projectName: "123-Project",
      usePreviewFeatures: true,
      force: true,
    });

    expect(result.outDir).toBe(path.resolve(outDir));
    const peopleHelpers = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(outDir, "src", "core", "people.ts"), "utf8")
    );
    expect(peopleHelpers).toContain("PositionDetail");
    expect(peopleHelpers).toContain("OriginTenantInfo");
  });

  test("initDotnetProject and initRestProject cover additional branches", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const outDirDotnet = await writeTempDir("cocogen-coverage-dotnet-");
    const outDirRest = await writeTempDir("cocogen-coverage-rest-");

    const dotnetIr = withOverrides({
      connection: { graphApiVersion: "beta", connectionName: "", contentCategory: "content" },
      item: { typeName: "Skill", idPropertyName: "id", idEncoding: "slug" },
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
          name: "Skill",
          type: "string",
          labels: ["title"],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: ["skill"] },
        },
        {
          name: "scores",
          type: "double",
          labels: [],
          aliases: [],
          search: { refinable: true, retrievable: true },
          minValue: 0,
          maxValue: 1,
          source: { csvHeaders: ["score"] },
        },
        {
          name: "dates",
          type: "dateTimeCollection",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          minLength: 1,
          source: { csvHeaders: ["date"] },
        },
      ],
    });

    mocks.loadIrMock.mockResolvedValue(dotnetIr);

    const dotnetResult = await initDotnetProject({
      tspPath,
      outDir: outDirDotnet,
      projectName: "---",
      usePreviewFeatures: true,
      force: true,
    });

    expect(dotnetResult.outDir).toBe(path.resolve(outDirDotnet));

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: { contentCategory: "people" },
    }));

    const restResult = await initRestProject({
      tspPath,
      outDir: outDirRest,
      projectName: "rest",
      usePreviewFeatures: true,
      force: true,
    });

    expect(restResult.outDir).toBe(path.resolve(outDirRest));
    const profileSource = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(outDirRest, "profile-source.http"), "utf8")
    );
    expect(profileSource).toContain("Register profile source");
  });

  test("initTsProject covers json/yaml/custom datasource branches", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const formats: Array<"json" | "yaml" | "custom"> = ["json", "yaml", "custom"];

    for (const format of formats) {
      const outDir = await writeTempDir(`cocogen-coverage-${format}-`);
      mocks.loadIrMock.mockResolvedValue(withOverrides({
        connection: {
          inputFormat: format,
          contentCategory: undefined,
          connectionName: "Sample",
          connectionDescription: "Sample",
        },
        item: {
          typeName: "Item",
          idPropertyName: "id",
          idEncoding: "slug",
          contentPropertyName: "body",
        },
        properties: [
          {
            name: "id",
            type: "string",
            labels: [],
            aliases: [],
            search: {},
            source: { csvHeaders: [], jsonPath: "$.id" },
          },
          {
            name: "body",
            type: "string",
            labels: [],
            aliases: [],
            search: {},
            source: { csvHeaders: [], jsonPath: "$.body" },
          },
        ],
      }));

      const result = await initTsProject({
        tspPath,
        outDir,
        projectName: `sample-${format}`,
        usePreviewFeatures: false,
        force: true,
      });

      expect(result.outDir).toBe(path.resolve(outDir));

      const { access } = await import("node:fs/promises");
      const dataPath = format === "json"
        ? path.join(outDir, "data.json")
        : format === "yaml"
        ? path.join(outDir, "data.yaml")
        : null;
      if (dataPath) {
        await access(dataPath);
      }

      const datasourcePath = format === "json"
        ? path.join(outDir, "src", "datasource", "jsonItemSource.ts")
        : format === "yaml"
        ? path.join(outDir, "src", "datasource", "yamlItemSource.ts")
        : path.join(outDir, "src", "datasource", "customItemSource.ts");
      await access(datasourcePath);
    }
  });

  test("initDotnetProject covers json datasource branch", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const outDir = await writeTempDir("cocogen-coverage-dotnet-json-");

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: {
        inputFormat: "json",
        contentCategory: undefined,
        connectionName: "Sample",
        connectionDescription: "Sample",
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
          source: { csvHeaders: [], jsonPath: "$.id" },
        },
        {
          name: "active",
          type: "boolean",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: [], jsonPath: "$.active" },
        },
      ],
    }));

    const result = await initDotnetProject({
      tspPath,
      outDir,
      projectName: "sample-json",
      usePreviewFeatures: false,
      force: true,
    });

    expect(result.outDir).toBe(path.resolve(outDir));

    const { access } = await import("node:fs/promises");
    await access(path.join(outDir, "Datasource", "JsonItemSource.cs"));
    await access(path.join(outDir, "data.json"));
  });

  test("initTsProject covers complex people json branches", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const outDir = await writeTempDir("cocogen-coverage-people-json-");

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: {
        inputFormat: "json",
        graphApiVersion: "beta",
        contentCategory: "people",
        connectionName: "People",
        connectionDescription: "People",
      },
      item: {
        typeName: "PersonProfile",
        idPropertyName: "id",
        idEncoding: "hash",
        contentPropertyName: "bio",
      },
      properties: [
        {
          name: "id",
          type: "string",
          labels: ["personAccount"],
          aliases: [],
          search: {},
          source: { csvHeaders: [], jsonPath: "$.id" },
          personEntity: {
            entity: "userAccountInformation",
            fields: [{ path: "userPrincipalName", source: { csvHeaders: [], jsonPath: "$.upn" } }],
          },
        },
        {
          name: "bio",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: [], jsonPath: "$.bio" },
        },
        {
          name: "skills",
          type: "stringCollection",
          labels: ["personSkills"],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.skills" },
          personEntity: {
            entity: "skillProficiency",
            fields: [
              { path: "displayName", source: { csvHeaders: [], jsonPath: "$.skills" } },
              { path: "proficiency", source: { csvHeaders: [], jsonPath: "$.skillLevel" } },
            ],
          },
        },
        {
          name: "awards",
          type: "stringCollection",
          labels: ["personAwards"],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.awards" },
          personEntity: {
            entity: "personAward",
            fields: [{ path: "displayName", source: { csvHeaders: [], jsonPath: "$.awards" } }],
          },
        },
        {
          name: "currentPosition",
          type: "string",
          labels: ["personCurrentPosition"],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.role" },
          personEntity: {
            entity: "workPosition",
            fields: [
              { path: "detail.role", source: { csvHeaders: [], jsonPath: "$.role" } },
              { path: "detail.company.displayName", source: { csvHeaders: [], jsonPath: "$.company" } },
              { path: "detail.jobTitle", source: { csvHeaders: [], jsonPath: "$.title" } },
            ],
          },
        },
        {
          name: "manager",
          type: "string",
          labels: ["personManager"],
          aliases: [],
          search: {},
          source: { csvHeaders: [], jsonPath: "$.manager" },
        },
        {
          name: "principal",
          type: "principal",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.principal" },
          personEntity: {
            entity: "userAccountInformation",
            fields: [{ path: "userPrincipalName", source: { csvHeaders: [], jsonPath: "$.principal" } }],
          },
        },
        {
          name: "principalCollection",
          type: "principalCollection",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.principals" },
        },
        {
          name: "notes",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: [], jsonPath: "$.notes", noSource: true },
        },
      ],
    }));

    const result = await initTsProject({
      tspPath,
      outDir,
      projectName: "people-json",
      usePreviewFeatures: true,
      force: true,
    });

    expect(result.outDir).toBe(path.resolve(outDir));
    const { access } = await import("node:fs/promises");
    await access(path.join(outDir, "src", "datasource", "jsonItemSource.ts"));
  });

  test("initDotnetProject covers yaml datasource with diverse types", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const outDir = await writeTempDir("cocogen-coverage-dotnet-yaml-");

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: {
        inputFormat: "yaml",
        contentCategory: "content",
        connectionName: "Content",
        connectionDescription: "Content",
      },
      item: {
        typeName: "Record",
        idPropertyName: "id",
        idEncoding: "slug",
        contentPropertyName: "body",
      },
      properties: [
        {
          name: "id",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: [], jsonPath: "$.id" },
        },
        {
          name: "title",
          type: "string",
          labels: ["title"],
          aliases: ["headline"],
          search: { searchable: true, retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.title" },
        },
        {
          name: "active",
          type: "boolean",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.active" },
        },
        {
          name: "rating",
          type: "double",
          labels: [],
          aliases: [],
          search: { refinable: true },
          minValue: 0,
          maxValue: 5,
          source: { csvHeaders: [], jsonPath: "$.rating" },
        },
        {
          name: "count",
          type: "int64",
          labels: [],
          aliases: [],
          search: { refinable: true },
          minValue: 0,
          maxValue: 100,
          source: { csvHeaders: [], jsonPath: "$.count" },
        },
        {
          name: "tags",
          type: "stringCollection",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.tags" },
        },
        {
          name: "scores",
          type: "doubleCollection",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.scores" },
        },
        {
          name: "counts",
          type: "int64Collection",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.counts" },
        },
        {
          name: "createdAt",
          type: "dateTime",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.createdAt" },
        },
        {
          name: "updatedAt",
          type: "dateTimeCollection",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.updatedAt" },
        },
        {
          name: "principal",
          type: "principal",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.principal" },
        },
        {
          name: "principals",
          type: "principalCollection",
          labels: [],
          aliases: [],
          search: { retrievable: true },
          source: { csvHeaders: [], jsonPath: "$.principals" },
        },
      ],
    }));

    const result = await initDotnetProject({
      tspPath,
      outDir,
      projectName: "content-yaml",
      usePreviewFeatures: true,
      force: true,
    });

    expect(result.outDir).toBe(path.resolve(outDir));
    const { access } = await import("node:fs/promises");
    await access(path.join(outDir, "Datasource", "YamlItemSource.cs"));
    await access(path.join(outDir, "data.yaml"));
  });
});
