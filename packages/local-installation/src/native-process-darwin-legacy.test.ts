import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// ps as a Mac in a German region format prints it: lstart in the caller's
// locale, C only when the inspector asks for it.
const ps = vi.hoisted(() => {
  const uid = process.getuid?.();
  return {
    uid,
    c: `Wed Nov 18 06:04:14 2026   ${uid} 73285 Ss\n`,
    localized: `Mi 18 Nov 06:04:14 2026   ${uid} 73285 Ss\n`,
    environment: "",
  };
});
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: (
    _executable: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
    callback: (error: null, stdout: string) => void,
  ) => {
    if (args[0] === "eww") callback(null, ps.environment);
    else callback(null, options.env.LC_ALL === "C" ? ps.c : ps.localized);
  },
}));

const { atomicPrivate, privateDirectory } = await import("./instance.js");
const { inspectNativeProcess } = await import("./native-process.js");

const lease = "a".repeat(64);
// What Linger 0.1.2 recorded for that process: the localized start time.
const legacyBirth = `darwin:Mi:18:Nov:06:04:14:2026:${ps.uid}:73285`;
const platform = process.platform;
// Simulated Darwin still needs a real POSIX file owner on the host.
const posixTest = it.skipIf(platform === "win32");
let root: string;
const recordFile = () =>
  path.join(root, "native", "processes", "postgres.json");
const birth = async () =>
  (JSON.parse(await readFile(recordFile(), "utf8")) as { birth: string }).birth;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "linger-darwin-legacy-"));
  await privateDirectory(path.join(root, "native", "processes"));
  await atomicPrivate(
    recordFile(),
    JSON.stringify({
      schemaVersion: 1,
      name: "postgres",
      pid: 73285,
      birth: legacyBirth,
      lease,
      configuration: "b".repeat(64),
    }),
  );
  Object.defineProperty(process, "platform", { value: "darwin" });
  vi.stubEnv("LANG", "de_DE.UTF-8");
  ps.localized = `Mi 18 Nov 06:04:14 2026   ${ps.uid} 73285 Ss\n`;
  ps.environment = `node worker.mjs LINGER_NATIVE_PROCESS_LEASE=${lease}\n`;
});
afterEach(async () => {
  Object.defineProperty(process, "platform", { value: platform });
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

posixTest(
  "adopts a service 0.1.2 recorded with a localized start time, once",
  async () => {
    await expect(inspectNativeProcess(root, "postgres")).resolves.toEqual({
      running: true,
      pid: 73285,
    });
    expect(await birth()).toBe(
      `darwin:Wed:Nov:18:06:04:14:2026:${ps.uid}:73285`,
    );
  },
);

posixTest(
  "keeps the record when the localized start time names another process",
  async () => {
    ps.localized = `Mi 18 Nov 07:00:00 2026   ${ps.uid} 73285 Ss\n`;
    await expect(inspectNativeProcess(root, "postgres")).resolves.toMatchObject(
      {
        running: false,
      },
    );
    expect(await birth()).toBe(legacyBirth);
  },
);

posixTest("keeps the record of a process without the lease", async () => {
  ps.environment = "node worker.mjs\n";
  await expect(inspectNativeProcess(root, "postgres")).resolves.toMatchObject({
    running: false,
  });
  expect(await birth()).toBe(legacyBirth);
});
