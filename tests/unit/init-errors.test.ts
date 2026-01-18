import { describe, expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { initDotnetProject, initTsProject, updateDotnetProject, updateTsProject } from "../../src/init/init.js";
import { writeTempDir, writeTempTspFile } from "../test-utils.js";

const peopleSchema = `using coco;

@coco.connection({ contentCategory: "people" })
@coco.item
model Person {
  @coco.id
  @coco.label("personAccount")
  @coco.source("upn", "userPrincipalName")
  id: string;
}
`;

describe("init errors", () => {
  test("fails when output directory is not empty", async () => {
    const tspPath = await writeTempTspFile(`using coco; @coco.item model Item { @coco.id id: string; }`);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "non-empty");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "existing.txt"), "hi", "utf8");

    await expect(initTsProject({ tspPath, outDir, force: false })).rejects.toThrow(/not empty/i);
  });

  test("allows force in non-empty output directory", async () => {
    const tspPath = await writeTempTspFile(`using coco; @coco.item model Item { @coco.id id: string; }`);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "non-empty-force");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "existing.txt"), "hi", "utf8");

    const result = await initTsProject({ tspPath, outDir, force: true });
    expect(result.outDir).toBe(outDir);
  });

  test("fails when preview features are required", async () => {
    const tspPath = await writeTempTspFile(peopleSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "people-project");

    await expect(initTsProject({ tspPath, outDir, force: false, usePreviewFeatures: false })).rejects.toThrow(
      /use-preview-features/i
    );
  });

  test("dotnet init fails when preview features are required", async () => {
    const tspPath = await writeTempTspFile(peopleSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "people-dotnet");

    await expect(initDotnetProject({ tspPath, outDir, force: false, usePreviewFeatures: false })).rejects.toThrow(
      /use-preview-features/i
    );
  });

  test("updateDotnetProject rejects non-dotnet project", async () => {
    const tspPath = await writeTempTspFile(`using coco; @coco.item model Item { @coco.id id: string; }`);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "ts-project");

    await initTsProject({ tspPath, outDir, force: false });

    await expect(updateDotnetProject({ outDir })).rejects.toThrow(/Use cocogen init\/update for that language/i);
  });

  test("updateTsProject rejects dotnet project", async () => {
    const tspPath = await writeTempTspFile(`using coco; @coco.item model Item { @coco.id id: string; }`);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "dotnet-project");

    await initDotnetProject({ tspPath, outDir, force: false });

    await expect(updateTsProject({ outDir })).rejects.toThrow(/Use cocogen init\/update for that language/i);
  });

  test("updateTsProject fails when preview features are required", async () => {
    const tspPath = await writeTempTspFile(peopleSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "people-update");

    await initTsProject({ tspPath, outDir, force: false, usePreviewFeatures: true });

    await expect(updateTsProject({ outDir, usePreviewFeatures: false })).rejects.toThrow(/use-preview-features/i);
  });

  test("updateDotnetProject fails when schema validation fails", async () => {
    const tspPath = await writeTempTspFile(`using coco; @coco.item model Item { @coco.id id: string; }`);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "dotnet-invalid");

    await initDotnetProject({ tspPath, outDir, force: false });

    await writeFile(path.join(outDir, "schema.tsp"), `using coco; @coco.item model Item { @coco.id id: int64; }`, "utf8");

    await expect(updateDotnetProject({ outDir })).rejects.toThrow(/Schema validation failed/i);
  });

  test("fails when schema validation fails", async () => {
    const tspPath = await writeTempTspFile(`using coco; @coco.item model Item { @coco.id id: int64; }`);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "invalid-schema");

    await expect(initTsProject({ tspPath, outDir, force: false })).rejects.toThrow(/Schema validation failed/i);
  });
});
