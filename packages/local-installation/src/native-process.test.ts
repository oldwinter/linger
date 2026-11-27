import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const failure = vi.hoisted(() => ({ file: "" }));
vi.mock("./instance.js", async (original) => {
  const actual = await original<typeof import("./instance.js")>();
  return {
    ...actual,
    atomicPrivate: async (file: string, contents: string) => {
      if (file === failure.file) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        throw new Error("fixture persistence failed");
      }
      return actual.atomicPrivate(file, contents);
    },
  };
});
import { test as base, vi, type TestContext } from "vitest";
import {
  NATIVE_PROCESS_IDENTITY_UNVERIFIED,
  NATIVE_PROCESS_REPLACED,
  foldersInUse,
  nativeConfigurationChanged,
  nativeSupervisorsStale,
  startNativeProcess,
  inspectNativeProcess,
  reclaimNativeOrphans,
  stopNativeProcess,
} from "./native-process.js";

// Every test owns a separate process tree. Run Windows trees in sequence
// because each inspection reads the same system-wide process inventory.
const windows = process.platform === "win32";
const test = windows ? base : base.concurrent;
const posix = windows ? test.skip : test;
const win32 = windows ? test : test.skip;
vi.setConfig({
  testTimeout: windows ? 60_000 : 30_000,
  hookTimeout: 60_000,
  expect: { poll: { timeout: 15_000 } },
});
async function fixture({ onTestFinished }: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "native-process-"));
  onTestFinished(async () => {
    // Supervisors outlive the test process by design, so a cleanup that gives
    // up leaks them for good: escalate at once instead of the production wait,
    // then end whatever still runs from this root.
    for (const name of [
      "web",
      "teamhub",
      "node-services",
      "livekit",
      "postgres",
    ] as const)
      await stopNativeProcess(root, name, 300).catch(() => {});
    if (windows) {
      await reclaimNativeOrphans(root, { ports: [], paths: [] });
    } else {
      try {
        execFileSync("pkill", ["-KILL", "-f", root]);
      } catch {
        // pkill exits 1 when nothing matched.
      }
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  });
  return root;
}
/** Gone or a zombie; Linux reads /proc so the check cannot pass when ps is absent. */
function exited(pid: number): boolean {
  try {
    const state =
      process.platform === "linux"
        ? readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /s, "")
        : execFileSync("/bin/ps", ["-p", String(pid), "-o", "stat="], {
            encoding: "utf8",
          });
    return state.trim().startsWith("Z");
  } catch {
    return true;
  }
}
test("retains an owned service after launch and reuses its identity", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  const options = {
    root,
    name: "web" as const,
    executable: process.execPath,
    args: [
      "-e",
      "console.log('native fixture ready');setInterval(()=>{},1000)",
    ],
    cwd: root,
    env: process.env,
  };
  const first = await startNativeProcess(options);
  expect(first.running).toBe(true);
  const second = await startNativeProcess(options);
  expect(second.pid).toBe(first.pid);
  expect((await inspectNativeProcess(root, "web")).running).toBe(true);
  await expect
    .poll(async () => readFile(path.join(root, "native/logs/web.log"), "utf8"))
    .toContain("native fixture ready");
  await stopNativeProcess(root, "web");
  expect((await inspectNativeProcess(root, "web")).running).toBe(false);
  expect(
    await readFile(path.join(root, "native/logs/web.log"), "utf8"),
  ).toContain("native fixture ready");
});
win32(
  "starts a service from a token with Administrators disabled",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const args = ["a b", "", 'say "hi"', "C:\\dir with space\\", "trailing\\"];
    // The service reports the arguments it received and whether its token
    // holds Administrators; an elevated test run proves the group is gone.
    const report = [
      "const ps=require('node:path').win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');",
      "const role='([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';",
      "const administrator=require('node:child_process').execFileSync(ps,['-NoProfile','-NonInteractive','-Command',role],{encoding:'utf8'}).trim();",
      "console.log(JSON.stringify({args:process.argv.slice(1),administrator}));",
      "setInterval(()=>{},1000);",
    ].join("");
    await startNativeProcess({
      root,
      name: "web",
      executable: process.execPath,
      args: ["-e", report, ...args],
      cwd: root,
      env: process.env,
      withoutAdministrators: true,
    });
    await expect
      .poll(
        async () => readFile(path.join(root, "native/logs/web.log"), "utf8"),
        { timeout: 45_000 },
      )
      .toContain(JSON.stringify({ args, administrator: "False" }));
    expect((await inspectNativeProcess(root, "web")).running).toBe(true);
    await stopNativeProcess(root, "web");
    expect((await inspectNativeProcess(root, "web")).running).toBe(false);
  },
);
test("refuses to signal a PID whose recorded lease differs", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  const options = {
    root,
    name: "web" as const,
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    cwd: root,
    env: process.env,
  };
  const processState = await startNativeProcess(options);
  const file = path.join(root, "native/processes/web.json");
  const original = await readFile(file, "utf8");
  const altered = JSON.parse(original);
  altered.lease = "0".repeat(64);
  await writeFile(file, JSON.stringify(altered), { mode: 0o600 });
  expect((await inspectNativeProcess(root, "web")).running).toBe(false);
  await expect(stopNativeProcess(root, "web")).rejects.toMatchObject({
    code:
      process.platform === "win32"
        ? NATIVE_PROCESS_IDENTITY_UNVERIFIED
        : NATIVE_PROCESS_REPLACED,
  });
  await expect(startNativeProcess(options)).rejects.toThrow(/identity/i);
  expect(() => process.kill(processState.pid!, 0)).not.toThrow();
  await writeFile(file, original, { mode: 0o600 });
});
test("rejects changed service configuration instead of leaking a duplicate", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  const options = {
    root,
    name: "teamhub" as const,
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    cwd: root,
    env: process.env,
  };
  await startNativeProcess(options);
  await expect(
    startNativeProcess({ ...options, args: ["-e", "process.exit(0)"] }),
  ).rejects.toThrow(/configuration/i);
  // Generated settings, such as a changed user.env, count as configuration.
  await expect(
    startNativeProcess({ ...options, settings: '{"XAI_API_KEY":"new"}' }),
  ).rejects.toThrow(/configuration/i);
});

