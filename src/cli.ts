#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import type { Ora } from "ora";

import { writeIrJson } from "./emit/emit.js";
import { initDotnetProject, initRestProject, initTsProject, updateProject } from "./init/init.js";
import { initStarterTsp } from "./tsp/init-tsp.js";
import { normalizeInputFormat } from "./tsp/input-format.js";
import { loadIrFromTypeSpec } from "./tsp/loader.js";
import { validateIr, type ValidationIssue } from "./validate/validator.js";

function isCiOrNoTty(): boolean {
  return Boolean(process.env.CI) || !process.stdout.isTTY;
}

function shouldShowBanner(): boolean {
  return !process.env.CI && Boolean(process.stderr.isTTY);
}

type PackageInfo = { name?: string; version?: string };
let cachedPackageInfo: PackageInfo | null | undefined;

function readPackageInfo(): PackageInfo | null {
  if (cachedPackageInfo !== undefined) return cachedPackageInfo;
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(dir, "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    cachedPackageInfo = JSON.parse(raw) as PackageInfo;
  } catch {
    // Ignore version lookup errors.
    cachedPackageInfo = null;
  }
  return cachedPackageInfo;
}

function getPackageVersion(): string {
  const info = readPackageInfo();
  const version = info?.version?.trim();
  if (version) return version;
  return "0.0.0";
}

function getVersionLabel(): string {
  return `v${getPackageVersion()}`;
}

function shouldCheckForUpdates(): boolean {
  return !process.env.CI && Boolean(process.stderr.isTTY) && !process.env.COCOGEN_SKIP_UPDATE_CHECK;
}

function resolveRegistryUrl(): string | null {
  const raw = process.env.NPM_CONFIG_REGISTRY ?? process.env.npm_config_registry;
  if (raw && raw.trim().length > 0) {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed.includes("registry.npmjs.org")) return null;
    return trimmed;
  }
  return "https://registry.npmjs.org";
}

function normalizeVersion(version: string): { base: number[]; pre?: string } {
  const [baseRaw = "", pre] = version.trim().split("-", 2);
  const base = baseRaw
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isNaN(n) ? 0 : n));
  return pre ? { base, pre } : { base };
}

function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const max = Math.max(a.base.length, b.base.length);
  for (let i = 0; i < max; i += 1) {
    const delta = (a.base[i] ?? 0) - (b.base[i] ?? 0);
    if (delta !== 0) return delta;
  }
  if (!a.pre && b.pre) return 1;
  if (a.pre && !b.pre) return -1;
  if (a.pre && b.pre) return a.pre.localeCompare(b.pre);
  return 0;
}

