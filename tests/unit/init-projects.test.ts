import { describe, expect, test } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { initTsProject, initDotnetProject, updateProject } from "../../src/init/init.js";
import { writeTempDir, writeTempTspFile } from "../test-utils.js";

const baseSchema = `using coco;

@coco.item
model Item {
  @coco.id
  id: string;
  title: string;
}
`;

const complexSchema = `using coco;

@coco.item
model Item {
  @coco.id
  id: string;

  @coco.search({ searchable: true, retrievable: true })
  title: string;

  @coco.aliases("summary")
  description: string;

  @coco.content({ type: "text" })
  body: string;

  count: int64;
  rating: float64;
  isActive: boolean;
  createdAt: utcDateTime;
  tags: string[];
  counts: int64[];
  ratings: float64[];
  dates: utcDateTime[];
}
`;

const peopleSchema = `using coco;

@coco.connection({ contentCategory: "people" })
@coco.item
model PersonProfile {
  @coco.id
  @coco.label("personAccount")
  @coco.source("upn", "userPrincipalName")
  account: string;

  @coco.label("personSkills")
  @coco.source("skill", "displayName")
  @coco.source("proficiency", "proficiency")
  skills: string[];
}
`;

const sampleCsvSchema = `using coco;

@coco.item
model Item {
  @coco.id
  id: string;

  @coco.source("job title")
  jobTitle: string;

  @coco.source("company")
  company: string;

  @coco.source("email")
  email: string;

  @coco.source("phone")
  phone: string;

  @coco.source("address")
  address: string;

  @coco.source("country")
  country: string;

  @coco.source("note")
  note: string;

  @coco.source("header,with,comma")
  special: string;

  owner: coco.Principal;
}
`;

describe("project init/update", () => {
  test("initTsProject generates files and config", async () => {
    const tspPath = await writeTempTspFile(complexSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "ts-project");

    const result = await initTsProject({ tspPath, outDir, force: false });

    const config = await readFile(path.join(outDir, "cocogen.json"), "utf8");
    expect(config).toContain("\"lang\": \"ts\"");

    const model = await readFile(path.join(outDir, "src", "schema", "model.ts"), "utf8");
    expect(model).toContain("export type Item");

    const copiedSchema = await readFile(path.join(outDir, "schema.tsp"), "utf8");
    expect(copiedSchema).toContain("@coco.item");

    expect(result.ir.item.typeName).toBe("Item");
  });

  test("initTsProject includes throttling retries", async () => {
    const tspPath = await writeTempTspFile(complexSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "ts-throttle");

    await initTsProject({ tspPath, outDir, force: false });

    const cli = await readFile(path.join(outDir, "src", "cli.ts"), "utf8");
    expect(cli).toContain("Retry-After");
    expect(cli).toContain("throttled");
    expect(cli).toContain("MAX_RETRIES");
  });

  test("updateProject regenerates schema from updated tsp", async () => {
    const tspPath = await writeTempTspFile(baseSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "ts-update");

    await initTsProject({ tspPath, outDir, force: false });

    const updatedSchema = `using coco;

@coco.item
model Item {
  @coco.id
  id: string;
  title: string;
  status: string;
}
`;

    await writeFile(path.join(outDir, "schema.tsp"), updatedSchema, "utf8");

    await updateProject({ outDir });

    const model = await readFile(path.join(outDir, "src", "schema", "model.ts"), "utf8");
    expect(model).toContain("status");
  });

  test("updateProject updates config when tspPath is overridden", async () => {
    const tspPath = await writeTempTspFile(baseSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "ts-update-config");

    await initTsProject({ tspPath, outDir, force: false });

    const newSchemaPath = await writeTempTspFile(`using coco; @coco.item model Item { @coco.id id: string; status: string; }`);
    await updateProject({ outDir, tspPath: newSchemaPath });

    const config = JSON.parse(await readFile(path.join(outDir, "cocogen.json"), "utf8")) as { tsp: string };
    expect(config.tsp).toContain(".tsp");
  });

  test("initDotnetProject generates Program.cs and SchemaConstants", async () => {
    const tspPath = await writeTempTspFile(complexSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "dotnet-project");

    await initDotnetProject({ tspPath, outDir, force: false });

    const program = await readFile(path.join(outDir, "Program.cs"), "utf8");
    expect(program).toContain("SchemaConstants");

    const constants = await readFile(path.join(outDir, "Schema", "Constants.cs"), "utf8");
    expect(constants).toContain("class SchemaConstants");
  });

  test("initDotnetProject includes throttling retries", async () => {
    const tspPath = await writeTempTspFile(complexSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "dotnet-throttle");

    await initDotnetProject({ tspPath, outDir, force: false });

    const program = await readFile(path.join(outDir, "Program.cs"), "utf8");
    expect(program).toContain("RetryAsync");
    expect(program).toContain("Retry-After");
    expect(program).toContain("throttled");
  });

  test("updateProject updates dotnet schema", async () => {
    const tspPath = await writeTempTspFile(baseSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "dotnet-update");

    await initDotnetProject({ tspPath, outDir, force: false });

    const updatedSchema = `using coco; @coco.item model Item { @coco.id id: string; status: string; }`;
    await writeFile(path.join(outDir, "schema.tsp"), updatedSchema, "utf8");
    await updateProject({ outDir });

    const model = await readFile(path.join(outDir, "Schema", "Model.cs"), "utf8");
    expect(model).toContain("Status");
  });

  test("initTsProject generates property transform base for people schema", async () => {
    const tspPath = await writeTempTspFile(peopleSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "people-project");

    await initTsProject({ tspPath, outDir, force: false, usePreviewFeatures: true });

    const transforms = await readFile(path.join(outDir, "src", "schema", "propertyTransformBase.ts"), "utf8");
    expect(transforms).toContain("skills");
    expect(transforms).toContain("displayName");
    expect(transforms).toContain("userPrincipalName");
  });

  test("initDotnetProject generates property transform base and preserves overrides", async () => {
    const tspPath = await writeTempTspFile(peopleSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "people-dotnet");

    await initDotnetProject({ tspPath, outDir, force: false, usePreviewFeatures: true });

    const defaults = await readFile(path.join(outDir, "Schema", "PropertyTransformBase.cs"), "utf8");
    expect(defaults).toContain("skill");

    const overrides = await readFile(path.join(outDir, "Schema", "PropertyTransform.cs"), "utf8");
    expect(overrides).toContain("PropertyTransform");

    await updateProject({ outDir, usePreviewFeatures: true });
    const overridesAfter = await readFile(path.join(outDir, "Schema", "PropertyTransform.cs"), "utf8");
    expect(overridesAfter).toBe(overrides);
  });

  test("initTsProject generates sample CSV with special headers", async () => {
    const tspPath = await writeTempTspFile(sampleCsvSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "sample-csv");

    await initTsProject({ tspPath, outDir, force: false, usePreviewFeatures: true });

    const csv = await readFile(path.join(outDir, "data.csv"), "utf8");
    expect(csv).toContain("Software Engineer");
    expect(csv).toContain('"header,with,comma"');
    expect(csv).toContain("alice@contoso.com");
  });
});