test("restarts a service whose settings changed, keeps one whose did not", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  const options = {
    root,
    name: "teamhub" as const,
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    cwd: root,
    env: process.env,
    restartOnConfigurationChange: true,
  };
  const first = await startNativeProcess(options);
  expect((await startNativeProcess(options)).pid).toBe(first.pid);
  const second = await startNativeProcess({ ...options, settings: "voice-1" });
  expect(second.pid).not.toBe(first.pid);
  expect(
    (await startNativeProcess({ ...options, settings: "voice-1" })).pid,
  ).toBe(second.pid);
  expect((await startNativeProcess(options)).pid).not.toBe(second.pid);
});
test("redacts complete lines before persisting split writes and known secrets", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  await startNativeProcess({
    root,
    name: "web",
    executable: process.execPath,
    args: [
      "-e",
      "process.stdout.write('generated-');setTimeout(()=>console.log('opaque-secret'),40);console.error(process.env.PGPASSWORD);setInterval(()=>{},1000)",
    ],
    cwd: root,
    env: { ...process.env, PGPASSWORD: "bare-private-value" },
    redactions: ["generated-opaque-secret"],
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const log = await readFile(path.join(root, "native/logs/web.log"), "utf8");
  expect(log).not.toContain("generated-");
  expect(log).not.toContain("opaque-secret");
  expect(log).not.toContain("bare-private-value");
  expect(log).toContain("[REDACTED]");
});

posix(
  "stops descendants that ignore SIGINT after the service leader exits",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const childCode =
      "process.on('SIGINT',()=>{});console.log('descendant-ready');setInterval(()=>{},1000)";
    await startNativeProcess({
      root,
      name: "web",
      executable: process.execPath,
      args: [
        "-e",
        `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});fs.writeFileSync('descendant.pid',String(c.pid));process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)`,
      ],
      cwd: root,
      env: process.env,
    });
    await expect
      .poll(async () =>
        readFile(path.join(root, "native/logs/web.log"), "utf8"),
      )
      .toContain("descendant-ready");
    const pid = Number(
      await readFile(path.join(root, "descendant.pid"), "utf8"),
    );
    // The descendant ignores SIGINT, so only the SIGKILL escalation ends it;
    // a short interrupt window reaches it without the production wait.
    await stopNativeProcess(root, "web", 300);
    await expect.poll(() => exited(pid)).toBe(true);
  },
);

posix(
  "replaces a service whose supervisor was killed with the app",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const options = {
      root,
      name: "web" as const,
      executable: process.execPath,
      args: [
        "-e",
        "require('node:fs').writeFileSync('service.pid',String(process.pid));setInterval(()=>{},1000)",
      ],
      cwd: root,
      env: process.env,
    };
    const first = await startNativeProcess(options);
    await expect
      .poll(async () =>
        readFile(path.join(root, "service.pid"), "utf8").catch(() => ""),
      )
      .not.toBe("");
    const orphan = Number(
      await readFile(path.join(root, "service.pid"), "utf8"),
    );
    await rm(path.join(root, "service.pid"));
    process.kill(first.pid!, "SIGKILL");
    await expect.poll(() => exited(first.pid!)).toBe(true);
    expect(exited(orphan)).toBe(false);

    const second = await startNativeProcess(options);
    expect(second.pid).not.toBe(first.pid);
    await expect.poll(() => exited(orphan)).toBe(true);
    expect((await inspectNativeProcess(root, "web")).running).toBe(true);
  },
);

