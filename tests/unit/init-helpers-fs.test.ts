import { describe, expect, test } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { ensureEmptyDir, removeIfExists, updateSchemaCopy } from "../../src/init/helpers/fs.js";
import { writeTempDir } from "../test-utils.js";

const writeTempFile = async (dir: string, name: string, contents: string): Promise<string> => {
  const fullPath = path.join(dir, name);
  await writeFile(fullPath, contents, "utf8");
  return fullPath;
};

describe("init/helpers/fs", () => {
  test("removeIfExists deletes files and ignores missing targets", async () => {
    const dir = await writeTempDir();
    const filePath = await writeTempFile(dir, "file.txt", "hello");

    await expect(stat(filePath)).resolves.toHaveProperty("size", 5);
    await removeIfExists(filePath);
    await expect(stat(filePath)).rejects.toThrow();

    // second call should not throw even though the file is already gone
    await expect(removeIfExists(filePath)).resolves.toBeUndefined();
  });

  test("removeIfExists rethrows unexpected fs errors", async () => {
    const dir = await writeTempDir();
    const nestedDir = path.join(dir, "folder");
    await mkdir(nestedDir);

    await expect(removeIfExists(nestedDir)).rejects.toThrow();
  });

  test("ensureEmptyDir enforces force flag semantics", async () => {
    const dir = await writeTempDir();
    const target = path.join(dir, "out");
    await ensureEmptyDir(target, true);
    await writeTempFile(target, "existing.txt", "value");

    await expect(ensureEmptyDir(target, false)).rejects.toThrow(/not empty/i);
    await expect(ensureEmptyDir(target, true)).resolves.toBeUndefined();
  });

  test("updateSchemaCopy copies schema.tsp into the output directory", async () => {
    const dir = await writeTempDir();
    const outDir = path.join(dir, "out");
    await ensureEmptyDir(outDir, true);
    const schemaPath = await writeTempFile(dir, "schema-source.tsp", "model Item {}");

    await updateSchemaCopy(outDir, schemaPath);

    const copied = await readFile(path.join(outDir, "schema.tsp"), "utf8");
    expect(copied).toBe("model Item {}");
  });
});
