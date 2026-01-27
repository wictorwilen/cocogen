import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, afterEach, vi } from "vitest";

import {
  COCOGEN_CONFIG_FILE,
  getGeneratorVersion,
  loadProjectConfig,
  projectConfigContents,
} from "../../src/init/project-config.js";

describe("project-config", () => {
  describe("getGeneratorVersion", () => {
    test("returns a version string", () => {
      const version = getGeneratorVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    });

    test("version matches semver pattern or is 0.0.0", () => {
      const version = getGeneratorVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    test("falls back to 0.0.0 when package name does not match", async () => {
      vi.resetModules();
      vi.doMock("node:fs", async () => {
        const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
        return {
          ...actual,
          readFileSync: vi.fn().mockReturnValue(JSON.stringify({ name: "other-package", version: "9.9.9" })),
        };
      });

      const mod = await import("../../src/init/project-config.js");
      expect(mod.getGeneratorVersion()).toBe("0.0.0");

      vi.resetModules();
    });
  });

  describe("projectConfigContents", () => {
    test("generates valid JSON config for TypeScript", () => {
      const content = projectConfigContents("/tmp/out", "/tmp/schema.tsp", "ts", "csv");
      const parsed = JSON.parse(content);
      expect(parsed.lang).toBe("ts");
      expect(parsed.inputFormat).toBe("csv");
      expect(parsed.tsp).toBeTruthy();
      expect(parsed.cocogenVersion).toBeTruthy();
    });

    test("generates valid JSON config for .NET", () => {
      const content = projectConfigContents("/tmp/out", "/tmp/schema.tsp", "dotnet", "json");
      const parsed = JSON.parse(content);
      expect(parsed.lang).toBe("dotnet");
      expect(parsed.inputFormat).toBe("json");
    });

    test("generates valid JSON config for REST", () => {
      const content = projectConfigContents("/tmp/out", "/tmp/schema.tsp", "rest", "yaml");
      const parsed = JSON.parse(content);
      expect(parsed.lang).toBe("rest");
      expect(parsed.inputFormat).toBe("yaml");
    });

    test("calculates relative path correctly", () => {
      const content = projectConfigContents("/home/user/project/out", "/home/user/schema.tsp", "ts", "csv");
      const parsed = JSON.parse(content);
      expect(parsed.tsp).toBe("../../schema.tsp");
    });

    test("handles same directory paths", () => {
      const content = projectConfigContents("/tmp/out", "/tmp/out/schema.tsp", "ts", "csv");
      const parsed = JSON.parse(content);
      expect(parsed.tsp).toBe("schema.tsp");
    });

    test("includes generator version", () => {
      const content = projectConfigContents("/tmp/out", "/tmp/schema.tsp", "ts", "csv");
      const parsed = JSON.parse(content);
      expect(parsed.cocogenVersion).toBeTruthy();
      expect(typeof parsed.cocogenVersion).toBe("string");
    });
  });

  describe("loadProjectConfig", () => {
    let tempDir: string | undefined;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
        tempDir = undefined;
      }
    });

    test("rethrows unexpected file system errors", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      vi.resetModules();
      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        return {
          ...actual,
          readFile: vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code: "EACCES" })),
        };
      });

      const mod = await import("../../src/init/project-config.js");
      await expect(mod.loadProjectConfig(tempDir)).rejects.toThrow("boom");
      vi.resetModules();
    });

    test("loads valid TypeScript config", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      const config = {
        lang: "ts" as const,
        tsp: "./schema.tsp",
        inputFormat: "csv" as const,
        cocogenVersion: "1.0.0",
      };
      await writeFile(path.join(tempDir, COCOGEN_CONFIG_FILE), JSON.stringify(config));

      const result = await loadProjectConfig(tempDir);
      expect(result.config.lang).toBe("ts");
      expect(result.config.tsp).toBe("./schema.tsp");
      expect(result.config.inputFormat).toBe("csv");
    });

    test("loads valid .NET config", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      const config = {
        lang: "dotnet" as const,
        tsp: "./schema.tsp",
        inputFormat: "json" as const,
        cocogenVersion: "1.0.0",
      };
      await writeFile(path.join(tempDir, COCOGEN_CONFIG_FILE), JSON.stringify(config));

      const result = await loadProjectConfig(tempDir);
      expect(result.config.lang).toBe("dotnet");
      expect(result.config.inputFormat).toBe("json");
    });

    test("loads valid REST config", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      const config = {
        lang: "rest" as const,
        tsp: "./schema.tsp",
        inputFormat: "yaml" as const,
        cocogenVersion: "1.0.0",
      };
      await writeFile(path.join(tempDir, COCOGEN_CONFIG_FILE), JSON.stringify(config));

      const result = await loadProjectConfig(tempDir);
      expect(result.config.lang).toBe("rest");
      expect(result.config.inputFormat).toBe("yaml");
    });

    test("normalizes input format from config", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      const config = {
        lang: "ts" as const,
        tsp: "./schema.tsp",
        inputFormat: "CSV",
      };
      await writeFile(path.join(tempDir, COCOGEN_CONFIG_FILE), JSON.stringify(config));

      const result = await loadProjectConfig(tempDir);
      expect(result.config.inputFormat).toBe("csv");
    });

    test("throws error when config file is missing", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));

      await expect(loadProjectConfig(tempDir)).rejects.toThrow(
        `Missing ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`
      );
    });

    test("throws error when lang is invalid", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      const config = {
        lang: "invalid",
        tsp: "./schema.tsp",
        inputFormat: "csv",
      };
      await writeFile(path.join(tempDir, COCOGEN_CONFIG_FILE), JSON.stringify(config));

      await expect(loadProjectConfig(tempDir)).rejects.toThrow(
        `Invalid ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`
      );
    });

    test("throws error when tsp is missing", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      const config = {
        lang: "ts",
        inputFormat: "csv",
      };
      await writeFile(path.join(tempDir, COCOGEN_CONFIG_FILE), JSON.stringify(config));

      await expect(loadProjectConfig(tempDir)).rejects.toThrow(
        `Invalid ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`
      );
    });

    test("throws error when inputFormat is invalid", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      const config = {
        lang: "ts",
        tsp: "./schema.tsp",
        inputFormat: "invalid",
      };
      await writeFile(path.join(tempDir, COCOGEN_CONFIG_FILE), JSON.stringify(config));

      await expect(loadProjectConfig(tempDir)).rejects.toThrow(
        `Invalid ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`
      );
    });

    test("throws error when JSON is malformed", async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "cocogen-test-"));
      await writeFile(path.join(tempDir, COCOGEN_CONFIG_FILE), "{invalid json");

      await expect(loadProjectConfig(tempDir)).rejects.toThrow();
    });
  });
});