posix(
  "reclaims a service an earlier attempt left under a lease no record holds",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const service = (name: "web" | "teamhub") => ({
      root,
      name,
      executable: process.execPath,
      args: [
        "-e",
        `require('node:fs').writeFileSync('${name}.pid',String(process.pid));setInterval(()=>{},1000)`,
      ],
      cwd: root,
      env: process.env,
    });
    const lost = await startNativeProcess(service("web"));
    const kept = await startNativeProcess(service("teamhub"));
    const pid = async (name: string) =>
      Number(await readFile(path.join(root, `${name}.pid`), "utf8"));
    await expect.poll(() => pid("web").catch(() => 0)).not.toBe(0);
    await expect.poll(() => pid("teamhub").catch(() => 0)).not.toBe(0);
    // The attempt that started it failed before its record was kept.
    await rm(path.join(root, "native/processes/web.json"));
    const ended = await reclaimNativeOrphans(root, { ports: [], paths: [] });
    expect(ended).toContain(lost.pid);
    await expect.poll(async () => exited(await pid("web"))).toBe(true);
    expect(exited(lost.pid!)).toBe(true);
    expect(exited(kept.pid!)).toBe(false);
    expect(exited(await pid("teamhub"))).toBe(false);
  },
);

test("cleans launched owned processes when identity persistence fails", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  failure.file = path.join(root, "native/processes/web.json");
  try {
    await expect(
      startNativeProcess({
        root,
        name: "web",
        executable: process.execPath,
        args: [
          "-e",
          "require('node:fs').writeFileSync('launched.pid',String(process.pid));setInterval(()=>{},1000)",
        ],
        cwd: root,
        env: process.env,
      }),
    ).rejects.toThrow("fixture persistence failed");
    const files = await readFile(path.join(root, "launched.pid"), "utf8");
    if (files)
      await expect
        .poll(() => {
          try {
            process.kill(Number(files), 0);
            return false;
          } catch {
            return true;
          }
        })
        .toBe(true);
  } finally {
    failure.file = "";
  }
});

test("bundled entry resolves its packaged worker and survives caller exit", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  const app = fileURLToPath(
    new URL("../../../apps/linger-installer/", import.meta.url),
  );
  const { build } = createRequire(path.join(app, "package.json"))(
    "esbuild",
  ) as { build: (options: Record<string, unknown>) => Promise<void> };
  const entry = path.join(root, "entry.mjs");
  await writeFile(
    entry,
    `import {startNativeProcess} from ${JSON.stringify(fileURLToPath(new URL("./native-process.ts", import.meta.url)))};await startNativeProcess({root:${JSON.stringify(root)},name:'web',executable:process.execPath,args:['-e',"console.log('packaged-ready');setInterval(()=>{},1000)"],cwd:${JSON.stringify(root)},env:process.env});`,
  );
  for (const [source, outfile] of [
    [entry, path.join(root, "packaged.mjs")],
    [
      fileURLToPath(new URL("./native-process-worker.mjs", import.meta.url)),
      path.join(root, "native-process-worker.mjs"),
    ],
  ])
    await build({
      entryPoints: [source],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node26",
    });
  const caller = spawn(process.execPath, [path.join(root, "packaged.mjs")], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  caller.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  expect(
    await new Promise((resolve) => caller.once("close", resolve)),
    stderr,
  ).toBe(0);
  expect((await inspectNativeProcess(root, "web")).running).toBe(true);
  await expect
    .poll(async () => readFile(path.join(root, "native/logs/web.log"), "utf8"))
    .toContain("packaged-ready");
});

