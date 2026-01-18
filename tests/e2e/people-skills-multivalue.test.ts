import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import { runNode, writeTempTspFile } from "../test-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function distCliPath(): string {
  return path.join(repoRoot, "dist", "cli.js");
}

describe("people connector collection entity defaults", () => {
  test("emits collection defaults using split values", async () => {
    const entry = await writeTempTspFile(`
      using coco;

      @coco.connection({ contentCategory: "people" })
      @coco.item()
      model PersonProfile {
        @coco.id
        @coco.label("personAccount")
        @coco.source("upn", "userPrincipalName")
        userPrincipalName: string;

        @coco.label("personSkills")
        @coco.source("skill", "displayName")
        @coco.source("proficiency", "proficiency")
        skills: string[];
      }
    `);

    const outDir = path.join(path.dirname(entry), "out-people-skills");
    const result = await runNode(
      [distCliPath(), "init", "--tsp", entry, "--out", outDir, "--lang", "ts", "--use-preview-features"],
      {
        cwd: repoRoot,
        env: {
          NO_COLOR: "1",
          CI: "1",
        },
      }
    );

    expect(result.code).toBe(0);

    const defaultsPath = path.join(outDir, "src", "schema", "propertyTransformBase.ts");
    const defaultsSource = await readFile(defaultsPath, "utf8");

    expect(defaultsSource).toMatch(/parseStringCollection/);
    expect(defaultsSource).toMatch(/maxLen/);
    expect(defaultsSource).toMatch(/results\.push/);
  });
});
