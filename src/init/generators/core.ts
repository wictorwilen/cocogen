import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { ConnectorIr } from "../../ir.js";
import { COCOGEN_CONFIG_FILE, projectConfigContents, type CocogenProjectConfig } from "../project-config.js";

export type GeneratorContext<TSettings> = {
  outDir: string;
  ir: ConnectorIr;
  settings: TSettings;
};

/** Shared generator base for language-specific emitters. */
export abstract class CoreGenerator<TSettings> {
  protected abstract lang: CocogenProjectConfig["lang"];

  protected constructor(protected context: GeneratorContext<TSettings>) {}

  protected get outDir(): string {
    return this.context.outDir;
  }

  protected get ir(): ConnectorIr {
    return this.context.ir;
  }

  protected get settings(): TSettings {
    return this.context.settings;
  }

  /** Write cocogen.json for the generated project. */
  protected async writeProjectConfig(tspPath: string): Promise<void> {
    await writeFile(
      path.join(this.outDir, COCOGEN_CONFIG_FILE),
      projectConfigContents(this.outDir, tspPath, this.lang, this.ir.connection.inputFormat),
      "utf8"
    );
  }

  abstract writeScaffold(): Promise<void>;
  abstract writeGenerated(): Promise<void>;
}