test.for(["ENOSPC", "EIO"])(
  "retains ownership after log writes fail with %s",
  async (code, context) => {
    const { expect } = context;
    const root = await fixture(context);
    const app = fileURLToPath(
      new URL("../../../apps/linger-installer/", import.meta.url),
    );
    const { build } = createRequire(path.join(app, "package.json"))(
      "esbuild",
    ) as {
      build: (options: Record<string, unknown>) => Promise<void>;
    };
    for (const [source, output] of [
      ["native-process.ts", "core.mjs"],
      ["native-process-worker.mjs", "worker-implementation.mjs"],
    ] as const)
      await build({
        entryPoints: [fileURLToPath(new URL(source, import.meta.url))],
        outfile: path.join(root, output),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node26",
      });
    // Inject only the OS write error. The supervisor, service, identity checks,
    // detached process group, and shutdown below all run in real processes.
    await writeFile(
      path.join(root, "native-process-worker.mjs"),
      `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    fs.writeSync = () => { throw Object.assign(new Error('fixture I/O failure'), {code: ${JSON.stringify(code)}}); };
    syncBuiltinESMExports();
    await import('./worker-implementation.mjs');
  `,
    );
    const core = (await import(
      path.join(root, "core.mjs")
    )) as typeof import("./native-process.js");
    try {
      const owner = await core.startNativeProcess({
        root,
        name: "web",
        executable: process.execPath,
        cwd: root,
        env: process.env,
        args: [
          "-e",
          "require('node:fs').writeFileSync('service.pid',String(process.pid));setInterval(()=>console.log('token=private-fixture-value'),20)",
        ],
      });
      await expect
        .poll(async () => readFile(path.join(root, "service.pid"), "utf8"))
        .toMatch(/^\d+$/);
      const service = Number(
        await readFile(path.join(root, "service.pid"), "utf8"),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect((await core.inspectNativeProcess(root, "web")).running).toBe(true);
      expect(() => process.kill(service, 0)).not.toThrow();
      expect(
        await readFile(path.join(root, "native/logs/web.log"), "utf8"),
      ).toBe("");
      await core.stopNativeProcess(root, "web");
      expect((await core.inspectNativeProcess(root, "web")).running).toBe(
        false,
      );
      expect(() => process.kill(owner.pid!, 0)).toThrow();
      expect(() => process.kill(service, 0)).toThrow();
    } finally {
      // Keep the group escape hatch for POSIX; the fixture cleans Windows by lease.
      const record = await readFile(
        path.join(root, "native/processes/web.json"),
        "utf8",
      ).catch(() => "");
      if (!windows && record) {
        try {
          process.kill(-JSON.parse(record).pid, "SIGKILL");
        } catch {
          /* Gone. */
        }
      }
    }
  },
);

posix.for([false, true])(
  "stops leased orphan descendants across groups (owner killed: %s)",
  async (killOwner, context) => {
    const { expect } = context;
    const root = await fixture(context);
    let orphan: number | undefined;
    const unrelated = spawn(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { detached: true, stdio: "ignore" },
    );
    unrelated.unref();
    try {
      const owner = await startNativeProcess({
        root,
        name: "web",
        executable: process.execPath,
        cwd: root,
        env: process.env,
        args: [
          "-e",
          `
        const {spawn} = require('node:child_process');
        const child = spawn(process.execPath, ['-e', "process.on('SIGINT',()=>{});require('node:fs').writeFileSync('orphan.pid',String(process.pid));setInterval(()=>{},1000)"], {detached:true,stdio:'ignore'});
        child.unref();
      `,
        ],
      });
      await expect
        .poll(async () => readFile(path.join(root, "orphan.pid"), "utf8"))
        .toMatch(/^\d+$/);
      orphan = Number(await readFile(path.join(root, "orphan.pid"), "utf8"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await inspectNativeProcess(root, "web")).running).toBe(true);
      if (killOwner) {
        process.kill(owner.pid!, "SIGKILL");
        await expect
          .poll(async () => (await inspectNativeProcess(root, "web")).running)
          .toBe(false);
      }
      // The orphan ignores SIGINT; only the SIGKILL escalation ends it.
      await stopNativeProcess(root, "web", 300);
      expect((await inspectNativeProcess(root, "web")).running).toBe(false);
      await expect.poll(() => exited(orphan!)).toBe(true);
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    } finally {
      unrelated.kill("SIGKILL");
      if (orphan) {
        try {
          process.kill(orphan, "SIGKILL");
        } catch {
          /* Gone. */
        }
      }
    }
  },
);
test("adopts a running service across executable cache layouts for the same archive", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  const original = {
    root,
    name: "teamhub" as const,
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    cwd: root,
    env: process.env,
  };
  const running = await startNativeProcess(original);
  const upgraded = {
    ...original,
    executable: path.join(root, "new-cache", path.basename(process.execPath)),
    configurationExecutable: original.executable,
  };
  expect(await nativeConfigurationChanged(upgraded)).toBe(false);
  expect((await startNativeProcess(upgraded)).pid).toBe(running.pid);
  expect(
    await nativeConfigurationChanged({
      ...upgraded,
      configurationExecutable: "another-archive",
    }),
  ).toBe(true);
});
test("reports a configuration change only for a running recorded process", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  const options = {
    root,
    name: "teamhub" as const,
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    cwd: root,
    env: process.env,
    settings: "first",
  };
  expect(await nativeConfigurationChanged(options)).toBe(false);
  await startNativeProcess(options);
  expect(await nativeConfigurationChanged(options)).toBe(false);
  expect(
    await nativeConfigurationChanged({ ...options, settings: "second" }),
  ).toBe(true);
  await stopNativeProcess(root, "teamhub");
  expect(
    await nativeConfigurationChanged({ ...options, settings: "second" }),
  ).toBe(false);
});

