import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { isCommandAvailable, runCommand, runNode, writeTempTspFile } from "../test-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function distCliPath(): string {
  return path.join(repoRoot, "dist", "cli.js");
}

function dotnetCommand(): string {
  return process.platform === "win32" ? "dotnet.exe" : "dotnet";
}

const dotnetAvailable = await isCommandAvailable(dotnetCommand());

const yamlSchema = `
  @coco.connection({ name: "YAML input", connectionId: "yamlinput", connectionDescription: "YAML input connector" })
  @coco.item
  model Item {
    @coco.id
    @coco.source("id")
    id: string;

    @coco.source("tags[*]")
    tags: string[];
  }
`;

describe("yaml input format (dotnet jsonpath e2e)", () => {
  const runDotnet = dotnetAvailable ? test : test.skip;

  runDotnet(
    "dotnet yaml ingest resolves jsonpath arrays",
    { timeout: 12 * 60_000 },
    async () => {
      const entry = await writeTempTspFile(yamlSchema);
      const outDir = path.join(path.dirname(entry), "out-yaml-dotnet");

      const init = await runNode([
        distCliPath(),
        "generate",
        "--lang",
        "dotnet",
        "--data-format",
        "yaml",
        "--tsp",
        entry,
        "--out",
        outDir,
      ], {
        cwd: repoRoot,
        env: {
          NO_COLOR: "1",
          CI: "1",
        },
      });

      expect(init.code).toBe(0);

      const build = await runCommand(dotnetCommand(), ["build"], {
        cwd: outDir,
        env: {
          NO_COLOR: "1",
          CI: "1",
        },
        timeoutMs: 10 * 60_000,
      });

      if (build.code !== 0) {
        throw new Error(
          [
            `dotnet build failed (exit ${build.code}).`,
            "--- stdout ---",
            build.stdout.trim(),
            "--- stderr ---",
            build.stderr.trim(),
          ].join("\n")
        );
      }

      const ingest = await runCommand(dotnetCommand(), ["run", "--", "ingest", "--dry-run", "--verbose"], {
        cwd: outDir,
        env: {
          NO_COLOR: "1",
          CI: "1",
        },
        timeoutMs: 10 * 60_000,
      });

      if (ingest.code !== 0) {
        throw new Error(
          [
            `dotnet run ingest failed (exit ${ingest.code}).`,
            "--- stdout ---",
            ingest.stdout.trim(),
            "--- stderr ---",
            ingest.stderr.trim(),
          ].join("\n")
        );
      }

      expect(ingest.stdout).toMatch(/\"tags\"\s*:\s*\[/);
      expect(ingest.stdout).not.toMatch(/\"tags\"\s*:\s*\[\s*\]/);
    }
  );
});
