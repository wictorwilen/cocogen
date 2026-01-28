import { copyFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

/** Remove a file if it exists; ignore missing files. */
export async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
}

/** Ensure output directory exists and is empty unless forced. */
export async function ensureEmptyDir(outDir: string, force: boolean): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const entries = await readdir(outDir);
  if (entries.length > 0 && !force) {
    throw new Error(
      `Output directory is not empty: ${outDir}. Use an empty folder or pass --force to overwrite.`
    );
  }
}

/** Copy the TypeSpec schema into the output directory. */
export async function updateSchemaCopy(outDir: string, tspPath: string): Promise<void> {
  await copyFile(tspPath, path.join(outDir, "schema.tsp"));
}