posix(
  "detached native supervisor and service do not inherit a parent listening TCP socket or file FD",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const leakedFilePath = path.join(root, "v8_context_snapshot.bin");
    const leakedFileFd = openSync(leakedFilePath, "w");
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    let closedLeaked = false;
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected TCP address");
      const port = address.port;
      const listenFd = (server as unknown as { _handle?: { fd?: number } })
        ._handle?.fd;
      expect(typeof listenFd).toBe("number");
      const socketInode =
        process.platform === "linux"
          ? await readlink(`/proc/self/fd/${listenFd}`)
          : undefined;

      const app = fileURLToPath(
        new URL("../../../apps/linger-installer/", import.meta.url),
      );
      const { build } = createRequire(path.join(app, "package.json"))(
        "esbuild",
      ) as { build: (options: Record<string, unknown>) => Promise<void> };
      const entry = path.join(root, "launch-with-socket.entry.mjs");
      const launcher = path.join(root, "launch-with-socket.mjs");
      const nativeProcessModule = fileURLToPath(
        new URL("./native-process.ts", import.meta.url),
      );
      const serviceScript = `
        const fs = require("node:fs");
        const isOpen = (fd) => { try { fs.fstatSync(fd); return true; } catch { return false; } };
        fs.writeFileSync("service.json", JSON.stringify({
          pid: process.pid,
          fd67: isOpen(67),
          fd68: isOpen(68),
        }));
        setInterval(() => {}, 1000);
      `;
      await writeFile(
        entry,
        `
          import { writeFileSync } from "node:fs";
          import { startNativeProcess } from ${JSON.stringify(nativeProcessModule)};
          const state = await startNativeProcess({
            root: ${JSON.stringify(root)},
            name: "web",
            executable: process.execPath,
            args: ["-e", ${JSON.stringify(serviceScript)}],
            cwd: ${JSON.stringify(root)},
            env: process.env,
          });
          writeFileSync(${JSON.stringify(path.join(root, "supervisor.pid"))}, String(state.pid));
        `,
      );
      for (const [source, outfile] of [
        [entry, launcher],
        [
          fileURLToPath(
            new URL("./native-process-worker.mjs", import.meta.url),
          ),
          path.join(root, "native-process-worker.mjs"),
        ],
      ])
        await build({
          entryPoints: [source],
          outfile,
          bundle: true,
          platform: "node",
          format: "esm",
          target: "node26",
        });

      const stdio: Array<"ignore" | "pipe" | number> = [
        "ignore",
        "ignore",
        "pipe",
      ];
      while (stdio.length < 69) stdio.push("ignore");
      stdio[5] = listenFd!;
      stdio[67] = listenFd!;
      stdio[68] = leakedFileFd;

      let stderr = "";
      const parent = spawn(process.execPath, [launcher], { stdio });
      parent.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      expect(
        await new Promise<number | null>((resolve) =>
          parent.once("close", resolve),
        ),
        stderr,
      ).toBe(0);

      // Close the original listener and file in this test process while the
      // detached supervisor and service remain alive.
      closeSync(leakedFileFd);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      closedLeaked = true;

      await expect
        .poll(async () =>
          readFile(path.join(root, "service.json"), "utf8").catch(() => ""),
        )
        .toContain('"pid"');
      const supervisorPid = Number(
        await readFile(path.join(root, "supervisor.pid"), "utf8"),
      );
      const serviceInfo = JSON.parse(
        await readFile(path.join(root, "service.json"), "utf8"),
      ) as { pid: number; fd67: boolean; fd68: boolean };
      expect(serviceInfo.fd67).toBe(false);
      expect(serviceInfo.fd68).toBe(false);
      expect((await inspectNativeProcess(root, "web")).running).toBe(true);

      // On Linux, also confirm neither the detached supervisor nor the service
      // child holds the parent's listening socket inode on any FD.
      if (process.platform === "linux" && socketInode) {
        for (const pid of [supervisorPid, serviceInfo.pid]) {
          const fds = await readdir(`/proc/${pid}/fd`);
          const targets = await Promise.all(
            fds.map((fd) => readlink(`/proc/${pid}/fd/${fd}`).catch(() => "")),
          );
          expect(targets).not.toContain(socketInode);
        }
      }

      // Rebinding the exact same port immediately proves no detached process
      // kept the listening socket alive.
      const rebound = net.createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          rebound.once("error", reject);
          rebound.listen(port, "127.0.0.1", () => resolve());
        });
      } finally {
        await new Promise<void>((resolve) => rebound.close(() => resolve()));
      }
    } finally {
      if (!closedLeaked) {
        closeSync(leakedFileFd);
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  },
);

const fastRestart = {
  delaysMs: [100, 200],
  windowMs: 10_000,
  limit: 3,
  armAfterMs: 300,
};
const webLog = (root: string) =>
  readFile(path.join(root, "native/logs/web.log"), "utf8").catch(() => "");
const supervisorLines = async (root: string) =>
  (await webLog(root))
    .split("\n")
    .filter((line) => line.startsWith("[linger-supervisor] web "));
