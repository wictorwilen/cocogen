import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

const srcDir = path.join(repoRoot, "src", "init", "templates");
const destDir = path.join(repoRoot, "dist", "init", "templates");

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(srcDir))) {
  // Nothing to copy (shouldn't happen in normal dev flows).
  process.exit(0);
}

if (await exists(destDir)) {
  await rm(destDir, { recursive: true, force: true });
}

await mkdir(path.dirname(destDir), { recursive: true });
await cp(srcDir, destDir, { recursive: true });
