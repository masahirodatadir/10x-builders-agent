import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";

const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB

/** Default Git for Windows install paths — avoids resolving `bash` to a broken WSL shim. */
const WIN32_GIT_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
] as const;

export interface BashResult {
  terminal: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function executeBash(terminal: string, prompt: string): Promise<BashResult> {
  if (process.env.BASH_TOOL_ENABLED !== "true") {
    return {
      terminal,
      stdout: "",
      stderr: "Bash tool is disabled. Set BASH_TOOL_ENABLED=true to enable it.",
      exitCode: 1,
    };
  }

  const cwd = await resolveCwd();
  const bashExe = await resolveBashExecutable();

  return new Promise((resolve) => {
    execFile(
      bashExe,
      ["-lc", prompt],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        const exitCode =
          error?.code !== undefined && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolve({ terminal, stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      }
    );
  });
}

async function resolveBashExecutable(): Promise<string> {
  const fromEnv = process.env.BASH_TOOL_SHELL?.trim();
  if (fromEnv) {
    try {
      const info = await stat(fromEnv);
      if (info.isFile()) return fromEnv;
      console.warn(`[bash] BASH_TOOL_SHELL "${fromEnv}" is not a file, falling back`);
    } catch {
      console.warn(`[bash] BASH_TOOL_SHELL "${fromEnv}" not found, falling back`);
    }
  }

  if (process.platform === "win32") {
    for (const candidate of WIN32_GIT_BASH_CANDIDATES) {
      try {
        await stat(candidate);
        return candidate;
      } catch {
        /* try next */
      }
    }
  }

  return "bash";
}

async function resolveCwd(): Promise<string> {
  const envCwd = process.env.BASH_TOOL_CWD;
  if (!envCwd) return process.cwd();

  try {
    const info = await stat(envCwd);
    if (!info.isDirectory()) {
      console.warn(`[bash] BASH_TOOL_CWD "${envCwd}" is not a directory, falling back to process.cwd()`);
      return process.cwd();
    }
    return envCwd;
  } catch {
    console.warn(`[bash] BASH_TOOL_CWD "${envCwd}" does not exist, falling back to process.cwd()`);
    return process.cwd();
  }
}