test("restarts a supervised service that exits unasked and logs each exit", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  // The first run kills itself once it has run long enough to count as up;
  // the restarted one stays.
  const state = await startNativeProcess({
    root,
    name: "web",
    executable: process.execPath,
    args: [
      "-e",
      "const fs=require('node:fs');const first=!fs.existsSync('ran');fs.writeFileSync('ran','');console.log('service-up');if(first)setTimeout(()=>process.kill(process.pid,'SIGKILL'),500);setInterval(()=>{},1000)",
    ],
    cwd: root,
    env: process.env,
    restartOnExit: fastRestart,
  });
  await expect
    .poll(() => supervisorLines(root))
    .toEqual([
      expect.stringMatching(/^\[linger-supervisor\] web started pid=\d+$/),
      expect.stringMatching(
        /^\[linger-supervisor\] web exited code=null signal=SIGKILL uptime_ms=\d+ restarting_in_ms=100$/,
      ),
      expect.stringMatching(
        /^\[linger-supervisor\] web restarted pid=\d+ attempt=1$/,
      ),
    ]);
  await expect
    .poll(async () => (await webLog(root)).match(/service-up/g)?.length)
    .toBe(2);
  // The supervisor, and so the record, stays the same.
  expect(await inspectNativeProcess(root, "web")).toEqual({
    running: true,
    pid: state.pid,
  });
  await stopNativeProcess(root, "web");
  expect((await inspectNativeProcess(root, "web")).running).toBe(false);
  expect((await supervisorLines(root)).at(-1)).toMatch(
    /^\[linger-supervisor\] web exited code=\S+ signal=\S+ uptime_ms=\d+ restart=no reason=stop_requested$/,
  );
  expect(await readdir(path.join(root, "native/processes"))).toEqual([]);
});
test("never restarts a service an intended stop ends", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  await startNativeProcess({
    root,
    name: "web",
    executable: process.execPath,
    args: [
      "-e",
      "process.on('SIGINT',()=>process.exit(0));console.log('service-up');setInterval(()=>{},1000)",
    ],
    cwd: root,
    env: process.env,
    restartOnExit: { ...fastRestart, armAfterMs: 0 },
  });
  // Stop only once the service handles SIGINT, so it exits on its own.
  await expect.poll(() => webLog(root)).toContain("service-up");
  await stopNativeProcess(root, "web");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const lines = await supervisorLines(root);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toMatch(
    /^\[linger-supervisor\] web exited code=0 signal=null uptime_ms=\d+ restart=no reason=stop_requested$/,
  );
  expect((await inspectNativeProcess(root, "web")).running).toBe(false);
});
test("a stop during the restart delay ends the supervisor without a restart", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  await startNativeProcess({
    root,
    name: "web",
    executable: process.execPath,
    args: ["-e", "setTimeout(()=>process.exit(1),400)"],
    cwd: root,
    env: process.env,
    restartOnExit: { ...fastRestart, delaysMs: [3_000] },
  });
  await expect
    .poll(async () => (await supervisorLines(root)).at(-1))
    .toMatch(/restarting_in_ms=3000$/);
  await stopNativeProcess(root, "web");
  expect((await inspectNativeProcess(root, "web")).running).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  expect((await supervisorLines(root)).join("\n")).not.toContain("restarted");
});
test("gives up after the crash-loop limit and leaves the service stopped", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  await startNativeProcess({
    root,
    name: "web",
    executable: process.execPath,
    args: ["-e", "setTimeout(()=>process.exit(3),400)"],
    cwd: root,
    env: process.env,
    restartOnExit: fastRestart,
  });
  await expect
    .poll(() => inspectNativeProcess(root, "web"))
    .toMatchObject({ running: false });
  const lines = await supervisorLines(root);
  expect(lines.filter((line) => line.includes(" exited "))).toEqual([
    expect.stringMatching(
      /code=3 signal=null uptime_ms=\d+ restarting_in_ms=100$/,
    ),
    expect.stringMatching(
      /code=3 signal=null uptime_ms=\d+ restarting_in_ms=200$/,
    ),
    expect.stringMatching(
      /code=3 signal=null uptime_ms=\d+ restart=no reason=crash_loop$/,
    ),
  ]);
  expect(lines.at(-1)).toBe(
    "[linger-supervisor] web gave up restarting after 3 exits within 10000 ms",
  );
});
test.for([
  ["startup", fastRestart],
  ["not_supervised", undefined],
] as const)(
  "logs an exit it does not restart (%s)",
  async ([reason, restartOnExit], context) => {
    const { expect } = context;
    const root = await fixture(context);
    await startNativeProcess({
      root,
      name: "web",
      executable: process.execPath,
      args: ["-e", "setTimeout(()=>process.exit(2),50)"],
      cwd: root,
      env: process.env,
      ...(restartOnExit ? { restartOnExit } : {}),
    });
    await expect
      .poll(() => inspectNativeProcess(root, "web"))
      .toMatchObject({ running: false });
    expect((await supervisorLines(root)).at(-1)).toMatch(
      new RegExp(
        `^\\[linger-supervisor\\] web exited code=2 signal=null uptime_ms=\\d+ restart=no reason=${reason}$`,
      ),
    );
  },
);
posix("names the folders a running process starts from", async (context) => {
  const { expect } = context;
  const root = await fixture(context);
  const used = path.join(root, "used");
  const unused = path.join(root, "unused");
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)", path.join(used, "server.mjs")],
    { stdio: "ignore" },
  );
  context.onTestFinished(() => {
    child.kill("SIGKILL");
  });
  await new Promise((resolve) => child.once("spawn", resolve));
  expect(await foldersInUse([used, unused, `${used}-other`])).toEqual(
    new Set([used]),
  );
});

