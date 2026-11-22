import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(
  () => [] as Array<{ args: string[]; env: NodeJS.ProcessEnv }>,
);
const output = vi.hoisted(() => ({ identity: "", environment: "" }));
vi.mock("node:child_process", () => ({
  execFile: (
    _executable: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
    callback: (error: null, stdout: string) => void,
  ) => {
    calls.push({ args, env: options.env });
    callback(null, args[0] === "eww" ? output.environment : output.identity);
  },
}));

const { darwinProcessIdentity, nativeProcessIdentity } =
  await import("./native-process-identity.js");

const lease = "a".repeat(64);
// What ps prints for lstart on a zh-CN Mac: four fields, not five.
const zhStart = `${String.fromCodePoint(0x4e09)} 11${String.fromCodePoint(0x6708)}/18 06:04:14 2026`;

describe("darwinProcessIdentity", () => {
  it("keeps the C-locale birth every recorded identity uses", () => {
    expect(
      darwinProcessIdentity("Wed Nov 18 06:04:14 2026   501 73285 Ss\n"),
    ).toEqual({
      birth: "darwin:Wed:Nov:18:06:04:14:2026:501:73285",
      uid: 501,
      group: 73285,
      state: "Ss",
    });
  });

  it("reads uid, group and state after a localized start time", () => {
    expect(darwinProcessIdentity(`${zhStart}   501 73285 Ss`)).toMatchObject({
      uid: 501,
      group: 73285,
      state: "Ss",
    });
  });

  it("rejects a line without numeric uid and group", () => {
    expect(darwinProcessIdentity("Wed Nov 18 06:04:14 2026")).toBeUndefined();
  });
});

describe("nativeProcessIdentity on macOS", () => {
  const platform = process.platform;
  const getuid = process.getuid;
  beforeEach(() => {
    calls.length = 0;
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.getuid = () => 501;
    process.env.LC_ALL = "zh_CN.UTF-8";
    process.env.LANG = "zh_CN.UTF-8";
    process.env.LINGER_NATIVE_PROCESS_LEASE = lease;
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    process.getuid = getuid;
    delete process.env.LC_ALL;
    delete process.env.LANG;
    delete process.env.LINGER_NATIVE_PROCESS_LEASE;
  });

  it("runs every ps in the C locale without the lease", async () => {
    output.identity = "Wed Nov 18 06:04:14 2026   501 73285 Ss\n";
    output.environment = `node worker.mjs LINGER_NATIVE_PROCESS_LEASE=${lease}\n`;
    await expect(nativeProcessIdentity(73285, lease)).resolves.toBe(
      "darwin:Wed:Nov:18:06:04:14:2026:501:73285",
    );
    expect(calls).toHaveLength(2);
    for (const { env } of calls) {
      expect(env).toMatchObject({ LC_ALL: "C", LANG: "C" });
      expect(env.LINGER_NATIVE_PROCESS_LEASE).toBeUndefined();
    }
  });

  it("verifies a process whose start time still prints localized", async () => {
    output.identity = `${zhStart}   501 73285 Ss\n`;
    output.environment = `node worker.mjs LINGER_NATIVE_PROCESS_LEASE=${lease}\n`;
    await expect(nativeProcessIdentity(73285, lease)).resolves.toBe(
      `darwin:${zhStart.split(" ").join(":")}:501:73285`,
    );
  });
});
