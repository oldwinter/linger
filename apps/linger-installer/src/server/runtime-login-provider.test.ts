import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { RuntimeLoginManager } from "./runtime-login.js";

vi.mock("@linger/local-installation/managed-codex", () => ({
  managedRuntimeEnvironment: async () => ({}),
}));

const urls = {
  codex: "https://auth.openai.com/codex/device",
  claude: "https://claude.com/cai/oauth/authorize?state=fixture",
};

async function setup() {
  const home = await mkdtemp(path.join(tmpdir(), "runtime-provider-"));
  const program = path.join(home, "login.mjs");
  const starts = path.join(home, "starts.txt");
  const codes = path.join(home, "codes.txt");
  const ready = new Set<string>();
  await writeFile(
    program,
    `
import fs from 'node:fs';
const runtime = process.argv[2];
fs.appendFileSync(${JSON.stringify(starts)}, runtime + '\\n');
fs.writeFileSync(${JSON.stringify(home)} + '/' + runtime + '.pid', String(process.pid));
console.log(${JSON.stringify(urls)}[runtime]);
process.stdin.on('data', (chunk) => fs.appendFileSync(${JSON.stringify(codes)}, chunk));
setTimeout(() => process.exit(0), 30000);
`,
  );
  const manager = new RuntimeLoginManager(async (runtime) => {
    const command = {
      executable: process.execPath,
      args: [program, runtime],
      env: {},
    };
    return {
      runtime,
      executable: process.execPath,
      installed: true,
      ready: ready.has(runtime),
      loginCommand: "unused",
      descriptor: {
        runtime,
        executable: process.execPath,
        argvPrefix: [],
        installed: true,
        authenticated: ready.has(runtime),
        authMode: null,
        loginCommand: command,
        deviceLoginCommand: command,
      },
    };
  }, "linux");
  const input = (runtime: "codex" | "claude") => ({
    instance: "default",
    home,
    root: home,
    runtime,
  });
  const wait = async (runtime: "codex" | "claude") => {
    await expect
      .poll(async () => (await manager.status(input(runtime))).url, {
        timeout: 5000,
      })
      .toBe(urls[runtime]);
  };
  return {
    manager,
    input,
    wait,
    starts,
    codes,
    ready,
    pid: async (runtime: "codex" | "claude") =>
      Number(await readFile(path.join(home, `${runtime}.pid`), "utf8")),
    cleanup: async () => {
      manager.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

it(
  "does not report another runtime's pending sign-in after the setup choice changes",
  { timeout: 15000 },
  async () => {
    const f = await setup();
    try {
      await f.manager.start(f.input("claude"));
      await f.wait("claude");
      expect(await f.manager.status(f.input("codex"))).toEqual({
        state: "idle",
      });
      expect((await f.manager.status(f.input("claude"))).url).toBe(urls.claude);
    } finally {
      await f.cleanup();
    }
  },
);

it(
  "replaces the previous runtime's sign-in while deduplicating the selected runtime",
  { timeout: 15000 },
  async () => {
    const f = await setup();
    try {
      await f.manager.start(f.input("codex"));
      await f.wait("codex");
      const previous = await f.pid("codex");
      expect(alive(previous)).toBe(true);
      expect((await f.manager.start(f.input("claude"))).state).toBe("starting");
      await f.wait("claude");
      await expect.poll(() => alive(previous), { timeout: 5000 }).toBe(false);
      expect((await f.manager.start(f.input("claude"))).url).toBe(urls.claude);
      expect((await readFile(f.starts, "utf8")).trim().split("\n")).toEqual([
        "codex",
        "claude",
      ]);
    } finally {
      await f.cleanup();
    }
  },
);

it(
  "stops the previous login when the selected runtime is already ready",
  { timeout: 15000 },
  async () => {
    const f = await setup();
    try {
      await f.manager.start(f.input("codex"));
      await f.wait("codex");
      const previous = await f.pid("codex");
      expect(alive(previous)).toBe(true);
      f.ready.add("claude");
      expect(await f.manager.start(f.input("claude"))).toEqual({
        state: "ready",
      });
      await expect.poll(() => alive(previous), { timeout: 5000 }).toBe(false);
      expect((await readFile(f.starts, "utf8")).trim()).toBe("codex");
    } finally {
      await f.cleanup();
    }
  },
);

it(
  "accepts a pasted code only for the runtime that owns the pending sign-in",
  { timeout: 15000 },
  async () => {
    const f = await setup();
    try {
      await f.manager.start(f.input("claude"));
      await f.wait("claude");
      await expect(
        f.manager.start(f.input("codex"), "fixture-code"),
      ).rejects.toThrow("Invalid authorization code or inactive login");
      await f.manager.start(f.input("claude"), "fixture-code");
      await expect
        .poll(() => readFile(f.codes, "utf8").catch(() => ""), {
          timeout: 5000,
        })
        .toBe("fixture-code\n");
    } finally {
      await f.cleanup();
    }
  },
);
