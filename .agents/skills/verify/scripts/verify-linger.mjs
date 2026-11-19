#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, openSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../..");
const RESERVED_PORTS = new Set([3000, 4319, 4321, 5432, 8080, 17880, 54339]);
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

function printUsage() {
  process.stdout.write(
    [
      "Usage: verify-linger.mjs <command> [options]",
      "",
      "Commands:",
      "  up [--run-id <id>] [--evidence-dir <dir>] [--live-provider]",
      "      Start an isolated Linger stack (PostgreSQL, TeamHub, Node Services, Web, Local Computer)",
      "      and wait until Another Me is provisioned and the UI gate is cleared.",
      "  doctor --run-id <id>",
      "      Run read-only checks on PIDs, port ownership, HTTP probes, owner login, Another Me, and Gateway.",
      "  sign-in --run-id <id> [--return-to <path>]",
      "      Sign into the isolated Web UI through /login inside the run's agent-browser session.",
      "  browser --run-id <id> -- <agent-browser args...>",
      "      Run agent-browser scoped to this run's --session.",
      "  api --run-id <id> GET <path>",
      "      Run a strictly read-only GET request against TeamHub as the run's owner.",
      "  sql --run-id <id> <query>",
      "      Run a read-only PostgreSQL query against the run's database.",
      "  computer --run-id <id> -- <linger-computer args...>",
      "      Run linger-computer scoped to this run's isolated config.",
      "  down --run-id <id>",
      "      Tear down all processes and scratch state for --run-id while preserving --evidence-dir.",
      "",
    ].join("\n"),
  );
}

function fail(message, code = 1) {
  process.stderr.write(`verify-linger: ${message}\n`);
  process.exit(code);
}

function defaultRunId() {
  return `v-${Date.now().toString(36)}-${process.pid}`;
}

function resolveRunDir(runId) {
  if (!RUN_ID_PATTERN.test(runId)) {
    fail(
      `Invalid --run-id "${runId}". Use 2-40 lowercase alphanumeric characters or hyphens.`,
      2,
    );
  }
  return path.join(os.tmpdir(), `linger-verify-${runId}`);
}

function stateFilePath(runDir) {
  return path.join(runDir, "state.json");
}

function parseRunOptions(argv) {
  const flags = {};
  const positional = [];
  let passthrough = [];
  const dashIndex = argv.indexOf("--");
  const head = dashIndex === -1 ? argv : argv.slice(0, dashIndex);
  if (dashIndex !== -1) {
    passthrough = argv.slice(dashIndex + 1);
  }
  for (let index = 0; index < head.length; index += 1) {
    const token = head[index];
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }
    if (token === "--live-provider") {
      flags.liveProvider = true;
      continue;
    }
    if (
      token === "--run-id" ||
      token === "--evidence-dir" ||
      token === "--return-to"
    ) {
      const value = head[index + 1];
      if (!value || value.startsWith("--")) {
        fail(`${token} requires a value`, 2);
      }
      flags[token.slice(2)] = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      fail(`Unknown option: ${token}`, 2);
    }
    positional.push(token);
  }
  return { flags, positional, passthrough };
}

async function allocateDistinctPorts(count) {
  const servers = [];
  const ports = [];
  try {
    while (ports.length < count) {
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      if (port > 0 && !RESERVED_PORTS.has(port) && !ports.includes(port)) {
        servers.push(server);
        ports.push(port);
      } else {
        await new Promise((resolve) => server.close(() => resolve()));
      }
    }
    return ports;
  } finally {
    await Promise.all(
      servers.map(
        (server) => new Promise((resolve) => server.close(() => resolve())),
      ),
    );
  }
}

function commandExists(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0;
}

function hasPgVectorControl(binDir) {
  const rootDir = path.dirname(binDir);
  return (
    existsSync(path.join(rootDir, "share/extension/vector.control")) ||
    existsSync(path.join(rootDir, "share/postgresql/extension/vector.control"))
  );
}

function isPostgres17WithVector(binDir) {
  const requiredBins = [
    "postgres",
    "initdb",
    "pg_ctl",
    "createdb",
    "psql",
    "pg_isready",
  ];
  if (!requiredBins.every((name) => existsSync(path.join(binDir, name)))) {
    return false;
  }
  if (!hasPgVectorControl(binDir)) {
    return false;
  }
  const version = spawnSync(path.join(binDir, "postgres"), ["--version"], {
    encoding: "utf8",
  });
  return (
    version.status === 0 &&
    /\bPostgreSQL\)\s+17(?:\.|\s|$)/.test(version.stdout ?? "")
  );
}