async function bundleSupervisorFolder(folder: string, workerSuffix = "") {
  await mkdir(folder, { recursive: true });
  const app = fileURLToPath(
    new URL("../../../apps/linger-installer/", import.meta.url),
  );
  const { build } = createRequire(path.join(app, "package.json"))(
    "esbuild",
  ) as {
    build: (options: Record<string, unknown>) => Promise<void>;
  };
  const corePath = path.join(folder, "core.mjs");
  const workerPath = path.join(folder, "native-process-worker.mjs");
  for (const [source, outfile] of [
    [fileURLToPath(new URL("./native-process.ts", import.meta.url)), corePath],
    [
      fileURLToPath(new URL("./native-process-worker.mjs", import.meta.url)),
      workerPath,
    ],
  ])
    await build({
      entryPoints: [source],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node26",
    });
  if (workerSuffix) {
    const original = await readFile(workerPath, "utf8");
    await writeFile(workerPath, `${original}\n${workerSuffix}\n`);
  }
  const core = (await import(
    pathToFileURL(corePath).href
  )) as typeof import("./native-process.js");
  return { core, workerPath };
}

function readProcessCommand(pid: number): string {
  if (process.platform === "linux")
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
  return execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  }).trim();
}

posix(
  "hands off leased postgres and livekit supervisors cleanly on upgrade from Folder A to Folder B",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const folderA = path.join(root, "app-v1");
    const folderB = path.join(root, "app-v2");
    const [releaseA, releaseB] = await Promise.all([
      bundleSupervisorFolder(folderA, "// release v1"),
      bundleSupervisorFolder(folderB, "// release v2"),
    ]);
    const gracefulScript = (name: string) =>
      `const fs=require('node:fs');fs.appendFileSync('${name}.starts',process.pid+'\\n');process.on('SIGINT',()=>{fs.writeFileSync('${name}.sigint','ok');process.exit(0);});setInterval(()=>{},1000)`;
    const postgresOptions = {
      root,
      name: "postgres" as const,
      executable: process.execPath,
      args: ["-e", gracefulScript("postgres")],
      cwd: root,
      env: process.env,
      restartOnConfigurationChange: true,
    };
    const livekitOptions = {
      root,
      name: "livekit" as const,
      executable: process.execPath,
      args: ["-e", gracefulScript("livekit")],
      cwd: root,
      env: process.env,
      restartOnConfigurationChange: true,
    };

    const pgA = await releaseA.core.startNativeProcess(postgresOptions);
    const lkA = await releaseA.core.startNativeProcess(livekitOptions);
    await expect
      .poll(async () =>
        readFile(path.join(root, "postgres.starts"), "utf8").catch(() => ""),
      )
      .toMatch(/^\d+\n$/);
    await expect
      .poll(async () =>
        readFile(path.join(root, "livekit.starts"), "utf8").catch(() => ""),
      )
      .toMatch(/^\d+\n$/);

    // Same-folder inspection sees fresh supervisors; Folder B sees stale ones.
    expect(await releaseA.core.nativeSupervisorsStale(root)).toBe(false);
    expect(await releaseB.core.nativeSupervisorsStale(root)).toBe(true);
    expect(
      await releaseB.core.nativeConfigurationChanged(postgresOptions),
    ).toBe(true);
    expect(await releaseB.core.nativeConfigurationChanged(livekitOptions)).toBe(
      true,
    );

    // Same-folder restart reuses both healthy supervisors without restarting.
    expect((await releaseA.core.startNativeProcess(postgresOptions)).pid).toBe(
      pgA.pid,
    );
    expect((await releaseA.core.startNativeProcess(livekitOptions)).pid).toBe(
      lkA.pid,
    );

    // Upgrading to Folder B stops Folder A's supervisors gracefully and hands off.
    const pgB = await releaseB.core.startNativeProcess(postgresOptions);
    const lkB = await releaseB.core.startNativeProcess(livekitOptions);
    expect(pgB.pid).not.toBe(pgA.pid);
    expect(lkB.pid).not.toBe(lkA.pid);
    await expect.poll(() => exited(pgA.pid!)).toBe(true);
    await expect.poll(() => exited(lkA.pid!)).toBe(true);
    expect(await readFile(path.join(root, "postgres.sigint"), "utf8")).toBe(
      "ok",
    );
    expect(await readFile(path.join(root, "livekit.sigint"), "utf8")).toBe(
      "ok",
    );
    expect(await releaseB.core.nativeSupervisorsStale(root)).toBe(false);
    expect(
      await releaseB.core.nativeConfigurationChanged(postgresOptions),
    ).toBe(false);

    const canonicalWorkerB = await realpath(releaseB.workerPath);
    for (const [name, pid] of [
      ["postgres", pgB.pid!],
      ["livekit", lkB.pid!],
    ] as const) {
      const record = JSON.parse(
        await readFile(
          path.join(root, "native/processes", `${name}.json`),
          "utf8",
        ),
      ) as { supervisor?: { script: string } };
      expect(record.supervisor?.script).toBe(canonicalWorkerB);
      const command = readProcessCommand(pid);
      expect(command).toContain(canonicalWorkerB);
      expect(command).not.toContain(folderA);
    }
  },
);

