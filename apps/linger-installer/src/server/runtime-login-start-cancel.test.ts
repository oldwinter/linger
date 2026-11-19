import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { inspectRuntime } from "@linger/local-installation/managed-runtimes";
import { RuntimeLoginManager } from "./runtime-login.js";

vi.mock("@linger/local-installation/managed-codex", () => ({
  managedRuntimeEnvironment: async () => ({}),
}));

const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), "runtime-pending-"));
  clean.push(() => rm(home, { recursive: true, force: true }));
  const starts = path.join(home, "starts.txt");
  const script = path.join(home, "login.cjs");
  await writeFile(
    script,
    `require('node:fs').appendFileSync(${JSON.stringify(starts)}, process.argv[2] + '\\n'); console.log('https://auth.openai.com/codex/device'); setInterval(() => {}, 1000);`,
  );
  const state = (
    label: string,
  ): Awaited<ReturnType<typeof inspectRuntime>> => ({
    runtime: "codex",
    executable: process.execPath,
    installed: true,
    ready: false,
    loginCommand: "unused",
    descriptor: {
      runtime: "codex",
      executable: process.execPath,
      argvPrefix: [],
      installed: true,
      authenticated: false,
      authMode: null,
      loginCommand: {
        executable: process.execPath,
        args: [script, label],
        env: {},
      },
      deviceLoginCommand: {
        executable: process.execPath,
        args: [script, label],
        env: {},
      },
    },
  });
  const input = {
    instance: "default",
    home,
    root: home,
    runtime: "codex" as const,
  };
  return { starts, state, input };
}

it("cancel invalidates an in-flight inspection without canceling a later retry", async () => {
  const { starts, state, input } = await fixture();
  const entered = gate();
  const resume = gate();
  let calls = 0;
  const manager = new RuntimeLoginManager(async () => {
    if (++calls === 1) {
      entered.resolve();
      await resume.promise;
      return state("canceled");
    }
    return state("retry");
  }, "linux");
  clean.push(async () => manager.close());
  const pending = manager.start(input);
  await entered.promise;
  expect(manager.cancel(input.instance)).toEqual({ state: "idle" });
  resume.resolve();
  expect(await pending).toEqual({ state: "idle" });
  await expect(readFile(starts)).rejects.toMatchObject({ code: "ENOENT" });
  await manager.start(input);
  await expect.poll(() => readFile(starts, "utf8")).toBe("retry\n");
  await expect
    .poll(async () => (await manager.status(input)).state)
    .toBe("waiting_user");
  expect(await readFile(starts, "utf8")).toBe("retry\n");
});

it("close invalidates pending inspections and prevents later login processes", async () => {
  const { starts, state, input } = await fixture();
  const entered = gate();
  const resume = gate();
  let calls = 0;
  const manager = new RuntimeLoginManager(async () => {
    if (++calls === 2) entered.resolve();
    await resume.promise;
    return state("closed");
  }, "linux");
  clean.push(async () => manager.close());
  const pending = [
    manager.start(input),
    manager.start({ ...input, instance: "other" }),
  ];
  await entered.promise;
  manager.close();
  resume.resolve();
  expect(await Promise.all(pending)).toEqual([
    { state: "idle" },
    { state: "idle" },
  ]);
  expect(await manager.start(input)).toEqual({ state: "idle" });
  await expect(readFile(starts)).rejects.toMatchObject({ code: "ENOENT" });
});

it("an older inspection cannot launch a login after a newer start finds credentials ready", async () => {
  const { starts, state, input } = await fixture();
  const entered = gate();
  const resume = gate();
  let calls = 0;
  const manager = new RuntimeLoginManager(async () => {
    if (++calls === 1) {
      entered.resolve();
      await resume.promise;
      return state("stale");
    }
    return { ...state("ready"), ready: true };
  }, "linux");
  clean.push(async () => manager.close());
  const pending = manager.start(input);
  await entered.promise;
  expect(await manager.start(input)).toEqual({ state: "ready" });
  resume.resolve();
  expect(await pending).toEqual({ state: "idle" });
  await expect(readFile(starts)).rejects.toMatchObject({ code: "ENOENT" });
});

it("reports an active inspection failure and allows a subsequent start", async () => {
  const { starts, state, input } = await fixture();
  let calls = 0;
  const error = new Error("inspection failed");
  const manager = new RuntimeLoginManager(async () => {
    if (++calls === 1) throw error;
    return state("retry");
  }, "linux");
  clean.push(async () => manager.close());
  await expect(manager.start(input)).rejects.toBe(error);
  expect((await manager.start(input)).state).toBe("starting");
  await expect.poll(() => readFile(starts, "utf8")).toBe("retry\n");
});

it("cancel aborts the pending inspector and settles its start as idle", async () => {
  const { starts, input } = await fixture();
  const entered = gate();
  let signal!: AbortSignal;
  let rejectProbe!: (error: Error) => void;
  const manager = new RuntimeLoginManager(async (_runtime, options) => {
    signal = options.signal!;
    entered.resolve();
    return new Promise<never>((_resolve, reject) => {
      rejectProbe = reject;
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  }, "linux");
  clean.push(async () => manager.close());
  const pending = manager.start(input);
  // Ensure a failing baseline assertion can still release the controlled inspector.
  clean.push(async () => {
    rejectProbe(new Error("fixture cleanup"));
    await pending.catch(() => {});
  });
  await entered.promise;
  manager.cancel(input.instance);
  expect(signal.aborted).toBe(true);
  expect(await pending).toEqual({ state: "idle" });
  await expect(readFile(starts)).rejects.toMatchObject({ code: "ENOENT" });
});
