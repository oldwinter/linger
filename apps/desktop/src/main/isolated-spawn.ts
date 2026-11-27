import { existsSync } from "node:fs";

import { linuxNodeFdHygieneArgs } from "@linger/local-installation/native-process-fds";

export interface IsolatedSpawnSpec {
  readonly command: string;
  readonly args: string[];
  readonly detached: boolean;
  readonly isolatedViaDaemon: boolean;
}

export interface IsolatedExecutableSpawnOptions {
  readonly platform?: NodeJS.Platform;
  readonly daemonExecutable?: string;
  readonly daemonExists?: (file: string) => boolean;
  readonly executable: string;
  readonly args: readonly string[];
  readonly detached?: boolean;
  readonly windowed?: boolean;
  readonly noStdio?: boolean;
  readonly allowBreakaway?: boolean;
}

export interface IsolatedNodeSpawnOptions {
  readonly platform?: NodeJS.Platform;
  readonly daemonExecutable?: string;
  readonly daemonExists?: (file: string) => boolean;
  readonly node: string;
  readonly args: readonly string[];
  readonly detached?: boolean;
  readonly allowBreakaway?: boolean;
}

/**
 * Resolves a handle-isolated spawn invocation for any child executable:
 * - On Windows, when the bundled Go daemon executable is available, routes the
 *   launch through `linger-computer-daemon.exe exec-isolated` so inherited
 *   Electron sockets and app files are closed and Go's
 *   PROC_THREAD_ATTRIBUTE_HANDLE_LIST (or NoInheritHandles) isolates the child.
 * - On macOS, libuv uses posix_spawn with POSIX_SPAWN_CLOEXEC_DEFAULT.
 * - On other platforms (or when no daemon binary is present), returns the
 *   direct command and arguments unchanged.
 */
export function resolveIsolatedExecutableSpawn(
  options: IsolatedExecutableSpawnOptions,
): IsolatedSpawnSpec {
  const platform = options.platform ?? process.platform;
  const detached = Boolean(options.detached);
  const daemonExists = options.daemonExists ?? existsSync;
  if (
    platform === "win32" &&
    options.daemonExecutable &&
    daemonExists(options.daemonExecutable)
  ) {
    const helperArgs = ["exec-isolated"];
    if (detached) helperArgs.push("--detached");
    if (options.windowed) helperArgs.push("--windowed");
    if (options.noStdio) helperArgs.push("--no-stdio");
    if (options.allowBreakaway) helperArgs.push("--allow-breakaway");
    helperArgs.push("--", options.executable, ...options.args);
    return {
      command: options.daemonExecutable,
      args: helperArgs,
      detached,
      isolatedViaDaemon: true,
    };
  }
  return {
    command: options.executable,
    args: [...options.args],
    detached,
    isolatedViaDaemon: false,
  };
}

/**
 * Resolves a handle-isolated spawn invocation for a Node child process
 * (installer or helper script):
 * - On Linux, prepends the `--import` FD-hygiene preload that closes inherited
 *   non-O_CLOEXEC descriptors and listening sockets >= 3.
 * - On Windows, delegates to `linger-computer-daemon.exe exec-isolated` when
 *   available so neither the Node child nor any detached services it starts can
 *   inherit Electron's remote-debugging socket or app file handles.
 * - On macOS, libuv's POSIX_SPAWN_CLOEXEC_DEFAULT prevents FD inheritance.
 */
export function resolveIsolatedNodeSpawn(
  options: IsolatedNodeSpawnOptions,
): IsolatedSpawnSpec {
  const platform = options.platform ?? process.platform;
  const nodeArgs = [...linuxNodeFdHygieneArgs(platform), ...options.args];
  return resolveIsolatedExecutableSpawn({
    platform,
    daemonExecutable: options.daemonExecutable,
    daemonExists: options.daemonExists,
    executable: options.node,
    args: nodeArgs,
    detached: options.detached,
    allowBreakaway: options.allowBreakaway,
  });
}