posix(
  "hands off leased supervisors on same-version re-extract after Folder A is deleted",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const folderA = path.join(root, "extract-A");
    const folderB = path.join(root, "extract-B");
    // Same worker contents in both folders (same release extracted elsewhere).
    const [extractA, extractB] = await Promise.all([
      bundleSupervisorFolder(folderA),
      bundleSupervisorFolder(folderB),
    ]);
    const service = (name: "postgres" | "web") => ({
      root,
      name,
      executable: process.execPath,
      args: [
        "-e",
        `process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)`,
      ],
      cwd: root,
      env: process.env,
      restartOnConfigurationChange: true,
    });

    const pgA = await extractA.core.startNativeProcess(service("postgres"));
    const webA = await extractA.core.startNativeProcess(service("web"));

    // Delete Folder A completely while its supervisors are still running.
    await rm(folderA, { recursive: true, force: true });

    // Running services still inspect as running so ports are never reassigned,
    // while Folder B detects that their supervisors belong to deleted Folder A.
    expect(await extractB.core.inspectNativeProcess(root, "postgres")).toEqual({
      running: true,
      pid: pgA.pid,
    });
    expect(await extractB.core.nativeSupervisorsStale(root)).toBe(true);

    const pgB = await extractB.core.startNativeProcess(service("postgres"));
    const webB = await extractB.core.startNativeProcess(service("web"));
    expect(pgB.pid).not.toBe(pgA.pid);
    expect(webB.pid).not.toBe(webA.pid);
    await expect.poll(() => exited(pgA.pid!)).toBe(true);
    await expect.poll(() => exited(webA.pid!)).toBe(true);
    expect(await extractB.core.nativeSupervisorsStale(root)).toBe(false);

    const canonicalWorkerB = await realpath(extractB.workerPath);
    expect(readProcessCommand(pgB.pid!)).toContain(canonicalWorkerB);
    expect(readProcessCommand(webB.pid!)).toContain(canonicalWorkerB);
  },
);

posix(
  "hands off a supervisor when native-process-worker.mjs is overwritten in place",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const folder = path.join(root, "in-place");
    const bundled = await bundleSupervisorFolder(folder, "// build 1");
    const options = {
      root,
      name: "postgres" as const,
      executable: process.execPath,
      args: [
        "-e",
        "process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)",
      ],
      cwd: root,
      env: process.env,
      restartOnConfigurationChange: true,
    };

    const first = await bundled.core.startNativeProcess(options);
    expect(await bundled.core.nativeSupervisorsStale(root)).toBe(false);

    // Overwrite the supervisor script in place with an updated build.
    const previous = await readFile(bundled.workerPath, "utf8");
    await writeFile(bundled.workerPath, `${previous}\n// build 2\n`);

    expect(await bundled.core.nativeSupervisorsStale(root)).toBe(true);
    expect(await bundled.core.nativeConfigurationChanged(options)).toBe(true);

    const second = await bundled.core.startNativeProcess(options);
    expect(second.pid).not.toBe(first.pid);
    await expect.poll(() => exited(first.pid!)).toBe(true);
    expect(await bundled.core.nativeSupervisorsStale(root)).toBe(false);
  },
);

posix(
  "hands off a running service whose legacy record lacks supervisor metadata",
  async (context) => {
    const { expect } = context;
    const root = await fixture(context);
    const options = {
      root,
      name: "postgres" as const,
      executable: process.execPath,
      args: [
        "-e",
        "process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)",
      ],
      cwd: root,
      env: process.env,
      restartOnConfigurationChange: true,
    };
    const first = await startNativeProcess(options);
    const recordPath = path.join(root, "native/processes/postgres.json");
    const legacy = JSON.parse(await readFile(recordPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete legacy.supervisor;
    await writeFile(recordPath, JSON.stringify(legacy), { mode: 0o600 });

    expect(await inspectNativeProcess(root, "postgres")).toEqual({
      running: true,
      pid: first.pid,
    });
    expect(await nativeSupervisorsStale(root)).toBe(true);
    expect(await nativeConfigurationChanged(options)).toBe(true);

    const second = await startNativeProcess(options);
    expect(second.pid).not.toBe(first.pid);
    await expect.poll(() => exited(first.pid!)).toBe(true);
    expect(await nativeSupervisorsStale(root)).toBe(false);
  },
);
