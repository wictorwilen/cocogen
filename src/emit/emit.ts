import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ConnectorIr } from "../ir.js";

export async function writeIrJson(ir: ConnectorIr, outPath?: string): Promise<string> {
  const json = JSON.stringify(ir, null, 2) + "\n";

  if (!outPath) {
    return json;
  }

  const absolute = path.resolve(outPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, json, "utf8");
  return absolute;
}
