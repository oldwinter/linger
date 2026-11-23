// `pnpm dev:windows` starts the host development stack on Windows. The POSIX
// `dev:*` scripts call `sh -c` and `make`, and a plain Windows checkout has
// neither, so this launcher runs the same steps with Node only: migrate the
// database, create the local owner, start TeamHub and Node Services, wait for
// TeamHub to answer, then start Web, and LiveKit the way `dev:livekit` does.
//
// Every step runs through scripts/with-local-env.mjs, so the environment a
// service sees is the one `pnpm dev` gives it: scripts/local-defaults.env, then
// .env, then the shell. This launcher resolves its own settings through the
// same `localEnvironment`, and the wrapper is also what makes `pnpm` runnable
// from here, because Windows ships it as a .cmd shim.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { localEnvironment } from "./with-local-env.mjs";

const fallbackRoot = fileURLToPath(new URL("../", import.meta.url));

export interface DevelopmentStep {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface DevelopmentPlan {
  baseUrl: string;
  migrate: DevelopmentStep;
  owner: DevelopmentStep;
  teamHub: DevelopmentStep;
  nodeServices: DevelopmentStep;
  web: DevelopmentStep;
  livekit: DevelopmentStep;
}

export function isWindowsPlatform(
  platform: string = process.platform,
): boolean {
  return platform === "win32";
}

// Probe only a single TCP endpoint. The migration handles libpq connection
// strings with multiple hosts, socket paths, or endpoint overrides.
export function parsePostgresAddress(
  url: string | undefined,
): { host: string; port: number } | undefined {
  const parsed = URL.parse(url ?? "");
  if (
    !parsed ||
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    /[,%\\]/.test(parsed.hostname) ||
    ["host", "hostaddr", "port", "service"].some((key) =>
      parsed.searchParams.has(key),
    )
  )
    return undefined;
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ""),
    port: Number(parsed.port || 5432),
  };
}

// A refused connection is the first failure most Windows checkouts hit, and the
// note it needs is the one that costs a day to find: PostgreSQL under a
// non-ASCII path fails inside initdb with `invalid byte sequence for encoding
// "UTF8": 0xbc`.
export function databaseUnavailableMessage(
  url: string | undefined,
  cause: string = "ECONNREFUSED",
): string {
  const address = parsePostgresAddress(url);
  const host = address?.host.includes(":")
    ? `[${address.host}]`
    : address?.host;
  const target = address ? `${host}:${address.port}` : "the configured host";
  return [
    `Cannot reach PostgreSQL at ${target} (${cause}).`,
    "Start a PostgreSQL 17 server with the vector extension first:",
    "  - Docker: docker compose up --detach --wait postgres",
    "  - Native: docs/local-postgresql.md, Option E (Windows)",
    "Install PostgreSQL and its data directory under a path with ASCII",
    "characters only. Under a non-ASCII path initdb fails with",
    '`invalid byte sequence for encoding "UTF8": 0xbc`.',
  ].join("\n");
}

export function windowsDevelopmentPlan(
  root: string,
  baseUrl: string,
): DevelopmentPlan {
  const node = process.execPath;
  const wrapper = path.join(root, "scripts", "with-local-env.mjs");
  const teamHub = path.join(root, "apps", "teamhub");
  const wrap = (...args: string[]): string[] => [wrapper, "--", ...args];
  return {
    baseUrl,
    migrate: {
      command: node,
      args: wrap("go", "run", "./cmd/migrate"),
      cwd: teamHub,
    },
    owner: {
      command: node,
      args: wrap(node, "scripts/prepare-local-owner.mjs"),
      cwd: root,
    },
    teamHub: {
      command: node,
      args: wrap("go", "run", "./cmd/teamhub"),
      cwd: teamHub,
      env: { GIN_MODE: "release" },
    },
    nodeServices: {
      command: node,
      args: wrap("pnpm", "--filter", "@linger/node-services", "start"),
      cwd: root,
    },
    web: {
      command: node,
      args: wrap("pnpm", "--filter", "@linger/web", "dev"),
      cwd: root,
    },
    livekit: {
      command: node,
      args: wrap(node, "--import", "tsx", "scripts/dev-livekit.ts"),
      cwd: root,
    },
  };
}

export function computerReleaseNote(
  root: string,
  configured: string | undefined,
): string {
  // Match computerReleaseRoot in Node Services. The local default comes
  // from scripts/local-defaults.env through localEnvironment.
  const directory = path.resolve(
    root,
    configured?.trim() || "/app/computer-release",
  );
  return existsSync(path.join(directory, "release.json"))
    ? `Computer installers are served from ${directory}.`
    : [
        `No Computer release in ${directory}. Connect computer will return 503.`,
        "Run `pnpm computer:release:windows` to build a release in",
        ".linger-runtime/computer-release. Make it available in the configured",
        "directory, then restart `pnpm dev:windows`.",
      ].join("\n");
}

