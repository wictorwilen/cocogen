import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

import type { ConnectorIr } from "../../src/ir.js";

const writeIrJsonMock = vi.fn<Parameters<typeof import("../../src/emit/emit.js").writeIrJson>, Promise<string>>();
const loadIrMock = vi.fn<Parameters<typeof import("../../src/tsp/loader.js").loadIrFromTypeSpec>, Promise<ConnectorIr>>();
const validateIrMock = vi.fn<Parameters<typeof import("../../src/validate/validator.js").validateIr>, ReturnType<typeof import("../../src/validate/validator.js").validateIr>>();
const initStarterMock = vi.fn<Parameters<typeof import("../../src/tsp/init-tsp.js").initStarterTsp>, Promise<{ outPath: string; kind: "content" | "people" }>>();
const initTsMock = vi.fn<Parameters<typeof import("../../src/init/init.js").initTsProject>, Promise<{ outDir: string; ir: ConnectorIr }>>();
const initDotnetMock = vi.fn<Parameters<typeof import("../../src/init/init.js").initDotnetProject>, Promise<{ outDir: string; ir: ConnectorIr }>>();
const initRestMock = vi.fn<Parameters<typeof import("../../src/init/init.js").initRestProject>, Promise<{ outDir: string; ir: ConnectorIr }>>();
const updateProjectMock = vi.fn<Parameters<typeof import("../../src/init/init.js").updateProject>, Promise<{ outDir: string; ir: ConnectorIr }>>();

vi.mock("../../src/emit/emit.js", () => ({ writeIrJson: writeIrJsonMock }));
vi.mock("../../src/tsp/loader.js", () => ({ loadIrFromTypeSpec: loadIrMock }));
vi.mock("../../src/validate/validator.js", () => ({ validateIr: validateIrMock }));
vi.mock("../../src/tsp/init-tsp.js", () => ({ initStarterTsp: initStarterMock }));
vi.mock("../../src/init/init.js", () => ({
  initTsProject: initTsMock,
  initDotnetProject: initDotnetMock,
  initRestProject: initRestMock,
  updateProject: updateProjectMock,
}));
vi.mock("ora", () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn() }),
  }),
}));

const minimalIr: ConnectorIr = {
  connection: { graphApiVersion: "v1.0", inputFormat: "csv" },
  item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
  properties: [
    {
      name: "id",
      type: "string",
      labels: [],
      aliases: [],
      search: {},
      source: { csvHeaders: ["id"] },
    },
  ],
};

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  return fn()
    .then(() => output)
    .finally(() => {
      process.stdout.write = original;
    });
}

function captureStderr(fn: () => Promise<void>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  let output = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  return fn()
    .then(() => output)
    .finally(() => {
      process.stderr.write = original;
    });
}

beforeEach(() => {
  process.env.NO_COLOR = "1";
  process.env.COCOGEN_SKIP_AUTO_RUN = "1";
  process.env.COCOGEN_SKIP_UPDATE_CHECK = "1";
  process.exitCode = undefined;
  writeIrJsonMock.mockReset();
  loadIrMock.mockReset();
  validateIrMock.mockReset();
  initStarterMock.mockReset();
  initTsMock.mockReset();
  initDotnetMock.mockReset();
  initRestMock.mockReset();
  updateProjectMock.mockReset();
});

afterEach(() => {
  delete process.env.NO_COLOR;
  delete process.env.COCOGEN_SKIP_AUTO_RUN;
  delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
  process.exitCode = undefined;
});

