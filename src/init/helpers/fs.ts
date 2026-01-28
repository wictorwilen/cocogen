import { copyFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

export async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
}

export async function ensureEmptyDir(outDir: string, force: boolean): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const entries = await readdir(outDir);
  if (entries.length > 0 && !force) {
    throw new Error(
      `Output directory is not empty: ${outDir}. Use an empty folder or pass --force to overwrite.`
    );
  }
}

export async function updateSchemaCopy(outDir: string, tspPath: string): Promise<void> {
  await copyFile(tspPath, path.join(outDir, "schema.tsp"));
}
