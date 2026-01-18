import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ejs from "ejs";

function templatesRootDir(): string {
  // Works both from src (ts-node/dev) and from dist (compiled).
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");
}

export async function renderTemplate(
  relativePath: string,
  data: Record<string, unknown>
): Promise<string> {
  const fullPath = path.join(templatesRootDir(), relativePath);
  const template = await readFile(fullPath, "utf8");
  return ejs.render(template, data, {
    filename: fullPath,
    // Codegen templates should not HTML-escape output.
    escape: (markup: string) => markup,
    async: false,
  });
}