async function checkForUpdates(): Promise<void> {
  if (!shouldCheckForUpdates()) return;
  const registry = resolveRegistryUrl();
  if (!registry) return;
  const info = readPackageInfo();
  const name = info?.name?.trim();
  const version = info?.version?.trim();
  if (!name || !version) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);

  try {
    const response = await fetch(`${registry}/${encodeURIComponent(name)}/latest`, {
      signal: controller.signal,
      headers: { "accept": "application/json" },
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { version?: string };
    const latest = payload.version?.trim();
    if (!latest) return;
    if (compareVersions(latest, version) > 0) {
      const line = `${pc.yellow("update available")}: v${version} → v${latest} (run: npm i -g ${name} or npx ${name}@latest)`;
      process.stderr.write(`${line}\n`);
    }
  } catch {
    // Ignore update check errors.
  } finally {
    clearTimeout(timeout);
  }
}

function printBanner(): void {
  if (!shouldShowBanner()) return;

  const title = pc.bold(pc.cyan(`Welcome to cocogen (Copilot connector generator) ${getVersionLabel()}`));
  const subtitle = pc.dim("TypeSpec → Microsoft 365 Copilot connector scaffolding");
  const art = [
    `${pc.cyan("  ██████╗")} ${pc.blue(" ██████╗ ")} ${pc.cyan(" ██████╗")} ${pc.blue(" ██████╗ " )} ${pc.green(" ██████╗ ")} ${pc.magenta("███████╗")} ${pc.yellow(" ███╗   ██╗")}`,
    `${pc.cyan(" ██╔════╝")} ${pc.blue("██╔═══██╗")} ${pc.cyan("██╔════╝")} ${pc.blue("██╔═══██╗")} ${pc.green("██╔════╝ ")} ${pc.magenta("██╔════╝")} ${pc.yellow(" ████╗  ██║")}`,
    `${pc.cyan(" ██║     ")} ${pc.blue("██║   ██║")} ${pc.cyan("██║     ")} ${pc.blue("██║   ██║")} ${pc.green("██║  ███╗")} ${pc.magenta("█████╗  ")} ${pc.yellow(" ██╔██╗ ██║")}`,
    `${pc.cyan(" ██║     ")} ${pc.blue("██║   ██║")} ${pc.cyan("██║     ")} ${pc.blue("██║   ██║")} ${pc.green("██║   ██║")} ${pc.magenta("██╔══╝  ")} ${pc.yellow(" ██║╚██╗██║")}`,
    `${pc.cyan(" ╚██████╗")} ${pc.blue("╚██████╔╝")} ${pc.cyan("╚██████╗")} ${pc.blue("╚██████╔╝")} ${pc.green("╚██████╔╝")} ${pc.magenta("███████╗")} ${pc.yellow(" ██║ ╚████║")}`,
    `${pc.cyan("  ╚═════╝")} ${pc.blue(" ╚═════╝ ")} ${pc.cyan(" ╚═════╝")} ${pc.blue(" ╚═════╝ ")} ${pc.green(" ╚═════╝ ")} ${pc.magenta("╚══════╝")} ${pc.yellow(" ╚═╝  ╚═══╝")}`,
  ].join("\n");

  const credit = `${pc.dim("made with")} ${pc.red("❤")}${pc.dim(" by Wictor Wilén")}`;

  process.stderr.write(`${title}\n${art}\n${subtitle}\n${credit}\n\n`);
}

function shouldUseSpinner(): boolean {
  return !process.env.NO_COLOR && !isCiOrNoTty();
}

function handleCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${pc.red("error")}: ${message}\n`);
  process.exitCode = 1;
}

type CommandRunnerOptions<T> = {
  spinnerText?: string;
  action: (spinner?: Ora) => Promise<T>;
};

async function runCommand<T>({ spinnerText, action }: CommandRunnerOptions<T>): Promise<void> {
  const spinner = spinnerText && shouldUseSpinner() ? ora(spinnerText).start() : undefined;
  try {
    await action(spinner);
  } catch (error: unknown) {
    spinner?.stop();
    handleCliError(error);
    return;
  }
  if (spinner?.isSpinning) spinner.stop();
}

function printIssues(list: ValidationIssue[]): void {
  const errors = list.filter((i) => i.severity === "error");
  const warnings = list.filter((i) => i.severity === "warning");

  const summary = `${errors.length} error(s), ${warnings.length} warning(s)`;
  process.stdout.write(`${pc.bold("validate")}: ${summary}\n`);

  const printGroup = (title: string, group: ValidationIssue[], color: (s: string) => string) => {
    if (group.length === 0) return;
    process.stdout.write(`${color(title)}\n`);
    for (const issue of group) {
      process.stdout.write(`- ${issue.message}\n`);
      if (issue.hint) process.stdout.write(`  ${pc.dim("hint:")} ${issue.hint}\n`);
    }
  };

  printGroup("errors", errors, pc.red);
  printGroup("warnings", warnings, pc.yellow);
}

export async function main(argv: string[]): Promise<void> {
  printBanner();
  await checkForUpdates();

  const program = new Command();

  program
    .name("cocogen")
    .description("TypeSpec-driven Microsoft Copilot connector generator")
    .version(getPackageVersion())
    .option("--verbose", "Enable verbose output", false)
    .option("--use-preview-features", "Allow Graph beta endpoints and SDKs", false);

  const requirePreviewIfNeeded = (ir: { connection: { graphApiVersion: string } }, allow: boolean): void => {
    if (ir.connection.graphApiVersion === "beta" && !allow) {
      throw new Error("This schema requires Graph beta. Re-run with --use-preview-features.");
    }
  };

  program
    .command("validate")
    .description("Validate a TypeSpec schema against connector constraints")
    .requiredOption("--tsp <path>", "Entry TypeSpec file")
    .option("--data-format <format>", "Data format (csv|json|yaml|rest|custom)")
    .option("--json", "Output validation result as JSON", false)
    .action(async (options: { tsp: string; json: boolean; dataFormat?: string }) => {
      await runCommand({
        spinnerText: "Validating TypeSpec...",
        action: async (spinner) => {
        const ir = await loadIrFromTypeSpec(options.tsp, {
          inputFormat: normalizeInputFormat(options.dataFormat),
        });
        requirePreviewIfNeeded(ir, program.opts().usePreviewFeatures as boolean);
        const issues = validateIr(ir);

        const errors = issues.filter((i) => i.severity === "error");
        const warnings = issues.filter((i) => i.severity === "warning");

        if (options.json) {
          spinner?.stop();
          process.stdout.write(
            JSON.stringify(
              {
                ok: errors.length === 0,
                errors,
                warnings,
              },
              null,
              2
            ) + "\n"
          );
          process.exitCode = errors.length === 0 ? 0 : 1;
          return;
        }

        if (errors.length === 0 && warnings.length === 0) {
          spinner?.succeed(`Valid ✅ (${ir.item.typeName})`);
          if (!spinner) process.stdout.write(`${pc.green("ok")}: Valid (${ir.item.typeName})\n`);
          process.exitCode = 0;
          return;
        }

        spinner?.stop();
        printIssues(issues);

        process.exitCode = errors.length === 0 ? 0 : 1;
        },
      });
    });

  program
    .command("emit")
    .description("Emit cocogen IR as JSON (useful for debugging and CI)")
    .requiredOption("--tsp <path>", "Entry TypeSpec file")
    .option("--data-format <format>", "Data format (csv|json|yaml|rest|custom)")
    .option("--out <path>", "Write IR JSON to a file instead of stdout")
    .action(async (options: { tsp: string; out?: string; dataFormat?: string }) => {
      await runCommand({
        spinnerText: "Compiling TypeSpec...",
        action: async (spinner) => {
        const ir = await loadIrFromTypeSpec(options.tsp, {
          inputFormat: normalizeInputFormat(options.dataFormat),
        });
        requirePreviewIfNeeded(ir, program.opts().usePreviewFeatures as boolean);
        const issues = validateIr(ir);
        const errors = issues.filter((i) => i.severity === "error");
        if (errors.length > 0) {
          spinner?.stop();
          printIssues(issues);
          process.exitCode = 1;
          return;
        }

        const result = await writeIrJson(ir, options.out);
        spinner?.stop();

        if (options.out) {
          process.stdout.write(`${pc.green("ok")}: wrote ${result}\n`);
        } else {
          process.stdout.write(result);
        }
        process.exitCode = 0;
          },
        });
    });

  program
    .command("init")
    .description("Create a starter TypeSpec file with guidance comments")
    .option("--out <path>", "Output path for the .tsp file", "schema.tsp")
    .option("--kind <kind>", "Connector kind (content|people)", "content")
    .option("--prompt", "Use interactive prompts", false)
    .option("--force", "Overwrite existing file", false)
    .action(
      async (options: { out: string; kind: string; prompt: boolean; force: boolean }) => {
        const spinnerText = options.prompt ? undefined : "Creating starter TypeSpec...";
        const runnerOptions: CommandRunnerOptions<void> = {
          action: async (spinner) => {
          const kind = options.kind === "people" ? "people" : "content";
          const result = await initStarterTsp({
            outPath: options.out,
            kind,
            prompt: options.prompt,
            force: options.force,
          });

          spinner?.succeed(pc.green("Created"));
          process.stdout.write(`${pc.green("ok")}: Starter TypeSpec created\n`);
          process.stdout.write(`  ${pc.dim("path")}: ${result.outPath}\n`);
          process.stdout.write(`  ${pc.dim("kind")}: ${result.kind}\n`);
          process.stdout.write(`  ${pc.dim("next")}: cocogen validate --tsp ${result.outPath}\n`);
          if (result.kind === "people") {
            process.stdout.write(`  ${pc.dim("note")}: re-run validate/generate with --use-preview-features\n`);
          }
          process.exitCode = 0;
          },
        };
        if (spinnerText) {
          runnerOptions.spinnerText = spinnerText;
        }
        await runCommand(runnerOptions);
      }
    );

  program
    .command("generate")
    .description("Generate a runnable connector project")
    .requiredOption("--tsp <path>", "Entry TypeSpec file")
    .requiredOption("--out <dir>", "Output directory")
    .option("--lang <lang>", "Target language (ts|dotnet|rest)", "ts")
    .option("--name <name>", "Project name (defaults to folder name)")
    .option("--data-format <format>", "Data format (csv|json|yaml|rest|custom)")
    .option("--force", "Overwrite files in a non-empty output directory", false)
    .action(
      async (options: {
        tsp: string;
        out: string;
        lang: string;
        name?: string;
        force: boolean;
        dataFormat?: string;
      }) => {
        await runCommand({
          spinnerText: "Generating project...",
          action: async (spinner) => {
          const lang = options.lang === "dotnet" ? "dotnet" : options.lang === "rest" ? "rest" : "ts";
          const usePreviewFeatures = program.opts().usePreviewFeatures as boolean;
          const inputFormat = normalizeInputFormat(options.dataFormat);
          const result =
            lang === "ts"
              ? await initTsProject({
                  tspPath: options.tsp,
                  outDir: options.out,
                  ...(options.name ? { projectName: options.name } : {}),
                  force: options.force,
                  usePreviewFeatures,
                  inputFormat,
                })
              : lang === "dotnet"
              ? await initDotnetProject({
                  tspPath: options.tsp,
                  outDir: options.out,
                  ...(options.name ? { projectName: options.name } : {}),
                  force: options.force,
                  usePreviewFeatures,
                  inputFormat,
                })
              : await initRestProject({
                  tspPath: options.tsp,
                  outDir: options.out,
                  ...(options.name ? { projectName: options.name } : {}),
                  force: options.force,
                  usePreviewFeatures,
                  inputFormat,
                });

          spinner?.succeed(pc.green("Generated"));

          process.stdout.write(`${pc.green("ok")}: Project generated\n`);
          process.stdout.write(`  ${pc.dim("path")}: ${result.outDir}\n`);
          process.stdout.write(`  ${pc.dim("schema")}: ${result.ir.item.typeName}\n`);
          process.stdout.write(`  ${pc.dim("graph")}: ${result.ir.connection.graphApiVersion}\n`);
          if (result.ir.connection.contentCategory) {
            process.stdout.write(`  ${pc.dim("category")}: ${result.ir.connection.contentCategory}\n`);
            if (result.ir.connection.graphApiVersion === "beta") {
              process.stdout.write(
                `  ${pc.yellow("note")}: contentCategory is a Graph /beta property; provisioning will use /beta\n`
              );
            }
          }
          const nextCmd =
            lang === "ts"
              ? "npm install"
              : lang === "dotnet"
              ? "dotnet build"
              : "open the .http files in your REST client";
          process.stdout.write(`  ${pc.dim("next")}: cd ${result.outDir} && ${nextCmd}\n`);
          process.exitCode = 0;
          },
        });
      }
    );

  program
    .command("update")
    .description("Regenerate TypeSpec-derived code inside an existing generated project")
    .requiredOption("--out <dir>", "Project directory (must contain cocogen.json)")
    .option("--tsp <path>", "Override TypeSpec entrypoint (also updates cocogen.json)")
    .action(async (options: { out: string; tsp?: string }) => {
      await runCommand({
        spinnerText: "Updating generated files...",
        action: async (spinner) => {
        const usePreviewFeatures = program.opts().usePreviewFeatures as boolean;
        const result = await updateProject({
          outDir: options.out,
          ...(options.tsp ? { tspPath: options.tsp } : {}),
          usePreviewFeatures,
        });

        spinner?.succeed(pc.green("Updated"));

        process.stdout.write(`${pc.green("ok")}: Regenerated TypeSpec-derived files\n`);
        process.stdout.write(`  ${pc.dim("path")}: ${result.outDir}\n`);
        process.stdout.write(`  ${pc.dim("schema")}: ${result.ir.item.typeName}\n`);
        process.stdout.write(`  ${pc.dim("graph")}: ${result.ir.connection.graphApiVersion}\n`);
        if (result.ir.connection.contentCategory) {
          process.stdout.write(`  ${pc.dim("category")}: ${result.ir.connection.contentCategory}\n`);
          if (result.ir.connection.graphApiVersion === "beta") {
            process.stdout.write(
              `  ${pc.yellow("note")}: contentCategory is a Graph /beta property; provisioning will use /beta\n`
            );
          }
        }
        process.exitCode = 0;
        },
      });
    });

  await program.parseAsync(argv);
}

if (process.env.COCOGEN_SKIP_AUTO_RUN !== "1") {
  // eslint-disable-next-line unicorn/prefer-top-level-await
  main(process.argv).catch((error: unknown) => {
    handleCliError(error);
  });
}