async function discoverNativePostgresBin() {
  const candidates = [];
  if (process.env.LINGER_VERIFY_PG_BIN?.trim()) {
    candidates.push(process.env.LINGER_VERIFY_PG_BIN.trim());
  }
  const simplexComponentsDir = path.join(
    os.homedir(),
    ".simplexai/tools/native/components",
  );
  if (existsSync(simplexComponentsDir)) {
    for (const entry of await readdir(simplexComponentsDir)) {
      candidates.push(path.join(simplexComponentsDir, entry, "bin"));
    }
  }
  candidates.push(
    "/opt/homebrew/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@17/bin",
    "/usr/lib/postgresql/17/bin",
  );
  const pathPostgres = spawnSync("which", ["postgres"], { encoding: "utf8" });
  if (pathPostgres.status === 0 && pathPostgres.stdout.trim()) {
    candidates.push(path.dirname(pathPostgres.stdout.trim()));
  }
  for (const candidate of candidates) {
    if (isPostgres17WithVector(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function dockerDaemonReachable() {
  const result = spawnSync("docker", ["info"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0;
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `${command} ${args.join(" ")} exited with ${String(result.status)}${details ? `:\n${details}` : ""}`,
    );
  }
  return result;
}

function spawnDetached(command, args, { cwd, env, logFile }) {
  const fd = openSync(logFile, "a", 0o600);
  try {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    if (!child.pid) {
      throw new Error(`Failed to spawn ${command}`);
    }
    child.unref();
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processCommandLine(pid) {
  if (!isPidAlive(pid)) {
    return undefined;
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim();
}

function portListenerPids(port) {
  if (commandExists("lsof")) {
    const result = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    );
    if (result.status !== 0 && !result.stdout.trim()) {
      return [];
    }
    return result.stdout
      .split(/\s+/)
      .map((item) => Number(item))
      .filter((value) => Number.isInteger(value) && value > 0);
  }
  if (commandExists("ss")) {
    const result = spawnSync("ss", ["-ltnp", `sport = :${port}`], {
      encoding: "utf8",
    });
    const matches = [...(result.stdout ?? "").matchAll(/pid=(\d+)/g)];
    return matches.map((match) => Number(match[1]));
  }
  return [];
}

async function waitForHttp(url, timeoutMs, pidToWatch, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not yet attempted";
  while (Date.now() < deadline) {
    if (pidToWatch !== undefined && !isPidAlive(pidToWatch)) {
      throw new Error(`${label} (pid ${pidToWatch}) exited before ready`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label} at ${url} (${lastError})`);
}

async function waitForPostgresReady(pgBin, port, password, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const env = { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: "3" };
  while (Date.now() < deadline) {
    const result = spawnSync(
      path.join(pgBin, "pg_isready"),
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--username",
        "simplexai",
        "--dbname",
        "postgres",
      ],
      { env, encoding: "utf8" },
    );
    if (result.status === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Native PostgreSQL on 127.0.0.1:${port} did not become ready`,
  );
}

function buildComputerCliEnv(state, liveProvider) {
  const env = { ...process.env };
  delete env.HERDR_SOCKET_PATH;
  delete env.CODEX_HOME;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.PI_CODING_AGENT_DIR;
  delete env.TEAMHUB_CONFIG;
  delete env.TEAMHUB_PROFILE;
  delete env.TEAMHUB_TOKEN;
  delete env.TEAMHUB_TOKEN_FILE;
  delete env.LINGER_CODEX_PATH;
  delete env.LINGER_CLAUDE_PATH;
  delete env.LINGER_PI_PATH;
  if (!liveProvider) {
    env.HOME = path.join(state.run_dir, "computer-home");
    env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  }
  return env;
}

function runComputerCli(state, args, options = {}) {
  return spawnSync(
    state.paths.computerCli,
    [...args, "--config", state.paths.computerConfig],
    {
      encoding: "utf8",
      env: buildComputerCliEnv(state, state.provider_mode === "live"),
      ...options,
    },
  );
}

async function loginAsOwner(state) {
  const owner = JSON.parse(await readFile(state.paths.ownerFile, "utf8"));
  const response = await fetch(`${state.teamhub_url}/v0/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: owner.owner_email,
      password: owner.owner_password,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Owner login failed with HTTP ${response.status}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    throw new Error("Owner login returned no session cookie");
  }
  return { cookie, payload: await response.json() };
}

async function logoutOwner(state, cookie) {
  await fetch(`${state.teamhub_url}/v0/auth/logout`, {
    method: "POST",
    headers: { cookie },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

async function writePrivate(filePath, content, mode = 0o600) {
  await writeFile(filePath, content, { mode });
  await chmod(filePath, mode);
}

async function saveState(state) {
  await writePrivate(
    stateFilePath(state.run_dir),
    `${JSON.stringify(state, null, 2)}\n`,
    0o600,
  );
}

async function loadState(runId) {
  const runDir = resolveRunDir(runId);
  const filePath = stateFilePath(runDir);
  if (!existsSync(filePath)) {
    fail(
      `No verification run found for --run-id "${runId}" (${filePath} does not exist).`,
    );
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function stopOwnedPid(pid, expectedMarkers) {
  if (!pid || !isPidAlive(pid)) {
    return;
  }
  const cmdline = processCommandLine(pid) ?? "";
  const matches = expectedMarkers.some((marker) => cmdline.includes(marker));
  if (!matches) {
    return;
  }
  const signalTarget = (sig) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // Process already exited.
      }
    }
  };
  signalTarget("SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isPidAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isPidAlive(pid)) {
    signalTarget("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function unlockTree(dirPath) {
  if (!existsSync(dirPath)) {
    return;
  }
  const info = await lstat(dirPath);
  if (info.isSymbolicLink()) {
    return;
  }
  if (info.isDirectory()) {
    chmodSync(dirPath, 0o700);
    for (const entry of await readdir(dirPath)) {
      await unlockTree(path.join(dirPath, entry));
    }
    return;
  }
  chmodSync(dirPath, 0o600);
}

async function teardownRun(state) {
  if (state.browser_session && commandExists("agent-browser")) {
    spawnSync("agent-browser", ["--session", state.browser_session, "close"], {
      encoding: "utf8",
      timeout: 5_000,
    });
  }
  if (
    state.paths?.computerCli &&
    existsSync(state.paths.computerCli) &&
    state.paths?.computerConfig &&
    existsSync(state.paths.computerConfig)
  ) {
    runComputerCli(state, ["daemon", "stop"], { timeout: 10_000 });
  }
  await stopOwnedPid(state.pids?.computerDaemon, [
    state.run_dir,
    "linger-computer-daemon",
  ]);
  await stopOwnedPid(state.pids?.web, ["vite.js", String(state.ports?.web)]);
  await stopOwnedPid(state.pids?.nodeServices, [
    "apps/node-services/src/main.ts",
    REPO_ROOT,
  ]);
  await stopOwnedPid(state.pids?.teamhub, [state.run_dir, "bin/teamhub"]);

  if (state.db_mode === "native" && state.paths?.pgBin && state.paths?.pgData) {
    const pgCtl = path.join(state.paths.pgBin, "pg_ctl");
    if (existsSync(pgCtl) && existsSync(state.paths.pgData)) {
      spawnSync(pgCtl, ["-D", state.paths.pgData, "-m", "fast", "stop"], {
        encoding: "utf8",
        timeout: 10_000,
      });
    }
    await stopOwnedPid(state.pids?.postgres, [state.paths.pgData, "postgres"]);
  } else if (state.db_mode === "docker" && state.docker?.projectName) {
    const composeFile = path.join(
      REPO_ROOT,
      "apps/teamhub/deployments/compose/docker-compose.test.yml",
    );
    const env = {
      ...process.env,
      TEAMHUB_TEST_CONTAINER_NAME: state.docker.containerName,
      TEAMHUB_TEST_NETWORK_NAME: state.docker.networkName,
      TEAMHUB_TEST_POSTGRES_PORT: String(state.ports.postgres),
      TEAMHUB_TEST_RUN_TOKEN: state.docker.runToken,
    };
    const tokenInspect = spawnSync(
      "docker",
      [
        "container",
        "inspect",
        "--format",
        '{{ index .Config.Labels "com.linger.teamhub.test-run-token" }}',
        state.docker.containerName,
      ],
      { encoding: "utf8" },
    );
    if (
      tokenInspect.status !== 0 ||
      tokenInspect.stdout.trim() === state.docker.runToken
    ) {
      spawnSync(
        "docker",
        [
          "compose",
          "--project-name",
          state.docker.projectName,
          "--file",
          composeFile,
          "down",
          "--volumes",
        ],
        { env, encoding: "utf8", timeout: 20_000 },
      );
    }
  }

  if (state.run_dir && existsSync(state.run_dir)) {
    await unlockTree(state.run_dir);
    await rm(state.run_dir, { recursive: true, force: true });
  }
}

async function dumpLogsTail(runDir) {
  const logsDir = path.join(runDir, "logs");
  if (!existsSync(logsDir)) {
    return;
  }
  for (const name of (await readdir(logsDir)).sort()) {
    const fullPath = path.join(logsDir, name);
    const text = await readFile(fullPath, "utf8").catch(() => "");
    if (!text.trim()) {
      continue;
    }
    const tail = text.split("\n").slice(-60).join("\n");
    process.stderr.write(`\n--- ${name} (tail) ---\n${tail}\n`);
  }
}

async function cmdUp(flags) {
  if (process.getuid?.() === 0) {
    fail("Do not run as root; PostgreSQL refuses to run as UID 0.", 2);
  }
  for (const cmd of ["go", "node", "agent-browser"]) {
    if (!commandExists(cmd)) {
      fail(`Required executable not found on PATH: ${cmd}`, 2);
    }
  }
  const viteBin = path.join(
    REPO_ROOT,
    "apps/web/node_modules/vite/bin/vite.js",
  );
  const tsxLoader = path.join(REPO_ROOT, "node_modules/tsx/dist/loader.mjs");
  if (!existsSync(viteBin) || !existsSync(tsxLoader)) {
    fail(
      "Workspace node_modules are missing. Run `pnpm install --frozen-lockfile --prefer-offline` first.",
      2,
    );
  }

  const runId = flags["run-id"] ?? defaultRunId();
  const runDir = resolveRunDir(runId);
  if (existsSync(runDir)) {
    fail(
      `Scratch directory already exists at ${runDir}. Choose another --run-id or run \`down --run-id ${runId}\`.`,
      2,
    );
  }
  const evidenceDir = path.resolve(
    flags["evidence-dir"] ??
      path.join(os.tmpdir(), `linger-verify-evidence-${runId}`),
  );
  if (
    evidenceDir === runDir ||
    evidenceDir.startsWith(`${runDir}${path.sep}`)
  ) {
    fail(
      `--evidence-dir (${evidenceDir}) must sit outside scratch run_dir (${runDir}) so cleanup never removes proof artifacts.`,
      2,
    );
  }

  const liveProvider = Boolean(flags.liveProvider);
  const pgBin = await discoverNativePostgresBin();
  const dbMode = pgBin ? "native" : dockerDaemonReachable() ? "docker" : null;
  if (!dbMode) {
    fail(
      "Neither native PostgreSQL 17 with pgvector nor a running Docker daemon was found.",
      2,
    );
  }

  const [pgPort, teamhubPort, nodeServicesPort, documentRuntimePort, webPort] =
    await allocateDistinctPorts(5);
  const browserSession = `linger-verify-${runId}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const teamhubUrl = `http://127.0.0.1:${teamhubPort}`;
  const nodeServicesUrl = `http://127.0.0.1:${nodeServicesPort}`;
  const documentRuntimeUrl = `http://127.0.0.1:${documentRuntimePort}`;

  const state = {
    run_id: runId,
    run_dir: runDir,
    evidence_dir: evidenceDir,
    browser_session: browserSession,
    provider_mode: liveProvider ? "live" : "fixture",
    db_mode: dbMode,
    ports: {
      postgres: pgPort,
      teamhub: teamhubPort,
      nodeServices: nodeServicesPort,
      documentRuntime: documentRuntimePort,
      web: webPort,
    },
    web_url: webUrl,
    teamhub_url: teamhubUrl,
    node_services_url: nodeServicesUrl,
    document_runtime_url: documentRuntimeUrl,
    pids: {},
    paths: {
      pgBin,
      pgData: path.join(runDir, "pgdata"),
      ownerFile: path.join(runDir, "local-owner.json"),
      teamhubBin: path.join(runDir, "bin/teamhub"),
      computerBundle: path.join(runDir, "computer-bundle"),
      computerCli: path.join(runDir, "computer-bundle/cli/linger-computer"),
      computerDaemon: path.join(
        runDir,
        "computer-bundle/daemon/linger-computer-daemon",
      ),
      computerConfig: path.join(runDir, "computer/config.json"),
      computerStateDir: path.join(runDir, "computer/state"),
      verifyEnv: path.join(runDir, "verify.env"),
    },
  };

  await mkdir(runDir, { recursive: true, mode: 0o700 });
  await chmod(runDir, 0o700);
  await mkdir(evidenceDir, { recursive: true });
  for (const sub of [
    "logs",
    "bin",
    "agent-home",
    "computer-release",
    "teamhub-artifacts",
    "computer",
    "computer/state",
    "computer-home",
    "workspace",
    "codex-home",
  ]) {
    await mkdir(path.join(runDir, sub), { recursive: true, mode: 0o700 });
  }
  await saveState(state);

  try {
    let databaseUrl;
    if (dbMode === "native") {
      const pgPassword = randomBytes(16).toString("hex");
      const pwFile = path.join(runDir, "pg-password");
      await writePrivate(pwFile, `${pgPassword}\n`, 0o600);
      runChecked(path.join(pgBin, "initdb"), [
        "--pgdata",
        state.paths.pgData,
        "--username",
        "simplexai",
        "--pwfile",
        pwFile,
        "--auth-host",
        "scram-sha-256",
        "--auth-local",
        "scram-sha-256",
        "--encoding",
        "UTF8",
        "--no-locale",
      ]);
      const pgEnv = {
        ...process.env,
        PGPASSWORD: pgPassword,
        PGCONNECT_TIMEOUT: "3",
      };
      runChecked(
        path.join(pgBin, "pg_ctl"),
        [
          "-D",
          state.paths.pgData,
          "-l",
          path.join(runDir, "logs/postgres.log"),
          "-o",
          `-h 127.0.0.1 -p ${pgPort} -k '' -c max_connections=100 -c shared_buffers=128MB -c jit=off`,
          "start",
        ],
        { env: pgEnv },
      );
      const pidText = await readFile(
        path.join(state.paths.pgData, "postmaster.pid"),
        "utf8",
      );
      state.pids.postgres = Number(pidText.split("\n")[0].trim());
      await saveState(state);
      await waitForPostgresReady(pgBin, pgPort, pgPassword, 30_000);
      runChecked(
        path.join(pgBin, "createdb"),
        [
          "--host",
          "127.0.0.1",
          "--port",
          String(pgPort),
          "--username",
          "simplexai",
          "simplexai_verify",
        ],
        { env: pgEnv },
      );
      databaseUrl = `postgres://simplexai:${pgPassword}@127.0.0.1:${pgPort}/simplexai_verify?sslmode=disable`;
      state.database = {
        url: databaseUrl,
        host: "127.0.0.1",
        port: pgPort,
        user: "simplexai",
        password: pgPassword,
        dbname: "simplexai_verify",
      };
    } else {
      const composeFile = path.join(
        REPO_ROOT,
        "apps/teamhub/deployments/compose/docker-compose.test.yml",
      );
      const projectName = `linger-verify-${runId}`;
      const containerName = `${projectName}-postgres`;
      const networkName = `${projectName}-network`;
      state.docker = {
        projectName,
        containerName,
        networkName,
        runToken: projectName,
      };
      await saveState(state);
      runChecked(
        "docker",
        [
          "compose",
          "--project-name",
          projectName,
          "--file",
          composeFile,
          "up",
          "-d",
          "--wait",
          "postgres",
        ],
        {
          env: {
            ...process.env,
            TEAMHUB_TEST_CONTAINER_NAME: containerName,
            TEAMHUB_TEST_NETWORK_NAME: networkName,
            TEAMHUB_TEST_POSTGRES_PORT: String(pgPort),
            TEAMHUB_TEST_RUN_TOKEN: projectName,
          },
        },
      );
      databaseUrl = `postgres://teamhub:teamhub@127.0.0.1:${pgPort}/teamhub_test_control?sslmode=disable`;
      state.database = {
        url: databaseUrl,
        host: "127.0.0.1",
        port: pgPort,
        user: "teamhub",
        password: "teamhub",
        dbname: "teamhub_test_control",
      };
    }
    await saveState(state);

    const secretSeed = randomBytes(32).toString("hex");
    const encryptionKey = randomBytes(32).toString("base64");
    const ownerEmail = "owner@linger.local";
    const ownerPassword = randomBytes(12).toString("hex");
    await writePrivate(
      state.paths.ownerFile,
      `${JSON.stringify({ owner_email: ownerEmail, owner_password: ownerPassword }, null, 2)}\n`,
      0o600,
    );
    state.owner_email = ownerEmail;

    const serviceEnv = {
      ...process.env,
      LOCAL_ENV_FILE: state.paths.verifyEnv,
      TEAMHUB_DATABASE_URL: databaseUrl,
      WEB_PUBLIC_ORIGIN: webUrl,
      LINGER_SECRET_SEED: secretSeed,
      TEAMHUB_SECRET_ENCRYPTION_KEY: encryptionKey,
      TEAMHUB_TRUSTED_PROXIES: "127.0.0.1/32,::1/128",
      TEAMHUB_BASE_URL: teamhubUrl,
      TEAMHUB_HTTP_ADDRESS: `127.0.0.1:${teamhubPort}`,
      TEAMHUB_NODE_SERVICES_URL: nodeServicesUrl,
      NODE_SERVICES_HTTP_ADDRESS: `127.0.0.1:${nodeServicesPort}`,
      TEAMHUB_DOCUMENT_RUNTIME_URL: documentRuntimeUrl,
      DOCUMENT_RUNTIME_HTTP_ADDRESS: `127.0.0.1:${documentRuntimePort}`,
      TEAMHUB_DOCUMENT_PREVIEW_PUBLIC_ORIGIN: teamhubUrl,
      AGENT_RUNNER_PUBLIC_GATEWAY_URL: `ws://127.0.0.1:${nodeServicesPort}/v1/runner-gateway`,
      AGENT_HOME: path.join(runDir, "agent-home"),
      COMPUTER_RELEASE_DIR: path.join(runDir, "computer-release"),
      TEAMHUB_ARTIFACT_STORAGE_ROOT: path.join(runDir, "teamhub-artifacts"),
      TEAMHUB_VOICE_MEDIA: "off",
      TEAMHUB_PERMISSION_REVIEW: "false",
      NODE_SERVICES_ROLES: "memory,llm-wiki,agent,document",
      PORT: String(webPort),
      WEB_ALLOWED_DEV_HOSTS: "127.0.0.1,localhost",
    };

    const envLines = [
      `TEAMHUB_DATABASE_URL=${databaseUrl}`,
      `WEB_PUBLIC_ORIGIN=${webUrl}`,
      `LINGER_SECRET_SEED=${secretSeed}`,
      `TEAMHUB_SECRET_ENCRYPTION_KEY=${encryptionKey}`,
      `TEAMHUB_TRUSTED_PROXIES=127.0.0.1/32,::1/128`,
      `TEAMHUB_BASE_URL=${teamhubUrl}`,
      `TEAMHUB_HTTP_ADDRESS=127.0.0.1:${teamhubPort}`,
      `TEAMHUB_NODE_SERVICES_URL=${nodeServicesUrl}`,
      `NODE_SERVICES_HTTP_ADDRESS=127.0.0.1:${nodeServicesPort}`,
      `TEAMHUB_DOCUMENT_RUNTIME_URL=${documentRuntimeUrl}`,
      `DOCUMENT_RUNTIME_HTTP_ADDRESS=127.0.0.1:${documentRuntimePort}`,
      `TEAMHUB_DOCUMENT_PREVIEW_PUBLIC_ORIGIN=${teamhubUrl}`,
      `AGENT_RUNNER_PUBLIC_GATEWAY_URL=ws://127.0.0.1:${nodeServicesPort}/v1/runner-gateway`,
      `AGENT_HOME=${path.join(runDir, "agent-home")}`,
      `COMPUTER_RELEASE_DIR=${path.join(runDir, "computer-release")}`,
      `TEAMHUB_ARTIFACT_STORAGE_ROOT=${path.join(runDir, "teamhub-artifacts")}`,
      `TEAMHUB_VOICE_MEDIA=off`,
      `TEAMHUB_PERMISSION_REVIEW=false`,
      `NODE_SERVICES_ROLES=memory,llm-wiki,agent,document`,
      `PORT=${webPort}`,
      `WEB_ALLOWED_DEV_HOSTS=127.0.0.1,localhost`,
    ];
    await writePrivate(
      state.paths.verifyEnv,
      `${envLines.join("\n")}\n`,
      0o600,
    );

    const teamhubDir = path.join(REPO_ROOT, "apps/teamhub");
    runChecked("go", ["run", "./cmd/migrate"], {
      cwd: teamhubDir,
      env: serviceEnv,
    });
    runChecked(
      "go",
      [
        "run",
        "./cmd/account",
        "create-owner",
        "--email",
        ownerEmail,
        "--password-stdin",
      ],
      {
        cwd: teamhubDir,
        env: serviceEnv,
        input: `${ownerPassword}\n`,
      },
    );
    runChecked("go", ["build", "-o", state.paths.teamhubBin, "./cmd/teamhub"], {
      cwd: teamhubDir,
      env: serviceEnv,
    });

    state.pids.teamhub = spawnDetached(state.paths.teamhubBin, [], {
      cwd: teamhubDir,
      env: { ...serviceEnv, GIN_MODE: "release" },
      logFile: path.join(runDir, "logs/teamhub.log"),
    });
    await saveState(state);
    await waitForHttp(
      `${teamhubUrl}/healthz`,
      90_000,
      state.pids.teamhub,
      "TeamHub",
    );

    state.pids.nodeServices = spawnDetached(
      process.execPath,
      [
        "--import",
        tsxLoader,
        path.join(REPO_ROOT, "apps/node-services/src/main.ts"),
      ],
      {
        cwd: REPO_ROOT,
        env: serviceEnv,
        logFile: path.join(runDir, "logs/node-services.log"),
      },
    );
    await saveState(state);
    await waitForHttp(
      `${nodeServicesUrl}/readyz`,
      60_000,
      state.pids.nodeServices,
      "Node Services",
    );
    await waitForHttp(
      `${documentRuntimeUrl}/readyz`,
      60_000,
      state.pids.nodeServices,
      "Document Runtime",
    );

    state.pids.web = spawnDetached(
      process.execPath,
      [
        viteBin,
        "--host",
        "127.0.0.1",
        "--port",
        String(webPort),
        "--strictPort",
      ],
      {
        cwd: path.join(REPO_ROOT, "apps/web"),
        env: serviceEnv,
        logFile: path.join(runDir, "logs/web.log"),
      },
    );
    await saveState(state);
    await waitForHttp(`${webUrl}/healthz`, 60_000, state.pids.web, "Web");

    const cliOutDir = path.join(state.paths.computerBundle, "cli");
    const daemonOutDir = path.join(state.paths.computerBundle, "daemon");
    const runtimeBinDir = path.join(state.paths.computerBundle, "runtime/bin");
    await mkdir(cliOutDir, { recursive: true });
    await mkdir(daemonOutDir, { recursive: true });
    await mkdir(runtimeBinDir, { recursive: true });

    runChecked(
      process.execPath,
      [
        path.join(REPO_ROOT, "apps/teamhub-cli/scripts/build-cli.mjs"),
        "--outdir",
        cliOutDir,
      ],
      { cwd: REPO_ROOT, env: serviceEnv },
    );
    await symlink(process.execPath, path.join(runtimeBinDir, "node"));
    await writePrivate(
      path.join(cliOutDir, "teamhub"),
      '#!/bin/sh\ncli_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$cli_dir/../runtime/bin/node" --use-env-proxy "$cli_dir/teamhub.js" "$@"\n',
      0o755,
    );

    const computerPkg = JSON.parse(
      await readFile(
        path.join(REPO_ROOT, "apps/computer/package.json"),
        "utf8",
      ),
    );
    const ldflags = `-X github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/transport.ReleaseVersion=${computerPkg.version}`;
    const localDaemonDir = path.join(REPO_ROOT, "apps/computer/local-daemon");
    const goBuildEnv = { ...process.env, CGO_ENABLED: "0" };
    runChecked(
      "go",
      [
        "build",
        "-trimpath",
        "-ldflags",
        ldflags,
        "-o",
        state.paths.computerCli,
        "./cmd/linger-computer",
      ],
      { cwd: localDaemonDir, env: goBuildEnv },
    );
    runChecked(
      "go",
      [
        "build",
        "-trimpath",
        "-ldflags",
        ldflags,
        "-o",
        state.paths.computerDaemon,
        "./cmd/linger-computer-daemon",
      ],
      { cwd: localDaemonDir, env: goBuildEnv },
    );

    const regOutputDir = path.join(runDir, "computer");
    runChecked(
      process.execPath,
      [
        path.join(REPO_ROOT, "scripts/register-local-computer.mjs"),
        "--teamhub-url",
        teamhubUrl,
        "--owner-file",
        state.paths.ownerFile,
        "--display-name",
        "Verify Computer",
        "--output-directory",
        regOutputDir,
      ],
      { cwd: REPO_ROOT, env: serviceEnv },
    );
    const registration = JSON.parse(
      await readFile(
        path.join(regOutputDir, "runner-registration.json"),
        "utf8",
      ),
    );
    state.computer_id = registration.computer_id;
    state.tenant_id = registration.tenant_id;

    const computerConfig = {
      runner_id: registration.computer_id,
      display_name: "Verify Computer",
      gateway: {
        url: registration.gateway_url,
        token_file: path.join(regOutputDir, "runner-token"),
      },
      state_directory: state.paths.computerStateDir,
      workspace_grants: [
        {
          grant_id: "workspace-verify",
          label: "Verify Workspace",
          tenant_id: registration.tenant_id,
          root_path: path.join(runDir, "workspace"),
          mode: "workspace-write",
          scope: "owner",
        },
      ],
    };

    if (!liveProvider) {
      const codexWrapper = path.join(runDir, "bin/codex-fixture");
      const codexAuthFile = path.join(runDir, "codex-home/auth.json");
      await writePrivate(codexAuthFile, "{}\n", 0o600);
      await writePrivate(
        codexWrapper,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "--version" ]; then',
          "  echo 'codex-cli 0.170.2'",
          "  exit 0",
          "fi",
          `exec "${process.execPath}" "${path.join(REPO_ROOT, "scripts/test-fixtures/codex-app-server-fixture.mjs")}" "$@" --persist-threads --empty-thread-history`,
          "",
        ].join("\n"),
        0o700,
      );
      computerConfig.runtime_paths = { codex: codexWrapper };
      computerConfig.codex = { auth_file: codexAuthFile };
    }

    await writePrivate(
      state.paths.computerConfig,
      `${JSON.stringify(computerConfig, null, 2)}\n`,
      0o600,
    );
    await saveState(state);

    const startDaemon = runComputerCli(state, ["daemon", "start"]);
    if (startDaemon.status !== 0) {
      throw new Error(
        `linger-computer daemon start failed (${String(startDaemon.status)}):\n${startDaemon.stdout}\n${startDaemon.stderr}`,
      );
    }

    const gatewayDeadline = Date.now() + 45_000;
    let connected = false;
    while (Date.now() < gatewayDeadline) {
      const statusResult = runComputerCli(state, [
        "daemon",
        "status",
        "--json",
      ]);
      if (statusResult.status === 0) {
        const parsed = JSON.parse(statusResult.stdout);
        if (parsed?.daemon?.pid) {
          state.pids.computerDaemon = parsed.daemon.pid;
        }
        const readyRuntime = (parsed.runtimes ?? []).some(
          (runtime) => runtime.status === "ready",
        );
        if (parsed?.daemon?.gateway_state === "connected" && readyRuntime) {
          connected = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await saveState(state);
    if (!connected) {
      throw new Error(
        "Local Computer daemon did not reach connected gateway state with a ready runtime",
      );
    }

    const { cookie } = await loginAsOwner(state);
    try {
      const anotherMeDeadline = Date.now() + 30_000;
      let anotherMe = null;
      while (Date.now() < anotherMeDeadline) {
        const response = await fetch(
          `${teamhubUrl}/v0/tenants/${encodeURIComponent(state.tenant_id)}/another-me`,
          {
            headers: { cookie },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (response.ok) {
          const body = await response.json();
          if (body.agent_actor_id && body.room_id) {
            anotherMe = body;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!anotherMe) {
        throw new Error(
          "Another Me was not provisioned within 30s after Local Computer connected",
        );
      }
      state.another_me_actor_id = anotherMe.agent_actor_id;
      state.another_me_room_id = anotherMe.room_id;
    } finally {
      await logoutOwner(state, cookie);
    }
    await saveState(state);

    process.stdout.write(
      `${JSON.stringify(
        {
          run_id: state.run_id,
          run_dir: state.run_dir,
          evidence_dir: state.evidence_dir,
          browser_session: state.browser_session,
          web_url: state.web_url,
          teamhub_url: state.teamhub_url,
          node_services_url: state.node_services_url,
          document_runtime_url: state.document_runtime_url,
          owner_email: state.owner_email,
          tenant_id: state.tenant_id,
          another_me_actor_id: state.another_me_actor_id,
          another_me_room_id: state.another_me_room_id,
          computer_id: state.computer_id,
          provider_mode: state.provider_mode,
          db_mode: state.db_mode,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `verify-linger up failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    await dumpLogsTail(runDir);
    await teardownRun(state).catch(() => undefined);
    process.exit(1);
  }
}

async function cmdDoctor(flags) {
  const runId = flags["run-id"];
  if (!runId) {
    fail("doctor requires --run-id <id>", 2);
  }
  const state = await loadState(runId);
  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
  };

  const pidTargets = [
    ["teamhub", state.pids?.teamhub, [state.run_dir, "bin/teamhub"]],
    [
      "nodeServices",
      state.pids?.nodeServices,
      ["apps/node-services/src/main.ts", REPO_ROOT],
    ],
    ["web", state.pids?.web, ["vite.js", String(state.ports?.web)]],
  ];
  if (state.db_mode === "native") {
    pidTargets.unshift([
      "postgres",
      state.pids?.postgres,
      [state.paths.pgData, "postgres"],
    ]);
  }
  for (const [label, pid, markers] of pidTargets) {
    const cmdline = processCommandLine(pid);
    const ok =
      Boolean(cmdline) && markers.some((marker) => cmdline.includes(marker));
    record(
      `pid.${label}`,
      ok,
      ok ? `pid=${pid}` : `pid=${String(pid)} missing or mismatched`,
    );
  }

  const portTargets = [
    ["teamhub", state.ports?.teamhub, state.pids?.teamhub],
    ["nodeServices", state.ports?.nodeServices, state.pids?.nodeServices],
    ["documentRuntime", state.ports?.documentRuntime, state.pids?.nodeServices],
    ["web", state.ports?.web, state.pids?.web],
  ];
  if (state.db_mode === "native") {
    portTargets.unshift([
      "postgres",
      state.ports?.postgres,
      state.pids?.postgres,
    ]);
  }
  for (const [label, port, expectedPid] of portTargets) {
    const listeners = portListenerPids(port);
    const ok = listeners.includes(expectedPid);
    record(
      `port.${label}`,
      ok,
      ok
        ? `127.0.0.1:${port} owned by pid ${expectedPid}`
        : `127.0.0.1:${port} listeners=${JSON.stringify(listeners)} expected=${String(expectedPid)}`,
    );
  }

  for (const [label, url] of [
    ["web.healthz", `${state.web_url}/healthz`],
    ["teamhub.healthz", `${state.teamhub_url}/healthz`],
    ["node_services.healthz", `${state.node_services_url}/healthz`],
    ["node_services.readyz", `${state.node_services_url}/readyz`],
    ["document_runtime.healthz", `${state.document_runtime_url}/healthz`],
    ["document_runtime.readyz", `${state.document_runtime_url}/readyz`],
  ]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      record(`http.${label}`, response.ok, `status=${response.status}`);
    } catch (error) {
      record(
        `http.${label}`,
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    const { cookie } = await loginAsOwner(state);
    try {
      const sessionResponse = await fetch(`${state.teamhub_url}/v0/session`, {
        headers: { cookie },
        signal: AbortSignal.timeout(3_000),
      });
      record(
        "auth.session",
        sessionResponse.ok,
        `status=${sessionResponse.status}`,
      );
      const anotherMeResponse = await fetch(
        `${state.teamhub_url}/v0/tenants/${encodeURIComponent(state.tenant_id)}/another-me`,
        {
          headers: { cookie },
          signal: AbortSignal.timeout(3_000),
        },
      );
      const body = anotherMeResponse.ok ? await anotherMeResponse.json() : {};
      const ready = Boolean(body.agent_actor_id && body.room_id);
      record(
        "auth.another_me",
        anotherMeResponse.ok && ready,
        ready
          ? `agent_actor_id=${body.agent_actor_id} room_id=${body.room_id}`
          : `status=${anotherMeResponse.status} body=${JSON.stringify(body)}`,
      );
    } finally {
      await logoutOwner(state, cookie);
    }
  } catch (error) {
    record(
      "auth.owner",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  const daemonResult = runComputerCli(state, ["daemon", "status", "--json"]);
  if (daemonResult.status === 0) {
    try {
      const parsed = JSON.parse(daemonResult.stdout);
      const daemonPid = parsed?.daemon?.pid;
      const gatewayState = parsed?.daemon?.gateway_state;
      const readyRuntimes = (parsed?.runtimes ?? [])
        .filter((runtime) => runtime.status === "ready")
        .map((runtime) => runtime.type);
      const ok =
        isPidAlive(daemonPid) &&
        gatewayState === "connected" &&
        readyRuntimes.length > 0;
      record(
        "computer.daemon",
        ok,
        `pid=${String(daemonPid)} gateway=${String(gatewayState)} ready_runtimes=${readyRuntimes.join(",")}`,
      );
    } catch (error) {
      record(
        "computer.daemon",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  } else {
    record(
      "computer.daemon",
      false,
      `exit=${String(daemonResult.status)} ${daemonResult.stderr.trim()}`,
    );
  }

  const allOk = checks.every((check) => check.ok);
  process.stdout.write(
    `${JSON.stringify({ ok: allOk, run_id: runId, checks }, null, 2)}\n`,
  );
  if (!allOk) {
    process.exit(1);
  }
}

function runBrowserCommand(session, args) {
  const result = spawnSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_BROWSER_DEFAULT_TIMEOUT:
        process.env.AGENT_BROWSER_DEFAULT_TIMEOUT ?? "25000",
    },
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

async function cmdSignIn(flags) {
  const runId = flags["run-id"];
  if (!runId) {
    fail("sign-in requires --run-id <id>", 2);
  }
  const state = await loadState(runId);
  const owner = JSON.parse(await readFile(state.paths.ownerFile, "utf8"));
  const returnTo = flags["return-to"];
  const loginUrl = returnTo
    ? `${state.web_url}/login?return_to=${encodeURIComponent(returnTo)}`
    : `${state.web_url}/login`;

  const openRes = runBrowserCommand(state.browser_session, ["open", loginUrl]);
  if (openRes.status !== 0) {
    fail(openRes.stderr || openRes.stdout || "agent-browser open failed");
  }
  runBrowserCommand(state.browser_session, ["wait", "--load", "load"]);
  const currentAfterOpen = runBrowserCommand(state.browser_session, [
    "get",
    "url",
  ]).stdout.trim();
  const currentPathname = new URL(currentAfterOpen).pathname;
  if (currentPathname === "/login") {
    for (const args of [
      ["wait", "--text", "Log in"],
      ["find", "label", "Email", "fill", owner.owner_email],
      ["find", "label", "Password", "fill", owner.owner_password],
      ["find", "role", "button", "click", "--name", "Sign in"],
    ]) {
      const step = runBrowserCommand(state.browser_session, args);
      if (step.status !== 0) {
        fail(
          `sign-in step (${args.slice(0, 3).join(" ")}) failed: ${step.stderr || step.stdout}`,
        );
      }
    }
    const expectedPrefix = returnTo ? returnTo.split("?")[0] : "/t/";
    const waitNav = runBrowserCommand(state.browser_session, [
      "wait",
      "--fn",
      `window.location.pathname.startsWith(${JSON.stringify(expectedPrefix)})`,
    ]);
    if (waitNav.status !== 0) {
      fail(`sign-in redirect timed out: ${waitNav.stderr || waitNav.stdout}`);
    }
  }
  const finalUrl = runBrowserCommand(state.browser_session, [
    "get",
    "url",
  ]).stdout.trim();
  process.stdout.write(
    `${JSON.stringify({ signed_in_as: owner.owner_email, url: finalUrl }, null, 2)}\n`,
  );
}

async function cmdBrowser(flags, passthrough) {
  const runId = flags["run-id"];
  if (!runId) {
    fail("browser requires --run-id <id> -- <agent-browser args...>", 2);
  }
  if (passthrough.length === 0) {
    fail("browser requires arguments after --", 2);
  }
  const state = await loadState(runId);
  const result = spawnSync(
    "agent-browser",
    ["--session", state.browser_session, ...passthrough],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        AGENT_BROWSER_DEFAULT_TIMEOUT:
          process.env.AGENT_BROWSER_DEFAULT_TIMEOUT ?? "25000",
      },
    },
  );
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

async function cmdApi(flags, positional) {
  const runId = flags["run-id"];
  const [method, requestPath] = positional;
  if (!runId || !method || !requestPath) {
    fail("Usage: verify-linger.mjs api --run-id <id> GET <path>", 2);
  }
  if (method.toUpperCase() !== "GET") {
    fail(
      `api allows only read-only GET requests (got ${method}). Drive product mutations through the UI.`,
      2,
    );
  }
  if (!requestPath.startsWith("/")) {
    fail(`API path must start with '/': ${requestPath}`, 2);
  }
  const state = await loadState(runId);
  const { cookie } = await loginAsOwner(state);
  try {
    const response = await fetch(`${state.teamhub_url}${requestPath}`, {
      headers: { cookie, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) {
      fail(`GET ${requestPath} returned ${response.status}: ${text}`);
    }
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  } finally {
    await logoutOwner(state, cookie);
  }
}

async function cmdSql(flags, positional) {
  const runId = flags["run-id"];
  const query = positional.join(" ");
  if (!runId || !query) {
    fail("Usage: verify-linger.mjs sql --run-id <id> <query>", 2);
  }
  const state = await loadState(runId);
  const sqlFlags = [
    "-v",
    "ON_ERROR_STOP=1",
    "--no-psqlrc",
    "-P",
    "pager=off",
    "-c",
    "SET default_transaction_read_only = on;",
    "-c",
    query,
  ];
  let result;
  if (state.db_mode === "native") {
    result = spawnSync(
      path.join(state.paths.pgBin, "psql"),
      [
        "--host",
        state.database.host,
        "--port",
        String(state.database.port),
        "--username",
        state.database.user,
        "--dbname",
        state.database.dbname,
        ...sqlFlags,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PGPASSWORD: state.database.password,
          PGCONNECT_TIMEOUT: "3",
        },
      },
    );
  } else {
    const composeFile = path.join(
      REPO_ROOT,
      "apps/teamhub/deployments/compose/docker-compose.test.yml",
    );
    result = spawnSync(
      "docker",
      [
        "compose",
        "--project-name",
        state.docker.projectName,
        "--file",
        composeFile,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        state.database.user,
        "-d",
        state.database.dbname,
        ...sqlFlags,
      ],
      { encoding: "utf8" },
    );
  }
  if (result.error) {
    throw result.error;
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function cmdComputer(flags, passthrough) {
  const runId = flags["run-id"];
  if (!runId || passthrough.length === 0) {
    fail(
      "Usage: verify-linger.mjs computer --run-id <id> -- <linger-computer args...>",
      2,
    );
  }
  const state = await loadState(runId);
  const result = spawnSync(
    state.paths.computerCli,
    [...passthrough, "--config", state.paths.computerConfig],
    {
      stdio: "inherit",
      env: buildComputerCliEnv(state, state.provider_mode === "live"),
    },
  );
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

async function cmdDown(flags) {
  const runId = flags["run-id"];
  if (!runId) {
    fail("down requires --run-id <id>", 2);
  }
  const runDir = resolveRunDir(runId);
  if (!existsSync(runDir)) {
    process.stdout.write(
      `${JSON.stringify({ status: "down", run_id: runId, already_clean: true }, null, 2)}\n`,
    );
    return;
  }
  const filePath = stateFilePath(runDir);
  const state = existsSync(filePath)
    ? JSON.parse(await readFile(filePath, "utf8"))
    : { run_id: runId, run_dir: runDir };
  await teardownRun(state);
  const evidenceDir = state.evidence_dir;
  const result = {
    status: "down",
    run_id: runId,
    removed_run_dir: runDir,
    run_dir_exists: existsSync(runDir),
    ...(evidenceDir
      ? {
          evidence_dir: evidenceDir,
          evidence_preserved: existsSync(evidenceDir),
        }
      : {}),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    printUsage();
    return;
  }
  const { flags, positional, passthrough } = parseRunOptions(rest);
  if (flags.help) {
    printUsage();
    return;
  }
  switch (command) {
    case "up":
      await cmdUp(flags);
      break;
    case "doctor":
      await cmdDoctor(flags);
      break;
    case "sign-in":
      await cmdSignIn(flags);
      break;
    case "browser":
      await cmdBrowser(flags, passthrough);
      break;
    case "api":
      await cmdApi(flags, positional);
      break;
    case "sql":
      await cmdSql(flags, positional);
      break;
    case "computer":
      await cmdComputer(flags, passthrough);
      break;
    case "down":
      await cmdDown(flags);
      break;
    default:
      fail(`Unknown command: ${command}`, 2);
  }
}

void main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
});
