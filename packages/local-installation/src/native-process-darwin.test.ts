import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(
  () => [] as Array<{ args: string[]; env: NodeJS.ProcessEnv }>,
);
const spawnCalls = vi.hoisted(
  () => [] as Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv }>,
);
const output = vi.hoisted(() => ({
  identity: "",
  environment: "",
  stream: "",
}));
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
  spawn: (
    file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
  ) => {
    spawnCalls.push({ file, args, env: options.env });
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = Readable.from([output.stream]);
    child.stderr = Readable.from([]);
    child.kill = vi.fn();
    child.stdout.on("end", () => {
      queueMicrotask(() => child.emit("close", 0, null));
    });
    return child;
  },
}));

const {
  darwinProcessIdentity,
  nativeLeaseProcesses,
  nativeProcessIdentity,
  parseDarwinLeaseLine,
} = await import("./native-process-identity.js");

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
    spawnCalls.length = 0;
    output.stream = "";
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

  it("streams macOS user processes in one ps ewwx call and filters uid, self, and zombies", async () => {
    output.stream = [
      `  73285 Wed Nov 18 06:04:14 2026       501 73285 Ss   node worker.mjs LINGER_NATIVE_PROCESS_LEASE=${lease}`,
      `  73286 Wed Nov 18 06:04:15 2026       501 73285 S    /opt/postgres/bin/postgres LINGER_NATIVE_PROCESS_LEASE=${lease}`,
      `  73287 Wed Nov 18 06:04:16 2026       501 73285 Z    defunct LINGER_NATIVE_PROCESS_LEASE=${lease}`,
      `  73288 Wed Nov 18 06:04:17 2026         0 73288 Ss   root-proc LINGER_NATIVE_PROCESS_LEASE=${lease}`,
      `  ${process.pid} Wed Nov 18 06:04:18 2026       501 ${process.pid} S    self LINGER_NATIVE_PROCESS_LEASE=${lease}`,
      `  73289 Wed Nov 18 06:04:19 2026       501 73289 S    unrelated-browser-tab`,
      "",
    ].join("\n");

    await expect(nativeLeaseProcesses(lease)).resolves.toEqual([
      { pid: 73285, birth: "darwin:Wed:Nov:18:06:04:14:2026:501:73285" },
      { pid: 73286, birth: "darwin:Wed:Nov:18:06:04:15:2026:501:73285" },
    ]);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      file: "/bin/ps",
      args: [
        "ewwx",
        "-U",
        "501",
        "-o",
        "pid=,lstart=,uid=,pgid=,stat=,command=",
      ],
    });
    expect(spawnCalls[0]?.env).toMatchObject({ LC_ALL: "C", LANG: "C" });
    expect(spawnCalls[0]?.env.LINGER_NATIVE_PROCESS_LEASE).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("falls back to single-PID verification if a lease line has an unexpected date layout", async () => {
    output.stream = `  73290 ${zhStart} 501 73290 S node worker.mjs LINGER_NATIVE_PROCESS_LEASE=${lease}\n`;
    output.identity = "Wed Nov 18 06:04:14 2026   501 73290 S\n";
    output.environment = `node worker.mjs LINGER_NATIVE_PROCESS_LEASE=${lease}\n`;
    await expect(nativeLeaseProcesses(lease)).resolves.toEqual([
      { pid: 73290, birth: "darwin:Wed:Nov:18:06:04:14:2026:501:73290" },
    ]);
    expect(calls).toHaveLength(2);
  });
});

describe("parseDarwinLeaseLine", () => {
  it("extracts pid and C-locale birth for valid user lines", () => {
    expect(
      parseDarwinLeaseLine(
        `  9101 Thu Nov 26 03:43:27 2026       502 9100 S    node app.js LINGER_NATIVE_PROCESS_LEASE=${lease}`,
        lease,
        502,
        1,
      ),
    ).toEqual({
      pid: 9101,
      birth: "darwin:Thu:Nov:26:03:43:27:2026:502:9100",
    });
  });

  it("ignores lines without the lease, zombies, other UIDs, and self", () => {
    expect(
      parseDarwinLeaseLine(
        `  9101 Thu Nov 26 03:43:27 2026 502 9100 S node app.js`,
        lease,
        502,
        1,
      ),
    ).toBeUndefined();
    expect(
      parseDarwinLeaseLine(
        `  9101 Thu Nov 26 03:43:27 2026 502 9100 Z node app.js LINGER_NATIVE_PROCESS_LEASE=${lease}`,
        lease,
        502,
        1,
      ),
    ).toBeUndefined();
    expect(
      parseDarwinLeaseLine(
        `  9101 Thu Nov 26 03:43:27 2026 0 9100 S node app.js LINGER_NATIVE_PROCESS_LEASE=${lease}`,
        lease,
        502,
        1,
      ),
    ).toBeUndefined();
    expect(
      parseDarwinLeaseLine(
        `  9101 Thu Nov 26 03:43:27 2026 502 9100 S node app.js LINGER_NATIVE_PROCESS_LEASE=${lease}`,
        lease,
        502,
        9101,
      ),
    ).toBeUndefined();
  });
});
