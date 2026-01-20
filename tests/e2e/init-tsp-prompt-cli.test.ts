import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeTempDir } from "../test-utils.js";

const inputMock = vi.fn();
const selectMock = vi.fn();
const oraMock = vi.fn();

vi.mock("@inquirer/prompts", () => ({
  input: inputMock,
  select: selectMock,
}));

vi.mock("ora", () => ({
  default: oraMock,
}));

describe("init prompt CLI", () => {
  const originalTty = process.stdin.isTTY;
  const originalSkip = process.env.COCOGEN_SKIP_AUTO_RUN;

  beforeEach(() => {
    process.env.COCOGEN_SKIP_AUTO_RUN = "1";
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    inputMock.mockReset();
    selectMock.mockReset();
    oraMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalTty, configurable: true });
    if (originalSkip === undefined) {
      delete process.env.COCOGEN_SKIP_AUTO_RUN;
    } else {
      process.env.COCOGEN_SKIP_AUTO_RUN = originalSkip;
    }
  });

  test("does not start spinner during prompts", async () => {
    const outRoot = await writeTempDir();
    const outPath = path.join(outRoot, "prompted-schema.tsp");

    inputMock
      .mockResolvedValueOnce(outPath)
      .mockResolvedValueOnce("Item")
      .mockResolvedValueOnce("id");
    selectMock.mockResolvedValueOnce("content");

    const { main } = await import("../../src/cli.js");
    await main(["node", "cli", "init", "--prompt", "--force"]);

    expect(oraMock).not.toHaveBeenCalled();

    const contents = await readFile(outPath, "utf8");
    expect(contents).toContain("model Item");
    expect(contents).toContain("@coco.id");
  });
});