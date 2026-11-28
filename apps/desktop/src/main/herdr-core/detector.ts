import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  HerdrCoreDetection,
  HerdrCoreStartServerResult,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface HerdrCoreDetectorDeps {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
  readonly exists?: (candidate: string) => boolean;
  readonly isSocket?: (candidate: string) => boolean;
  readonly isExecutable?: (candidate: string) => boolean;
  readonly runCommand?: (
    file: string,
    args: readonly string[],
    options: {
      readonly env?: NodeJS.ProcessEnv;
      readonly timeoutMs: number;
    },
  ) => Promise<{ readonly stdout: string; readonly stderr: string }>;
}

const DEFAULT_SESSION = "default";
const VERSION_TIMEOUT_MS = 3_000;
const START_TIMEOUT_MS = 10_000;

function defaultIsSocket(candidate: string): boolean {
  try {
    return statSync(candidate).isSocket();
  } catch {
    return false;
  }
}

function defaultIsExecutable(candidate: string): boolean {
  try {
    const info = statSync(candidate);
    if (!info.isFile()) return false;
    if (process.platform === "win32") return true;
    return (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function defaultRunCommand(
  file: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv; readonly timeoutMs: number },
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const result = await execFileAsync(file, [...args], {
    env: options.env,
    timeout: options.timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

export function herdrCoreInstallHint(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return "Install herdr-core (hc) and run `hc server start` in a desktop terminal.";
  }
  if (platform === "darwin") {
    return "Install Herdr Core (`hc`) so `~/.local/bin/hc` or `Herdr Core.app` is available, then run `hc server start`.";
  }
  return "Install herdr-core (`hc`) into `~/.local/bin/hc`, then run `hc server start`.";
}

export function resolveHerdrCoreSession(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const raw = env.HC_SESSION?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_SESSION;
}

/**
 * Resolves the Unix domain socket path for `herdr-core` on macOS/Linux,
 * or the Windows state directory / named pipe indicator on Windows.
 * Always prioritizes the user's shared default `herdr-core` socket so macOS
 * TCC privacy grants and `herdr-app` interoperability stay intact.
 */
export function resolveHerdrCoreSocketPath(options: {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}): string | null {
  const { platform, env, homeDir } = options;
  const session = resolveHerdrCoreSession(env);

  const override = env.HC_SOCKET?.trim();
  if (override) {
    return override;
  }

  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA?.trim() || path.win32.join(homeDir, "AppData", "Local");
    return path.win32.join(
      localAppData,
      "herdr-core",
      session,
      `${session}.sock`,
    );
  }

  const xdgState = env.XDG_STATE_HOME?.trim();
  const stateRoot =
    xdgState && path.posix.isAbsolute(xdgState)
      ? xdgState
      : path.posix.join(homeDir, ".local", "state");

  return path.posix.join(stateRoot, "herdr-core", session, `${session}.sock`);
}

function candidateBinaryPaths(options: {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}): string[] {
  const { platform, env, homeDir } = options;
  const isWindows = platform === "win32";
  const pathApi = isWindows ? path.win32 : path.posix;
  const delimiter = isWindows ? ";" : ":";
  const binaryNames = isWindows ? ["hc.exe", "hc.cmd", "hc"] : ["hc"];
  const candidates: string[] = [];

  const installDir = env.HC_INSTALL_DIR?.trim();
  if (installDir) {
    for (const name of binaryNames) {
      candidates.push(pathApi.join(installDir, name));
    }
  }

  const pathEnv = env.PATH ?? env.Path ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    for (const name of binaryNames) {
      candidates.push(pathApi.join(trimmed, name));
    }
  }

  if (isWindows) {
    const localAppData =
      env.LOCALAPPDATA?.trim() || pathApi.join(homeDir, "AppData", "Local");
    candidates.push(
      pathApi.join(localAppData, "Programs", "herdr-core", "hc.exe"),
      pathApi.join(localAppData, "herdr-core", "hc.exe"),
      pathApi.join(homeDir, ".local", "bin", "hc.exe"),
    );
  } else if (platform === "darwin") {
    candidates.push(
      pathApi.join(homeDir, ".local", "bin", "hc"),
      pathApi.join(
        homeDir,
        ".local",
        "share",
        "herdr-core",
        "active",
        "Herdr Core.app",
        "Contents",
        "MacOS",
        "herdr-core",
      ),
      "/Applications/Herdr Core.app/Contents/MacOS/herdr-core",
      "/opt/homebrew/bin/hc",
      "/usr/local/bin/hc",
    );
  } else {
    candidates.push(
      pathApi.join(homeDir, ".local", "bin", "hc"),
      "/usr/local/bin/hc",
      "/usr/bin/hc",
    );
  }

  return [...new Set(candidates)];
}

export function locateHerdrCoreBinary(
  deps: HerdrCoreDetectorDeps = {},
): string | null {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const homeDir = deps.homeDir ?? os.homedir();
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;

  for (const candidate of candidateBinaryPaths({ platform, env, homeDir })) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function parseHcVersionOutput(stdout: string): string | null {
  const firstLine = stdout.trim().split(/\r?\n/u)[0]?.trim();
  if (!firstLine) return null;
  const match = /(?:^|\s)(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/u.exec(firstLine);
  return match?.[1] ?? firstLine.replace(/^(?:hc|herdr-core)\s+/iu, "").trim();
}

/**
 * Inspects the local machine for a running shared `herdr-core` socket and
 * installed `hc` binary without starting or mutating any daemon state.
 */
export async function detectHerdrCore(
  deps: HerdrCoreDetectorDeps = {},
): Promise<HerdrCoreDetection> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const homeDir = deps.homeDir ?? os.homedir();
  const exists = deps.exists ?? existsSync;
  const isSocket = deps.isSocket ?? defaultIsSocket;
  const runCommand = deps.runCommand ?? defaultRunCommand;

  const session = resolveHerdrCoreSession(env);
  const socketPath = resolveHerdrCoreSocketPath({ platform, env, homeDir });
  const binaryPath = locateHerdrCoreBinary({
    platform,
    env,
    homeDir,
    isExecutable: deps.isExecutable,
  });

  let running = false;
  if (socketPath) {
    running = platform === "win32" ? exists(socketPath) : isSocket(socketPath);
  }

  let version: string | null = null;
  if (binaryPath) {
    try {
      const result = await runCommand(binaryPath, ["--version"], {
        env: env,
        timeoutMs: VERSION_TIMEOUT_MS,
      });
      version = parseHcVersionOutput(result.stdout);
    } catch {
      version = null;
    }

    // On Windows (or when socket check is inconclusive), `hc server status --json`
    // is explicitly read-only and never starts a core.
    if (!running && platform === "win32") {
      try {
        const statusRes = await runCommand(
          binaryPath,
          ["server", "status", "--json"],
          {
            env: env,
            timeoutMs: VERSION_TIMEOUT_MS,
          },
        );
        const parsed = JSON.parse(statusRes.stdout) as {
          readonly pid?: unknown;
        };
        if (typeof parsed.pid === "number" && parsed.pid > 0) {
          running = true;
        }
      } catch {
        running = false;
      }
    }
  }

  return {
    installed: Boolean(binaryPath) || running,
    running,
    binaryPath,
    socketPath,
    session,
    platform,
    sharedCore: true,
    version,
    installHint: herdrCoreInstallHint(platform),
  };
}

/**
 * Starts the user's shared `herdr-core` server ONLY on explicit user action.
 * If a running core is already detected, reuses it immediately without restart.
 */
export async function startHerdrCoreServer(
  deps: HerdrCoreDetectorDeps = {},
): Promise<HerdrCoreStartServerResult> {
  const before = await detectHerdrCore(deps);
  if (before.running) {
    return { ok: true, detection: before };
  }
  if (!before.binaryPath) {
    return {
      ok: false,
      detection: before,
      error: before.installHint,
    };
  }

  const runCommand = deps.runCommand ?? defaultRunCommand;
  const env = deps.env ?? process.env;
  try {
    await runCommand(before.binaryPath, ["server", "start"], {
      env: env,
      timeoutMs: START_TIMEOUT_MS,
    });
  } catch (error) {
    const afterFailure = await detectHerdrCore(deps);
    if (afterFailure.running) {
      return { ok: true, detection: afterFailure };
    }
    return {
      ok: false,
      detection: afterFailure,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const after = await detectHerdrCore(deps);
  return {
    ok: after.running,
    detection: after,
    ...(after.running
      ? {}
      : {
          error: "herdr-core server started but its socket is not ready yet.",
        }),
  };
}
