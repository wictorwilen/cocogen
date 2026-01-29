import { describe, expect, test, beforeEach, vi } from "vitest";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import type { ConnectorIr } from "../../src/ir.js";
import { initDotnetProject, initRestProject, initTsProject, updateRestProject } from "../../src/init/init.js";
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
  const parseHttpJson = (content: string): any => {
    const parts = content.trim().split(/\n\n+/);
    return JSON.parse(parts[parts.length - 1] ?? "{}");
  };

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

  test("initRestProject writes content payload defaults and collection odata types", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const outDir = await writeTempDir("cocogen-coverage-rest-payload-");

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: {
        graphApiVersion: "v1.0",
        inputFormat: "rest",
        contentCategory: "knowledgeBase",
        connectionName: undefined,
        connectionId: undefined,
        connectionDescription: undefined,
      },
      item: {
        typeName: "Item",
        idPropertyName: "id",
        idEncoding: "slug",
        contentPropertyName: "body",
        contentType: "html",
      },
      properties: [
        {
          name: "id",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          example: ["ID-1"],
          source: { csvHeaders: ["id"] },
        },
        {
          name: "body",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          example: "Hello",
          source: { csvHeaders: ["body"] },
        },
        {
          name: "tags",
          type: "stringCollection",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["tags"] },
        },
        {
          name: "principals",
          type: "principalCollection",
          labels: [],
          aliases: [],
          search: {},
          source: { csvHeaders: ["principals"] },
        },
        {
          name: "profile",
          type: "string",
          labels: [],
          aliases: [],
          search: {},
          personEntity: {
            entity: "userAccountInformation",
            fields: [{ path: "userPrincipalName", source: { csvHeaders: ["upn"] } }],
          },
          source: { csvHeaders: ["upn"] },
        },
      ],
    }));

    await initRestProject({ tspPath, outDir, projectName: "rest", usePreviewFeatures: false, force: true });

    const { readFile } = await import("node:fs/promises");
    const connectionHttp = await readFile(path.join(outDir, "create-connection.http"), "utf8");
    const connectionPayload = parseHttpJson(connectionHttp);
    expect(connectionPayload).toMatchObject({
      id: "connection-id",
      name: "Connector",
      description: "Connector generated by cocogen",
      contentCategory: "knowledgeBase",
    });

    const ingestHttp = await readFile(path.join(outDir, "ingest-item.http"), "utf8");
    const itemPayload = parseHttpJson(ingestHttp);
    expect(itemPayload.id).toBe("ID-1");
    expect(itemPayload.content).toEqual({ type: "html", value: "Hello" });
    expect(itemPayload.properties["tags@odata.type"]).toBe("Collection(String)");
    expect(itemPayload.properties["principals@odata.type"]).toBe(
      "Collection(microsoft.graph.externalConnectors.principal)"
    );
    expect(typeof itemPayload.properties.profile).toBe("string");
    const profilePayload = JSON.parse(itemPayload.properties.profile as string) as { userPrincipalName?: string };
    expect(profilePayload.userPrincipalName).toBeDefined();
  });

  test("initRestProject uses numeric item id example and profile source defaults", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const outDir = await writeTempDir("cocogen-coverage-rest-people-");

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: {
        graphApiVersion: "beta",
        inputFormat: "rest",
        contentCategory: "people",
        connectionName: undefined,
        connectionId: undefined,
        connectionDescription: undefined,
        profileSource: undefined,
      },
      item: {
        typeName: "PersonProfile",
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
          example: 42,
          source: { csvHeaders: ["id"] },
        },
      ],
    }));

    await initRestProject({ tspPath, outDir, projectName: "rest-people", usePreviewFeatures: true, force: true });

    const { readFile } = await import("node:fs/promises");
    const ingestHttp = await readFile(path.join(outDir, "ingest-item.http"), "utf8");
    const itemPayload = parseHttpJson(ingestHttp);
    expect(itemPayload.id).toBe("42");

    const profileSourceHttp = await readFile(path.join(outDir, "profile-source.http"), "utf8");
    expect(profileSourceHttp).toContain("PersonProfile");
    expect(profileSourceHttp).toContain("https://example.com/people");
  });

  test("initTsProject covers json/yaml/rest/custom datasource branches", async () => {
    const tspPath = await writeTempTspFile("@doc(\"coverage\") model Dummy { }");
    const formats: Array<"json" | "yaml" | "rest" | "custom"> = ["json", "yaml", "rest", "custom"];

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
        : format === "rest"
        ? path.join(outDir, "src", "datasource", "restItemSource.ts")
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
              { path: "detail.role", source: { csvHeaders: [], jsonPath: "$.position['role,']" } },
              { path: "detail.secondaryJobTitle", source: { csvHeaders: [], jsonPath: "$.position.secondaryJobTitle" } },
              { path: "detail.company.displayName", source: { csvHeaders: [], jsonPath: "$.company" } },
              { path: "detail.jobTitle", source: { csvHeaders: [], jsonPath: "$.title" } },
              { path: "colleagues.userPrincipalName", source: { csvHeaders: [], jsonPath: "$.assistant" } },
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

    const transform = await import("node:fs/promises").then(({ readFile }) =>
      readFile(path.join(outDir, "src", "People", "propertyTransformBase.ts"), "utf8")
    );
    expect(transform).toContain("colleagues");
    expect(transform).toContain("parseStringCollection(readSourceValue(row, \"$.assistant\"))");
    expect(transform).toContain("$.position['role,']");
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

  test("updateRestProject skips config rewrite when tspPath is omitted", async () => {
    const outDir = await writeTempDir("cocogen-coverage-rest-update-");
    const schemaPath = path.join(outDir, "schema.tsp");
    await writeFile(schemaPath, "using coco; @coco.connection({ name: \"Test\", connectionId: \"test\", connectionDescription: \"Test\" }) @coco.item model Item { @coco.id id: string; }", "utf8");
    await writeFile(
      path.join(outDir, "cocogen.json"),
      JSON.stringify({ lang: "rest", tsp: "./schema.tsp", inputFormat: "rest" }, null, 2),
      "utf8"
    );

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: {
        inputFormat: "rest",
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
          source: { csvHeaders: ["id"] },
        },
      ],
    }));

    await updateRestProject({ outDir });

    const config = await readFile(path.join(outDir, "cocogen.json"), "utf8");
    expect(config).toContain("\"tsp\": \"./schema.tsp\"");
    await expect(readFile(path.join(outDir, "profile-source.http"), "utf8")).rejects.toThrow();
  });

  test("updateRestProject rewrites config and profile source when tspPath is provided", async () => {
    const outDir = await writeTempDir("cocogen-coverage-rest-update-profile-");
    const schemaPath = path.join(outDir, "schema.tsp");
    await writeFile(schemaPath, "using coco; @coco.connection({ name: \"Test\", connectionId: \"test\", connectionDescription: \"Test\" }) @coco.item model Item { @coco.id id: string; }", "utf8");
    await writeFile(
      path.join(outDir, "cocogen.json"),
      JSON.stringify({ lang: "rest", tsp: "./schema.tsp", inputFormat: "rest" }, null, 2),
      "utf8"
    );

    const updatedTsp = path.join(outDir, "updated.tsp");
    await writeFile(updatedTsp, "using coco; @coco.connection({ name: \"Updated\", connectionId: \"updated\", connectionDescription: \"Updated\" }) @coco.item model Item { @coco.id id: string; }", "utf8");

    mocks.loadIrMock.mockResolvedValue(withOverrides({
      connection: {
        inputFormat: "rest",
        contentCategory: "people",
        connectionName: "Updated",
        connectionDescription: "Updated",
        profileSource: {
          webUrl: "https://example.com/updated",
          displayName: "Updated Source",
          priority: "last",
        },
      },
      item: {
        typeName: "PersonProfile",
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
    }));

    await updateRestProject({ outDir, tspPath: updatedTsp, usePreviewFeatures: true });

    const config = await readFile(path.join(outDir, "cocogen.json"), "utf8");
    expect(config).toContain("updated.tsp");
    const profileSource = await readFile(path.join(outDir, "profile-source.http"), "utf8");
    expect(profileSource).toContain("Updated Source");
    expect(profileSource).toContain("https://example.com/updated");
  });
});
