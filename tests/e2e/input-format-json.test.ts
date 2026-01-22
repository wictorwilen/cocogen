import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import { runNode, writeTempTspFile } from "../test-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function distCliPath(): string {
  return path.join(repoRoot, "dist", "cli.js");
}

const jsonSchema = `
  @coco.connection({ name: "JSON input", connectionId: "jsoninput", connectionDescription: "JSON input connector" })
  @coco.item
  model Item {
    @coco.id
    @coco.source("id")
    id: string;

    @coco.source("details.role")
    role: string;
  }
`;

describe("json input format (e2e)", () => {
  test("ts output uses jsonpath sources", async () => {
    const entry = await writeTempTspFile(jsonSchema);
    const outDir = path.join(path.dirname(entry), "out-json-ts");

    const init = await runNode([
      distCliPath(),
      "generate",
      "--lang",
      "ts",
      "--data-format",
      "json",
      "--tsp",
      entry,
      "--out",
      outDir,
    ], {
      cwd: repoRoot,
      env: { NO_COLOR: "1", CI: "1" },
    });

    expect(init.code).toBe(0);

    const transform = await readFile(path.join(outDir, "src", "JSONInput", "propertyTransformBase.ts"), "utf8");
    expect(transform).toContain("readSourceValue(row, \"$.details.role\")");

    const data = await readFile(path.join(outDir, "data.json"), "utf8");
    expect(data).toContain("details");

    await expect(access(path.join(outDir, "data.csv"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.yaml"))).rejects.toThrow();
    await expect(access(path.join(outDir, "src", "datasource", "csvItemSource.ts"))).rejects.toThrow();
    await expect(access(path.join(outDir, "src", "datasource", "yamlItemSource.ts"))).rejects.toThrow();
  });

  test("dotnet output uses jsonpath sources", async () => {
    const entry = await writeTempTspFile(jsonSchema);
    const outDir = path.join(path.dirname(entry), "out-json-dotnet");

    const init = await runNode([
      distCliPath(),
      "generate",
      "--lang",
      "dotnet",
      "--data-format",
      "json",
      "--tsp",
      entry,
      "--out",
      outDir,
    ], {
      cwd: repoRoot,
      env: { NO_COLOR: "1", CI: "1" },
    });

    expect(init.code).toBe(0);

    const transform = await readFile(path.join(outDir, "JSONInput", "PropertyTransformBase.cs"), "utf8");
    expect(transform).toContain("RowParser.ParseString(row, \"$.details.role\")");

    const data = await readFile(path.join(outDir, "data.json"), "utf8");
    expect(data).toContain("details");

    await expect(access(path.join(outDir, "data.csv"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.yaml"))).rejects.toThrow();
    await expect(access(path.join(outDir, "Datasource", "CsvItemSource.cs"))).rejects.toThrow();
    await expect(access(path.join(outDir, "Datasource", "YamlItemSource.cs"))).rejects.toThrow();
  });
});
