import { describe, expect, it } from "vitest";

import {
  resolveIsolatedExecutableSpawn,
  resolveIsolatedNodeSpawn,
} from "./isolated-spawn.js";

describe("resolveIsolatedNodeSpawn", () => {
  it("prepends the Linux FD-hygiene preload without wrapping in the daemon binary", () => {
    const spec = resolveIsolatedNodeSpawn({
      platform: "linux",
      daemonExecutable: "/opt/linger/linger-computer-daemon",
      daemonExists: () => true,
      node: "/opt/linger/node",
      args: ["installer.js", "--no-open"],
      detached: true,
    });
    expect(spec.command).toBe("/opt/linger/node");
    expect(spec.args[0]).toBe("--import");
    expect(spec.args[1]).toMatch(/^data:text\/javascript,/);
    expect(spec.args.slice(2)).toEqual(["installer.js", "--no-open"]);
    expect(spec.detached).toBe(true);
    expect(spec.isolatedViaDaemon).toBe(false);
  });

  it("launches directly on macOS where libuv sets POSIX_SPAWN_CLOEXEC_DEFAULT", () => {
    const spec = resolveIsolatedNodeSpawn({
      platform: "darwin",
      daemonExecutable: "/Applications/Linger.app/linger-computer-daemon",
      daemonExists: () => true,
      node: "/opt/node",
      args: ["installer.js", "--resume"],
      allowBreakaway: true,
    });
    expect(spec).toEqual({
      command: "/opt/node",
      args: ["installer.js", "--resume"],
      detached: false,
      isolatedViaDaemon: false,
    });
  });

  it("wraps Windows Node spawns in linger-computer-daemon exec-isolated when present", () => {
    const daemon =
      "C:\\Linger\\resources\\computer\\linger-computer-daemon.exe";
    const foreground = resolveIsolatedNodeSpawn({
      platform: "win32",
      daemonExecutable: daemon,
      daemonExists: (file) => file === daemon,
      node: "C:\\Linger\\node.exe",
      args: ["installer.js", "--inspect"],
    });
    expect(foreground).toEqual({
      command: daemon,
      args: [
        "exec-isolated",
        "--",
        "C:\\Linger\\node.exe",
        "installer.js",
        "--inspect",
      ],
      detached: false,
      isolatedViaDaemon: true,
    });

    const resume = resolveIsolatedNodeSpawn({
      platform: "win32",
      daemonExecutable: daemon,
      daemonExists: () => true,
      node: "C:\\Linger\\node.exe",
      args: ["installer.js", "--resume"],
      allowBreakaway: true,
    });
    expect(resume).toEqual({
      command: daemon,
      args: [
        "exec-isolated",
        "--allow-breakaway",
        "--",
        "C:\\Linger\\node.exe",
        "installer.js",
        "--resume",
      ],
      detached: false,
      isolatedViaDaemon: true,
    });

    const detached = resolveIsolatedNodeSpawn({
      platform: "win32",
      daemonExecutable: daemon,
      daemonExists: () => true,
      node: "C:\\Linger\\node.exe",
      args: ["installer.js", "--no-open"],
      detached: true,
    });
    expect(detached).toEqual({
      command: daemon,
      args: [
        "exec-isolated",
        "--detached",
        "--",
        "C:\\Linger\\node.exe",
        "installer.js",
        "--no-open",
      ],
      detached: true,
      isolatedViaDaemon: true,
    });
  });

  it("falls back to direct execution on Windows when the daemon binary is absent", () => {
    const spec = resolveIsolatedNodeSpawn({
      platform: "win32",
      daemonExecutable: "C:\\missing\\linger-computer-daemon.exe",
      daemonExists: () => false,
      node: "C:\\Linger\\node.exe",
      args: ["installer.js", "--resume"],
      allowBreakaway: true,
    });
    expect(spec).toEqual({
      command: "C:\\Linger\\node.exe",
      args: ["installer.js", "--resume"],
      detached: false,
      isolatedViaDaemon: false,
    });
  });
});

describe("resolveIsolatedExecutableSpawn", () => {
  it("wraps detached windowed Windows setup launches with --no-stdio", () => {
    const daemon =
      "C:\\Linger\\resources\\computer\\linger-computer-daemon.exe";
    const spec = resolveIsolatedExecutableSpawn({
      platform: "win32",
      daemonExecutable: daemon,
      daemonExists: () => true,
      executable: "C:\\Users\\me\\updates\\Linger-setup.exe",
      args: ["/update", "/relaunch"],
      detached: true,
      windowed: true,
      noStdio: true,
    });
    expect(spec).toEqual({
      command: daemon,
      args: [
        "exec-isolated",
        "--detached",
        "--windowed",
        "--no-stdio",
        "--",
        "C:\\Users\\me\\updates\\Linger-setup.exe",
        "/update",
        "/relaunch",
      ],
      detached: true,
      isolatedViaDaemon: true,
    });
  });
});
