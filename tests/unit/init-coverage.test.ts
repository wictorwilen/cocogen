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
});
