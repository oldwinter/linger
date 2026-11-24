import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import {
  createWindowsPrivateClient,
  windowsPrivatePath,
  windowsPrivateRefusal,
  WINDOWS_PRIVATE_PATH_UNSAFE,
  WINDOWS_PRIVATE_SCRIPT,
  WINDOWS_PRIVATE_WORKER_SCRIPT,
} from "./windows-private.js";
it("sends paths through stdin and launches a fixed PowerShell command", async () => {
  const run = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  await windowsPrivatePath(
    "C:\\Users\\person\\private's",
    "directory",
    true,
    run,
  );
  expect(run.mock.calls[0]![1]).toEqual([
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    WINDOWS_PRIVATE_SCRIPT,
  ]);
  expect(JSON.parse(run.mock.calls[0]![2].input)).toEqual({
    path: path.resolve("C:\\Users\\person\\private's"),
    kind: "directory",
    repair: true,
  });
  expect(WINDOWS_PRIVATE_SCRIPT).toContain("[Console]::InputEncoding");
  expect(WINDOWS_PRIVATE_SCRIPT).toContain("ReparsePoint");
  expect(WINDOWS_PRIVATE_SCRIPT).toContain("GetCurrent().User");
  expect(WINDOWS_PRIVATE_SCRIPT).toContain("AccessControlSections]::Access");
});
it("fails closed without disclosing command diagnostics", async () => {
  const run = vi
    .fn()
    .mockResolvedValue({ code: 1, stdout: "", stderr: "sensitive path" });
  const error = await windowsPrivatePath("private", "file", false, run).catch(
    (failure: unknown) => failure as Error,
  );
  expect(error?.message).toMatch(/^Windows private path validation failed/);
  expect(error?.message).not.toContain("sensitive");
  expect(error).toMatchObject({
    code: "WINDOWS_PRIVATE_PATH_UNSAFE",
    reason: "UNCHECKED",
  });
});
it("names the path and why it is not private", async () => {
  const file =
    "C:\\Users\\person\\.simplexai\\instances\\desktop\\native.env.1.tmp";
  const owned = vi
    .fn()
    .mockResolvedValue({ code: 1, stdout: "UNSAFE_OWNER", stderr: "" });
  const error = await windowsPrivatePath(file, "file", false, owned).catch(
    (failure: unknown) => failure as Error,
  );
  expect(error).toMatchObject({
    code: "WINDOWS_PRIVATE_PATH_UNSAFE",
    reason: "UNSAFE_OWNER",
    path: path.resolve(file),
  });
  expect(error?.message).toContain(path.resolve(file));
  expect(error?.message).toContain("owned by another account");
  // Only the script's fixed codes pass; anything else is unchecked.
  const other = vi.fn().mockResolvedValue({
    code: 1,
    stdout: "Access denied to C:\\x",
    stderr: "",
  });
  await expect(
    windowsPrivatePath(file, "file", false, other),
  ).rejects.toMatchObject({ reason: "UNCHECKED" });
});
it("gives every failure in the ACL program a fixed reason code", () => {
  const thrown = [...WINDOWS_PRIVATE_SCRIPT.matchAll(/throw '([^']*)'/g)].map(
    (match) => match[1],
  );
  expect(thrown.length).toBeGreaterThan(5);
  for (const code of thrown) expect(code).toMatch(/^[A-Z][A-Z_]+$/);
});
it("ignores inherit-only ACEs only for effective ancestor permissions", () => {
  const ancestors = WINDOWS_PRIVATE_SCRIPT.slice(
    WINDOWS_PRIVATE_SCRIPT.indexOf("while ($parent)"),
    WINDOWS_PRIVATE_SCRIPT.indexOf("if ($request.repair)"),
  );
  const target = WINDOWS_PRIVATE_SCRIPT.slice(
    WINDOWS_PRIVATE_SCRIPT.indexOf("$currentAllowed = $false"),
  );
  expect(ancestors).toContain(
    "$rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly",
  );
  expect(target).not.toContain("PropagationFlags");
  expect(target).toContain("SHARED_ACCESS");
  expect(WINDOWS_PRIVATE_SCRIPT).toContain(
    "$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')",
  );
  expect(WINDOWS_PRIVATE_WORKER_SCRIPT).toContain(
    "$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')",
  );
  expect(WINDOWS_PRIVATE_WORKER_SCRIPT).toContain("ReparsePoint");
  expect(WINDOWS_PRIVATE_WORKER_SCRIPT).toContain("SHARED_ACCESS");
  expect(WINDOWS_PRIVATE_WORKER_SCRIPT).toContain("Test-Administrator");
  expect(WINDOWS_PRIVATE_WORKER_SCRIPT).toContain(
    "if (-not ('LingerLinkedToken' -as [type]))",
  );
  expect(WINDOWS_PRIVATE_WORKER_SCRIPT).toContain("$script:isAdministrator");
  expect(WINDOWS_PRIVATE_WORKER_SCRIPT).toContain(
    "$replace = 'DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'",
  );
});
it("hands on the code and reason of a refusal, and nothing else", async () => {
  const run = vi.fn().mockResolvedValue({
    code: 1,
    stdout: "UNSAFE_PARENT_ACCESS",
    stderr: "",
  });
  const error: unknown = await windowsPrivatePath(
    "D:\\Apps\\Linger",
    "directory",
    true,
    run,
  ).catch((error: unknown) => error);
  const refusal = {
    code: WINDOWS_PRIVATE_PATH_UNSAFE,
    reason: "UNSAFE_PARENT_ACCESS",
  };
  expect(windowsPrivateRefusal(error)).toEqual(refusal);
  // The copy another process receives as JSON reads the same.
  expect(windowsPrivateRefusal(JSON.parse(JSON.stringify(refusal)))).toEqual(
    refusal,
  );
  for (const other of [
    undefined,
    "UNSAFE_PARENT_ACCESS",
    new Error("is inside a folder"),
    { code: "EACCES", reason: "UNSAFE_PARENT_ACCESS" },
    { code: WINDOWS_PRIVATE_PATH_UNSAFE, reason: "SOMETHING_ELSE" },
    { code: WINDOWS_PRIVATE_PATH_UNSAFE, reason: "toString" },
  ])
    expect(windowsPrivateRefusal(other)).toBeUndefined();
});

