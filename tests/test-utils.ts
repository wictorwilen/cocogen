import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export async function writeTempDir(prefix = "cocogen-test-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeTempTspFile(contents: string, filename = "main.tsp"): Promise<string> {
  const dir = await writeTempDir();
  const fullPath = path.join(dir, filename);
  await writeFile(fullPath, contents, "utf8");
  return fullPath;
}

export type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export async function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }
): Promise<RunResult> {
  const timeoutMs = options?.timeoutMs ?? 60_000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: {
        ...process.env,
        ...options?.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Process timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function isCommandAvailable(command: string, args: string[] = ["--version"]): Promise<boolean> {
  try {
    const result = await runCommand(command, args, { timeoutMs: 10_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function runNode(
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }
): Promise<RunResult> {
  const timeoutMs = options?.timeoutMs ?? 60_000;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options?.cwd,
      env: {
        ...process.env,
        ...options?.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Process timed out after ${timeoutMs}ms: node ${args.join(" ")}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