describe("cli", () => {
  test("emit prints JSON to stdout", async () => {
    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{\n  \"ok\": true\n}\n");

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stdout).toContain("\"ok\"");
    expect(process.exitCode).toBe(0);
  });

  test("emit uses spinner when TTY and color enabled", async () => {
    const originalTty = process.stdout.isTTY;
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);

    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
    process.env.NO_COLOR = "1";
  });

  test("emit reports validation errors and exits non-zero", async () => {
    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([{ severity: "error", message: "bad", hint: "fix" }]);
    writeIrJsonMock.mockResolvedValue("{}");

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stdout).toContain("errors");
    expect(writeIrJsonMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("init prints creation summary", async () => {
    initStarterMock.mockResolvedValue({ outPath: "/tmp/schema.tsp", kind: "content" });

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "init", "--out", "/tmp/schema.tsp", "--kind", "content"]);
    });

    expect(stdout).toContain("Starter TypeSpec created");
    expect(process.exitCode).toBe(0);
  });

  test("init prints preview note for people schemas", async () => {
    initStarterMock.mockResolvedValue({ outPath: "/tmp/schema.tsp", kind: "people" });

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "init", "--out", "/tmp/schema.tsp", "--kind", "people"]);
    });

    expect(stdout).toContain("use-preview-features");
    expect(process.exitCode).toBe(0);
  });

  test("init prints error when creation fails", async () => {
    initStarterMock.mockRejectedValue(new Error("create failed"));

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "init", "--out", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("create failed");
    expect(process.exitCode).toBe(1);
  });

  test("init prints non-error rejections", async () => {
    initStarterMock.mockRejectedValue("boom");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "init", "--out", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("boom");
    expect(process.exitCode).toBe(1);
  });

  test("generate prints a project summary", async () => {
    initTsMock.mockResolvedValue({ outDir: "/tmp/out", ir: minimalIr });

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "generate", "--tsp", "/tmp/schema.tsp", "--out", "/tmp/out"]);
    });

    expect(stdout).toContain("Project generated");
    expect(stdout).toContain("/tmp/out");
    expect(process.exitCode).toBe(0);
  });

  test("generate passes project name when provided", async () => {
    initTsMock.mockResolvedValue({ outDir: "/tmp/out", ir: minimalIr });

    const { main } = await import("../../src/cli.js");
    await main([
      "node",
      "cli",
      "generate",
      "--tsp",
      "/tmp/schema.tsp",
      "--out",
      "/tmp/out",
      "--name",
      "MyProject",
    ]);

    expect(initTsMock).toHaveBeenCalled();
    const call = initTsMock.mock.calls[0]?.[0] as { projectName?: string };
    expect(call.projectName).toBe("MyProject");
  });

  test("generate prints error when generation fails", async () => {
    initTsMock.mockRejectedValue(new Error("init failed"));

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "generate", "--tsp", "/tmp/schema.tsp", "--out", "/tmp/out"]);
    });

    expect(stderr).toContain("init failed");
    expect(process.exitCode).toBe(1);
  });

  test("generate prints non-error rejections", async () => {
    initTsMock.mockRejectedValue("boom");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "generate", "--tsp", "/tmp/schema.tsp", "--out", "/tmp/out"]);
    });

    expect(stderr).toContain("boom");
    expect(process.exitCode).toBe(1);
  });

  test("prints update available when a newer version exists", async () => {
    const originalTty = process.stderr.isTTY;
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "9.9.9" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("update available");

    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
    process.env.COCOGEN_SKIP_UPDATE_CHECK = "1";
  });

  test("skips prerelease updates when current is stable", async () => {
    const originalTty = process.stderr.isTTY;
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.0.25-alpha.1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).not.toContain("update available");

    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
    process.env.COCOGEN_SKIP_UPDATE_CHECK = "1";
  });

  test("update prints regeneration summary", async () => {
    updateProjectMock.mockResolvedValue({ outDir: "/tmp/out", ir: minimalIr });

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "update", "--out", "/tmp/out"]);
    });

    expect(stdout).toContain("Regenerated TypeSpec-derived files");
    expect(stdout).toContain("/tmp/out");
    expect(process.exitCode).toBe(0);
  });

  test("update prints beta note for contentCategory", async () => {
    updateProjectMock.mockResolvedValue({
      outDir: "/tmp/out",
      ir: {
        ...minimalIr,
        connection: { ...minimalIr.connection, graphApiVersion: "beta", contentCategory: "people" },
      },
    });

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "update", "--out", "/tmp/out"]);
    });

    expect(stdout).toContain("contentCategory is a Graph /beta property");
    expect(process.exitCode).toBe(0);
  });

  test("update passes tsp override when provided", async () => {
    updateProjectMock.mockResolvedValue({ outDir: "/tmp/out", ir: minimalIr });

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "update", "--out", "/tmp/out", "--tsp", "/tmp/override.tsp"]);

    expect(updateProjectMock).toHaveBeenCalled();
    const call = updateProjectMock.mock.calls[0]?.[0] as { tspPath?: string };
    expect(call.tspPath).toBe("/tmp/override.tsp");
  });

  test("update prints error when generation fails", async () => {
    updateProjectMock.mockRejectedValue(new Error("update failed"));

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "update", "--out", "/tmp/out"]);
    });

    expect(stderr).toContain("update failed");
    expect(process.exitCode).toBe(1);
  });

  test("update prints non-error rejections", async () => {
    updateProjectMock.mockRejectedValue("boom");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "update", "--out", "/tmp/out"]);
    });

    expect(stderr).toContain("boom");
    expect(process.exitCode).toBe(1);
  });

  test("emit writes when --out is provided", async () => {
    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("/tmp/ir.json");

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp", "--out", "/tmp/ir.json"]);
    });

    expect(stdout).toContain("wrote /tmp/ir.json");
    expect(process.exitCode).toBe(0);
  });

  test("validate writes error to stderr on failure", async () => {
    loadIrMock.mockRejectedValue(new Error("bad schema"));

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "validate", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("bad schema");
    expect(process.exitCode).toBe(1);
  });

  test("validate writes JSON output when requested", async () => {
    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([{ severity: "warning", message: "warn" }]);

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "validate", "--tsp", "/tmp/schema.tsp", "--json"]);
    });

    expect(stdout).toContain("\"warnings\"");
    expect(process.exitCode).toBe(0);
  });

  test("validate writes JSON output with errors", async () => {
    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([{ severity: "error", message: "bad" }]);

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "validate", "--tsp", "/tmp/schema.tsp", "--json"]);
    });

    expect(stdout).toContain("\"errors\"");
    expect(process.exitCode).toBe(1);
  });

  test("validate prints success when no issues", async () => {
    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "validate", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stdout).toContain("Valid");
    expect(process.exitCode).toBe(0);
  });

  test("validate uses spinner when TTY and color enabled", async () => {
    const originalTty = process.stdout.isTTY;
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "validate", "--tsp", "/tmp/schema.tsp"]);

    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
    process.env.NO_COLOR = "1";
  });

  test("init uses spinner when TTY and color enabled", async () => {
    const originalTty = process.stdout.isTTY;
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    initStarterMock.mockResolvedValue({ outPath: "/tmp/schema.tsp", kind: "content" });

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "init", "--out", "/tmp/schema.tsp"]);

    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
    process.env.NO_COLOR = "1";
  });

  test("generate uses spinner when TTY and color enabled", async () => {
    const originalTty = process.stdout.isTTY;
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    initTsMock.mockResolvedValue({ outDir: "/tmp/out", ir: minimalIr });

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "generate", "--tsp", "/tmp/schema.tsp", "--out", "/tmp/out"]);

    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
    process.env.NO_COLOR = "1";
  });

  test("update uses spinner when TTY and color enabled", async () => {
    const originalTty = process.stdout.isTTY;
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    updateProjectMock.mockResolvedValue({ outDir: "/tmp/out", ir: minimalIr });

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "update", "--out", "/tmp/out"]);

    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
    process.env.NO_COLOR = "1";
  });

  test("validate prints warnings when present", async () => {
    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([{ severity: "warning", message: "warn" }]);

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "validate", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stdout).toContain("warnings");
    expect(process.exitCode).toBe(0);
  });

  test("emit fails when preview features are required", async () => {
    loadIrMock.mockResolvedValue({
      ...minimalIr,
      connection: { ...minimalIr.connection, graphApiVersion: "beta" },
    });
    validateIrMock.mockReturnValue([]);

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("Graph beta");
    expect(process.exitCode).toBe(1);
  });

  test("emit allows beta when preview features enabled", async () => {
    loadIrMock.mockResolvedValue({
      ...minimalIr,
      connection: { ...minimalIr.connection, graphApiVersion: "beta" },
    });
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp", "--use-preview-features"]);

    expect(process.exitCode).toBe(0);
  });

  test("generate prints beta note for contentCategory", async () => {
    initTsMock.mockResolvedValue({
      outDir: "/tmp/out",
      ir: {
        ...minimalIr,
        connection: { ...minimalIr.connection, graphApiVersion: "beta", contentCategory: "people" },
      },
    });

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main(["node", "cli", "generate", "--tsp", "/tmp/schema.tsp", "--out", "/tmp/out"]);
    });

    expect(stdout).toContain("contentCategory is a Graph /beta property");
    expect(process.exitCode).toBe(0);
  });

  test("generate handles dotnet language", async () => {
    initDotnetMock.mockResolvedValue({ outDir: "/tmp/out", ir: minimalIr });

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main([
        "node",
        "cli",
        "generate",
        "--tsp",
        "/tmp/schema.tsp",
        "--out",
        "/tmp/out",
        "--lang",
        "dotnet",
      ]);
    });

    expect(stdout).toContain("Project generated");
    expect(process.exitCode).toBe(0);
  });

  test("generate handles rest language", async () => {
    initRestMock.mockResolvedValue({ outDir: "/tmp/out", ir: minimalIr });

    const { main } = await import("../../src/cli.js");
    const stdout = await captureStdout(async () => {
      await main([
        "node",
        "cli",
        "generate",
        "--tsp",
        "/tmp/schema.tsp",
        "--out",
        "/tmp/out",
        "--lang",
        "rest",
      ]);
    });

    expect(stdout).toContain("Project generated");
    expect(process.exitCode).toBe(0);
  });

  test("auto-run prints banner when TTY", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_AUTO_RUN;
    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const originalArgv = process.argv;
    process.argv = ["node", "cli", "--help"];

    const stderr = await captureStderr(async () => {
      await import("../../src/cli.js");
    });

    process.argv = originalArgv;
    process.env.COCOGEN_SKIP_AUTO_RUN = "1";
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });

    expect(stderr).toContain("cocogen");
  });

  test("prints update notice when newer version exists", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ version: "999.0.0" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("update available");
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });

  test("skips update check when disabled", async () => {
    vi.resetModules();
    process.env.COCOGEN_SKIP_UPDATE_CHECK = "1";
    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);

    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });

  test("skips update check when custom npm registry is configured", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    process.env.NPM_CONFIG_REGISTRY = "https://registry.example.com";
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);

    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
    delete process.env.NPM_CONFIG_REGISTRY;
  });

  test("uses npm registry when configured explicitly", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    process.env.NPM_CONFIG_REGISTRY = "https://registry.npmjs.org/";
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ version: "9.9.9" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);

    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
    delete process.env.NPM_CONFIG_REGISTRY;
  });

  test("ignores update check when registry responds non-ok", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: false,
        json: async () => ({}),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(stderr).not.toContain("update available");

    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });

  test("continues when update check fails", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);

    expect(fetchMock).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);

    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });

  test("skips banner output in CI", async () => {
    vi.resetModules();
    process.env.CI = "1";
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).not.toContain("Welcome to cocogen");

    delete process.env.CI;
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });

  test("falls back to v0.0.0 when package info is unavailable", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importActual) => {
      const actual = await importActual<typeof import("node:fs")>();
      return {
        ...actual,
        readFileSync: () => {
          throw new Error("no package");
        },
      };
    });

    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("v0.0.0");

    vi.doUnmock("node:fs");
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });

  test("treats prerelease current versions as older", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    vi.doMock("node:fs", async (importActual) => {
      const actual = await importActual<typeof import("node:fs")>();
      return {
        ...actual,
        readFileSync: () => JSON.stringify({ name: "cocogen", version: "1.0.0-beta" }),
      };
    });

    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("update available");

    vi.doUnmock("node:fs");
    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });

  test("does not offer updates when only prerelease is newer", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    vi.doMock("node:fs", async (importActual) => {
      const actual = await importActual<typeof import("node:fs")>();
      return {
        ...actual,
        readFileSync: () => JSON.stringify({ name: "cocogen", version: "1.0.0" }),
      };
    });

    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ version: "1.0.0-beta" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).not.toContain("update available");

    vi.doUnmock("node:fs");
    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });

  test("orders prerelease tags when comparing versions", async () => {
    vi.resetModules();
    delete process.env.COCOGEN_SKIP_UPDATE_CHECK;
    delete process.env.CI;
    const originalTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    vi.doMock("node:fs", async (importActual) => {
      const actual = await importActual<typeof import("node:fs")>();
      return {
        ...actual,
        readFileSync: () => JSON.stringify({ name: "cocogen", version: "1.0.0-alpha" }),
      };
    });

    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ version: "1.0.0-beta" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadIrMock.mockResolvedValue(minimalIr);
    validateIrMock.mockReturnValue([]);
    writeIrJsonMock.mockResolvedValue("{}\n");

    const { main } = await import("../../src/cli.js");
    const stderr = await captureStderr(async () => {
      await main(["node", "cli", "emit", "--tsp", "/tmp/schema.tsp"]);
    });

    expect(stderr).toContain("update available");

    vi.doUnmock("node:fs");
    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: originalTty, configurable: true });
  });
});