function fakeWorker(
  onLine: (line: string, stdout: PassThrough, emitClose: () => void) => void,
) {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let killed = false;
  let ended = false;
  let buffer = "";
  stdin.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      onLine(line, stdout, () => emitter.emit("close"));
    }
  });
  stdin.on("finish", () => {
    ended = true;
  });
  return {
    child: {
      stdin,
      stdout,
      kill: () => {
        killed = true;
      },
      on: (event: "close" | "error", listener: () => void) =>
        emitter.on(event, listener),
    },
    wasKilled: () => killed,
    wasEnded: () => ended,
  };
}

it("reuses one persistent worker across concurrent requests and respawns cleanly after failures", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const workers: Array<ReturnType<typeof fakeWorker>> = [];
  let count = 0;
  const client = createWindowsPrivateClient({
    idleMs: 10_000,
    timeoutMs: 200,
    spawnWorker: () => {
      const id = ++count;
      const w = fakeWorker((line, stdout, emitClose) => {
        const req = JSON.parse(line) as { path: string };
        if (req.path === "ok-1" || req.path === "ok-2")
          stdout.write("__LINGER_ACL_OK__\n");
        else if (req.path === "bad-owner")
          stdout.write("__LINGER_ACL_ERR__:UNSAFE_OWNER\n");
        else if (req.path === "crash") emitClose();
        else if (req.path === "desync") stdout.write("unexpected output\n");
        else if (req.path === "hang" && id > 0) {
          // Intentionally never replies so the request timeout fires.
        }
      });
      workers.push(w);
      return w.child;
    },
  });
  try {
    const [r1, r2, r3] = await Promise.all([
      client.execute(JSON.stringify({ path: "ok-1" })),
      client.execute(JSON.stringify({ path: "ok-2" })),
      client.execute(JSON.stringify({ path: "bad-owner" })),
    ]);
    expect(r1).toEqual({ code: 0, stdout: "" });
    expect(r2).toEqual({ code: 0, stdout: "" });
    expect(r3).toEqual({ code: 1, stdout: "UNSAFE_OWNER" });
    expect(workers).toHaveLength(1);

    // Unexpected close fails closed and respawns on the next request.
    expect(await client.execute(JSON.stringify({ path: "crash" }))).toEqual({
      code: 1,
      stdout: "",
    });
    expect(await client.execute(JSON.stringify({ path: "ok-1" }))).toEqual({
      code: 0,
      stdout: "",
    });
    expect(workers).toHaveLength(2);

    // Unexpected stdout kills the worker and fails closed.
    expect(await client.execute(JSON.stringify({ path: "desync" }))).toEqual({
      code: 1,
      stdout: "",
    });
    expect(workers[1]!.wasKilled()).toBe(true);

    // Timeout kills a hung worker and fails closed.
    const timedOut = client.execute(JSON.stringify({ path: "hang" }));
    await vi.advanceTimersByTimeAsync(200);
    expect(await timedOut).toEqual({
      code: 1,
      stdout: "",
    });
    expect(workers[2]!.wasKilled()).toBe(true);
  } finally {
    client.close();
    vi.useRealTimers();
  }
});

it("closes an idle persistent worker after the idle period", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const workers: Array<ReturnType<typeof fakeWorker>> = [];
  const client = createWindowsPrivateClient({
    idleMs: 30,
    spawnWorker: () => {
      const w = fakeWorker((_line, stdout) => {
        stdout.write("__LINGER_ACL_OK__\n");
      });
      workers.push(w);
      return w.child;
    },
  });
  try {
    expect(await client.execute(JSON.stringify({ path: "ok" }))).toEqual({
      code: 0,
      stdout: "",
    });
    await vi.advanceTimersByTimeAsync(30);
    expect(workers[0]!.wasEnded()).toBe(true);
  } finally {
    client.close();
    vi.useRealTimers();
  }
});