// The first visit lands on /login because no session cookie exists yet, and
// that page labels the empty session "Your session has expired". Printing the
// credentials and that caveat once keeps the wording from reading as a broken
// Windows stack.
export function signInGuidance(
  root: string,
  baseUrl: string = "http://localhost:3000",
): string {
  const credentials = path.join(".linger-runtime", "local-owner.json");
  let email: string | undefined;
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(root, credentials), "utf8"),
    ) as { owner_email?: unknown };
    if (typeof parsed.owner_email === "string") email = parsed.owner_email;
  } catch {
    // The owner step runs before this message, so only a broken checkout
    // reaches here; the generic line below still says where to start.
  }
  return [
    `Open ${baseUrl} and sign in${email ? ` as ${email}` : ""}.`,
    `Credentials: ${credentials} (owner_password in that file).`,
    'A first visit without a session shows "Your session has expired": that is the sign-in page, not a failure.',
  ].join("\n");
}

export function stopProcess(
  child: Pick<ChildProcess, "pid" | "exitCode"> | undefined,
  platform: string = process.platform,
): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (platform === "win32")
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  else child.kill("SIGTERM");
}

export type DatabaseCheck = (
  url: string | undefined,
) => Promise<{ ok: boolean; cause?: string }>;

export async function databaseReachable(
  url: string | undefined,
  timeoutMs: number = 5000,
): Promise<{ ok: boolean; cause?: string }> {
  const address = parsePostgresAddress(url);
  if (!address) return { ok: true };
  return new Promise((resolve) => {
    const socket = connect({ host: address.host, port: address.port });
    const done = (ok: boolean, cause?: string) => {
      socket.destroy();
      resolve(cause === undefined ? { ok } : { ok, cause });
    };
    socket.setTimeout(timeoutMs, () => done(false, "ETIMEDOUT"));
    socket.once("connect", () => done(true));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      done(false, error.code ?? "connection error"),
    );
  });
}

function startStep(
  step: DevelopmentStep,
  environment: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(step.command, step.args, {
    cwd: step.cwd,
    env: { ...environment, ...step.env },
    stdio: "inherit",
    windowsHide: true,
  });
}

function runStep(
  step: DevelopmentStep,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = startStep(step, environment);
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${path.basename(step.command)} ${step.args.slice(2).join(" ")} exited with ${signal ?? code}`,
            ),
          ),
    );
  });
}

async function waitForHealth(
  url: string,
  timeoutMs: number = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // TeamHub still compiles on the first run, so a refused connection here
      // is expected rather than fatal.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${url}.`);
}

export interface LaunchOptions {
  platform?: string;
  root?: string;
  log?: (message: string) => void;
  checkDatabase?: DatabaseCheck;
}

export async function runWindowsDevelopment(
  options: LaunchOptions = {},
): Promise<number> {
  const platform = options.platform ?? process.platform;
  const root = options.root ?? fallbackRoot;
  const log = options.log ?? console.log;
  if (!isWindowsPlatform(platform))
    throw new Error(
      "dev:windows targets Windows; run `pnpm dev` on macOS and Linux.",
    );

  // The same layered resolution the wrapper applies to every step, so the
  // URLs this launcher prints and probes are the ones the services start
  // with. A missing .env fails here with the wrapper's message.
  const environment = localEnvironment(root);
  const baseUrl = environment.TEAMHUB_BASE_URL ?? "http://127.0.0.1:8080";
  const databaseUrl = environment.TEAMHUB_DATABASE_URL;
  const check = options.checkDatabase ?? databaseReachable;
  const database = await check(databaseUrl);
  if (!database.ok)
    throw new Error(databaseUnavailableMessage(databaseUrl, database.cause));

  const plan = windowsDevelopmentPlan(root, baseUrl);
  log(computerReleaseNote(root, environment.COMPUTER_RELEASE_DIR));
  log("Migrating the database ...");
  await runStep(plan.migrate, environment);
  log("Creating the local owner ...");
  await runStep(plan.owner, environment);

  return new Promise((resolve) => {
    let settled = false;
    const children: ChildProcess[] = [];
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      for (const child of children) stopProcess(child, platform);
      resolve(code);
    };
    const background = (step: DevelopmentStep): ChildProcess => {
      const child = startStep(step, environment);
      children.push(child);
      // Every background step is watched from its first moment, Web included,
      // so a Vite crash stops the stack instead of leaving TeamHub and Node
      // Services running with no front end.
      child.once("exit", (code) => {
        if (code) finish(code);
        else if (children.every((item) => item.exitCode !== null)) finish(0);
      });
      return child;
    };

    background(plan.teamHub);
    background(plan.nodeServices);
    // LiveKit exits early when LIVEKIT_URL names another server, so a clean
    // exit there must not stop the stack; only a failure does that, as
    // concurrently's --kill-others-on-fail does for `pnpm dev`.
    background(plan.livekit);

    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => finish(0));

    waitForHealth(`${baseUrl.replace(/\/$/, "")}/healthz`)
      .then(() => {
        log("Web waits for TeamHub; starting Web ...");
        background(plan.web);
        log(signInGuidance(root));
      })
      .catch((error: Error) => {
        console.error(error.message);
        finish(1);
      });
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runWindowsDevelopment()
    .then((code) => process.exit(code))
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(1);
    });
