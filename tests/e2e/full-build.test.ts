import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { runCommand, runNode, writeTempTspFile } from "../test-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function distCliPath(): string {
  return path.join(repoRoot, "dist", "cli.js");
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

describe("cocogen generate + npm install + npm run build (e2e)", () => {
  test(
    "generates a runnable project that can install and build",
    { timeout: 15 * 60_000 },
    async () => {
      const entry = await writeTempTspFile(`
        @coco.connection({ name: "Test connector", connectionId: "testconnection", connectionDescription: "Test connector" })
        @coco.item
        model Item {
          @coco.id
          id: string;
          title: string;
        }
      `);

      const outDir = path.join(path.dirname(entry), "out-full-build");

      const initResult = await runNode([distCliPath(), "generate", "--tsp", entry, "--out", outDir], {
        cwd: repoRoot,
        env: {
          NO_COLOR: "1",
          CI: "1",
        },
      });

      expect(initResult.code).toBe(0);

      // Sanity check: package.json exists and is parseable before we install.
      const pkgJson = await readFile(path.join(outDir, "package.json"), "utf8");
      const pkg = JSON.parse(pkgJson) as { devDependencies?: Record<string, string> };
      expect(pkg).toBeTruthy();

      // Ensure local devDependency is installable in CI (package may not be published yet).
      if (pkg.devDependencies?.["@wictorwilen/cocogen"]) {
        const relative = path.relative(outDir, repoRoot).replaceAll(path.sep, "/");
        pkg.devDependencies["@wictorwilen/cocogen"] = `file:${relative || "."}`;
        await writeFile(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
      }

      const commonEnv = {
        NO_COLOR: "1",
        CI: "1",
        npm_config_fund: "false",
        npm_config_audit: "false",
      };

      const installResult = await runCommand(
        npmCommand(),
        ["install", "--no-fund", "--no-audit"],
        {
          cwd: outDir,
          env: commonEnv,
          timeoutMs: 10 * 60_000,
        }
      );

      expect(installResult.code).toBe(0);

      const buildResult = await runCommand(npmCommand(), ["run", "build"], {
        cwd: outDir,
        env: commonEnv,
        timeoutMs: 5 * 60_000,
      });

      if (buildResult.code !== 0) {
        // Make failures actionable in CI logs.
        // (We keep this as a plain assertion message, not a snapshot.)
        throw new Error(
          [
            `Generated project build failed (exit ${buildResult.code}).`,
            "--- stdout ---",
            buildResult.stdout.trim(),
            "--- stderr ---",
            buildResult.stderr.trim(),
          ].join("\n")
        );
      }

      expect(buildResult.code).toBe(0);
    }
  );
});
