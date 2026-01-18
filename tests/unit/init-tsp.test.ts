import { describe, expect, test } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { initStarterTsp } from "../../src/tsp/init-tsp.js";
import { writeTempDir } from "../test-utils.js";

describe("initStarterTsp", () => {
  test("creates a content starter file with .tsp extension", async () => {
    const dir = await writeTempDir();
    const result = await initStarterTsp({
      outPath: path.join(dir, "schema"),
      kind: "content",
      prompt: false,
    });

    expect(result.outPath.endsWith(".tsp")).toBe(true);
    const contents = await readFile(result.outPath, "utf8");
    expect(contents).toContain("using coco;");
    expect(contents).toContain("@coco.item()");
    expect(contents).toContain("model Item");
    expect(contents).toContain("@coco.id");
  });

  test("creates a people starter file", async () => {
    const dir = await writeTempDir();
    const result = await initStarterTsp({
      outPath: path.join(dir, "people-schema.tsp"),
      kind: "people",
      modelName: "Profile",
      idPropertyName: "upn",
    });

    const contents = await readFile(result.outPath, "utf8");
    expect(contents).toContain("@coco.connection({ contentCategory: \"people\" })");
    expect(contents).toContain("model Profile");
    expect(contents).toContain("upn: string;");
  });

  test("fails when file exists and force is false", async () => {
    const dir = await writeTempDir();
    const outPath = path.join(dir, "schema.tsp");
    await writeFile(outPath, "existing", "utf8");

    await expect(
      initStarterTsp({
        outPath,
        kind: "content",
        force: false,
      })
    ).rejects.toThrow(/already exists/i);
  });

  test("overwrites when force is true", async () => {
    const dir = await writeTempDir();
    const outPath = path.join(dir, "schema.tsp");
    await writeFile(outPath, "existing", "utf8");

    const result = await initStarterTsp({
      outPath,
      kind: "content",
      modelName: "CustomItem",
      idPropertyName: "customId",
      force: true,
    });

    const contents = await readFile(result.outPath, "utf8");
    expect(contents).toContain("model CustomItem");
    expect(contents).toContain("customId: string;");
  });

  test("rejects prompt when not in TTY", async () => {
    const originalTty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    await expect(initStarterTsp({ prompt: true })).rejects.toThrow(/Prompt requires an interactive TTY/i);

    Object.defineProperty(process.stdin, "isTTY", { value: originalTty, configurable: true });
  });
});
