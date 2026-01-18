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

describe("cocogen init (dotnet) + dotnet build (e2e)", () => {
  test("generates a .NET project", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
        title: string;
      }
    `);

    const outDir = path.join(path.dirname(entry), "out-dotnet");
    const result = await runNode([
      distCliPath(),
      "init",
      "--lang",
      "dotnet",
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

    expect(result.code).toBe(0);
  });

  const runDotnet = dotnetAvailable ? test : test.skip;
  runDotnet(
    "dotnet build succeeds",
    { timeout: 12 * 60_000 },
    async () => {
      const entry = await writeTempTspFile(`
        @coco.item
        model Item {
          @coco.id
          id: string;
          title: string;
        }
      `);

      const outDir = path.join(path.dirname(entry), "out-dotnet-build");
      const init = await runNode([distCliPath(), "init", "--tsp", entry, "--out", outDir, "--lang", "dotnet"], {
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

      expect(build.code).toBe(0);
    }
  );
});
