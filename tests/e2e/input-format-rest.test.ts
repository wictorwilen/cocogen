import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import { runNode, writeTempTspFile } from "../test-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function distCliPath(): string {
  return path.join(repoRoot, "dist", "cli.js");
}

const restSchema = `
  @coco.connection({ name: "REST input", connectionId: "restinput", connectionDescription: "REST input connector" })
  @coco.item
  model Item {
    @coco.id
    @coco.source("id")
    id: string;

    @coco.source("details.role")
    role: string;
  }
`;

describe("rest input format (e2e)", () => {
  test("ts output uses rest datasource", async () => {
    const entry = await writeTempTspFile(restSchema);
    const outDir = path.join(path.dirname(entry), "out-rest-ts");

    const init = await runNode([
      distCliPath(),
      "generate",
      "--lang",
      "ts",
      "--data-format",
      "rest",
      "--tsp",
      entry,
      "--out",
      outDir,
    ], {
      cwd: repoRoot,
      env: { NO_COLOR: "1", CI: "1" },
    });

    expect(init.code).toBe(0);

    const transform = await readFile(path.join(outDir, "src", "RESTInput", "propertyTransformBase.ts"), "utf8");
    expect(transform).toContain("readSourceValue(row, \"$.details.role\")");

    const restSourcePath = path.join(outDir, "src", "datasource", "restItemSource.ts");
    await expect(access(restSourcePath)).resolves.toBeUndefined();
    const restSource = await readFile(restSourcePath, "utf8");
    expect(restSource).toContain("$['@odata.nextLink']");
    expect(restSource).toContain("$.value");
    await expect(access(path.join(outDir, "data.csv"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.json"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.yaml"))).rejects.toThrow();
  });

  test("dotnet output uses rest datasource", async () => {
    const entry = await writeTempTspFile(restSchema);
    const outDir = path.join(path.dirname(entry), "out-rest-dotnet");

    const init = await runNode([
      distCliPath(),
      "generate",
      "--lang",
      "dotnet",
      "--data-format",
      "rest",
      "--tsp",
      entry,
      "--out",
      outDir,
    ], {
      cwd: repoRoot,
      env: { NO_COLOR: "1", CI: "1" },
    });

    expect(init.code).toBe(0);

    const transform = await readFile(path.join(outDir, "RESTInput", "PropertyTransformBase.cs"), "utf8");
    expect(transform).toContain("RowParser.ParseString(row, \"$.details.role\")");

    const restSourcePath = path.join(outDir, "Datasource", "RestItemSource.cs");
    await expect(access(restSourcePath)).resolves.toBeUndefined();
    const restSource = await readFile(restSourcePath, "utf8");
    expect(restSource).toContain("DefaultNextLinkPath");
    expect(restSource).toContain("$['@odata.nextLink']");
    expect(restSource).toContain("DefaultItemsPath");
    expect(restSource).toContain("$.value");
    await expect(access(path.join(outDir, "data.csv"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.json"))).rejects.toThrow();
    await expect(access(path.join(outDir, "data.yaml"))).rejects.toThrow();
  });
});
