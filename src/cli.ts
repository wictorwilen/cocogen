import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";

function isCiOrNoTty(): boolean {
  return Boolean(process.env.CI) || !process.stdout.isTTY;
}

function shouldUseSpinner(): boolean {
  return !process.env.NO_COLOR && !isCiOrNoTty();
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("gcgen")
    .description("TypeSpec-driven Microsoft Graph (Copilot) connector generator")
    .version("0.0.0")
    .option("--verbose", "Enable verbose output", false);

  program
    .command("validate")
    .description("Validate a TypeSpec schema against connector constraints")
    .requiredOption("--tsp <path>", "Entry TypeSpec file")
    .action(async () => {
      const spinner = shouldUseSpinner() ? ora("Validating...").start() : undefined;
      await new Promise((r) => setTimeout(r, 50));
      spinner?.succeed("Not implemented yet");
      if (!spinner) {
        // No spinner in CI/non-TTY or NO_COLOR.
        process.stdout.write(`${pc.yellow("warn")}: validate is not implemented yet\n`);
      }
      process.exitCode = 1;
    });

  await program.parseAsync(argv);
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${pc.red("error")}: ${message}\n`);
  process.exitCode = 1;
});
