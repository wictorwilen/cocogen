import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeTempDir } from "../test-utils.js";

const inputMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@inquirer/prompts", () => ({
  input: inputMock,
  select: selectMock,
}));

describe("initStarterTsp prompt flow", () => {
  const originalTty = process.stdin.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    inputMock.mockReset();
    selectMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalTty, configurable: true });
  });

  test("prompts for path and fields", async () => {
    const outRoot = await writeTempDir();
    const outPath = path.join(outRoot, "prompted-schema.tsp");

    inputMock
      .mockResolvedValueOnce(outPath)
      .mockResolvedValueOnce("PersonProfile")
      .mockResolvedValueOnce("upn");
    selectMock.mockResolvedValueOnce("people");

    const { initStarterTsp } = await import("../../src/tsp/init-tsp.js");
    const result = await initStarterTsp({ prompt: true });

    expect(result.kind).toBe("people");
    const contents = await readFile(result.outPath, "utf8");
    expect(contents).toContain("@coco.connection({ contentCategory: \"people\" })");
    expect(contents).toContain("model PersonProfile");
    expect(contents).toContain("upn: string;");
  });
});
