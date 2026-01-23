import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeInputFormat, type InputFormat } from "../tsp/input-format.js";

export type CocogenProjectConfig = {
  lang: "ts" | "dotnet" | "rest";
  tsp: string;
  inputFormat: InputFormat;
  cocogenVersion?: string;
};

export const COCOGEN_CONFIG_FILE = "cocogen.json";

export function getGeneratorVersion(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(dir, "..", "package.json"),
      path.resolve(dir, "..", "..", "package.json"),
      path.resolve(dir, "..", "..", "..", "package.json"),
      path.resolve(process.cwd(), "package.json"),
    ];

    for (const pkgPath of candidates) {
      try {
        const raw = readFileSync(pkgPath, "utf8");
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        const name = parsed.name?.trim();
        if (name && name !== "@wictorwilen/cocogen" && name !== "cocogen") {
          continue;
        }
        if (parsed.version && parsed.version.trim().length > 0) {
          return parsed.version.trim();
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore version lookup errors.
  }
  return "0.0.0";
}

export function projectConfigContents(
  outDir: string,
  tspPath: string,
  lang: CocogenProjectConfig["lang"],
  inputFormat: CocogenProjectConfig["inputFormat"]
): string {
  const rel = path.relative(outDir, path.resolve(tspPath)).replaceAll(path.sep, "/");
  const config: CocogenProjectConfig = {
    lang,
    tsp: rel || "./schema.tsp",
    inputFormat,
    cocogenVersion: getGeneratorVersion(),
  };
  return JSON.stringify(config, null, 2) + "\n";
}

export async function loadProjectConfig(outDir: string): Promise<{ config: CocogenProjectConfig }> {
  const tryRead = async (fileName: string): Promise<string | undefined> => {
    try {
      return await readFile(path.join(outDir, fileName), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw error;
    }
  };

  const raw = await tryRead(COCOGEN_CONFIG_FILE);

  if (!raw) {
    throw new Error(`Missing ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`);
  }

  const parsed = JSON.parse(raw) as Partial<CocogenProjectConfig>;
  let inputFormat: InputFormat;
  try {
    inputFormat = normalizeInputFormat(parsed.inputFormat);
  } catch {
    throw new Error(`Invalid ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`);
  }
  if ((parsed.lang !== "ts" && parsed.lang !== "dotnet" && parsed.lang !== "rest") || typeof parsed.tsp !== "string") {
    throw new Error(`Invalid ${COCOGEN_CONFIG_FILE}. Re-run cocogen generate or fix the file.`);
  }
  return {
    config: {
      lang: parsed.lang,
      tsp: parsed.tsp,
      inputFormat,
      ...(parsed.cocogenVersion ? { cocogenVersion: parsed.cocogenVersion } : {}),
    },
  };
}
