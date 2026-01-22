import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import { runNode, writeTempTspFile } from "../test-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function distCliPath(): string {
  return path.join(repoRoot, "dist", "cli.js");
}

const customSchema = `
  @coco.connection({ name: "Custom input", connectionId: "custominput", connectionDescription: "Custom input connector" })
  @coco.item
  model Item {
    @coco.id
    @coco.source("id")
    id: string;

    @coco.source("details.role")
    role: string;
  }
`;

describe("custom input format (e2e)", () => {
  test("ts output uses custom datasource stub", async () => {
    const entry = await writeTempTspFile(customSchema);
    const outDir = path.join(path.dirname(entry), "out-custom-ts");

    const init = await runNode([
      distCliPath(),
      "generate",
      "--lang",
      "ts",
      "--data-format",
      "custom",
      "--tsp",
      entry,
      "--out",
      outDir,
    ], {
      cwd: repoRoot,
      env: { NO_COLOR: "1", CI: "1" },
    });

    expect(init.code).toBe(0);

    await expect(access(path.join(outDir, "src", "datasource", "customItemSource.ts"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "src", "datasource", "csvItemSource.ts"))).rejects.toThrow();
    await expect(access(path.join(outDir, "src", "datasource", "jsonItemSource.ts"))).rejects.toThrow();
    await expect(access(path.join(outDir, "src", "datasource", "yamlItemSource.ts"))).rejects.toThrow();

    await expect(access(path.join(outDir, "data.csv"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.json"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.yaml"))).rejects.toThrow();
  });

  test("dotnet output uses custom datasource stub", async () => {
    const entry = await writeTempTspFile(customSchema);
    const outDir = path.join(path.dirname(entry), "out-custom-dotnet");

    const init = await runNode([
      distCliPath(),
      "generate",
      "--lang",
      "dotnet",
      "--data-format",
      "custom",
      "--tsp",
      entry,
      "--out",
      outDir,
    ], {
      cwd: repoRoot,
      env: { NO_COLOR: "1", CI: "1" },
    });

    expect(init.code).toBe(0);

    await expect(access(path.join(outDir, "Datasource", "CustomItemSource.cs"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "Datasource", "CsvItemSource.cs"))).rejects.toThrow();
    await expect(access(path.join(outDir, "Datasource", "JsonItemSource.cs"))).rejects.toThrow();
    await expect(access(path.join(outDir, "Datasource", "YamlItemSource.cs"))).rejects.toThrow();

    await expect(access(path.join(outDir, "data.csv"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.json"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.yaml"))).rejects.toThrow();

    const program = await readFile(path.join(outDir, "Program.cs"), "utf8");
    expect(program).toContain("CustomItemSource");
  });
});
