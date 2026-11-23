const LINUX_CLOSE_INHERITED_FDS_MODULE = [
  'import { closeSync, constants, readFileSync, readlinkSync, readdirSync } from "node:fs";',
  'if (process.platform === "linux") {',
  "  const oCloexec = constants.O_CLOEXEC ?? 0o2000000;",
  '  const inspectEnabled = process.execArgv.some((arg) => arg.startsWith("--inspect"));',
  "  const channelFd = process.channel?.fd;",
  "  const ipcFd = process.connected ? (Number.isInteger(channelFd) && channelFd >= 3 ? channelFd : 3) : -1;",
  "  let listeningInodes;",
  "  const readListening = () => {",
  "    const inodes = new Set();",
  '    for (const table of ["tcp", "tcp6"]) {',
  "      try {",
  '        const lines = readFileSync(`/proc/net/${table}`, "utf8").split("\\n");',
  "        for (let i = 1; i < lines.length; i++) {",
  "          const cols = lines[i]?.trim().split(/\\s+/);",
  '          if (cols && cols.length >= 10 && cols[3] === "0A" && cols[9] && cols[9] !== "0") inodes.add(cols[9]);',
  "        }",
  "      } catch {}",
  "    }",
  "    try {",
  '      const lines = readFileSync("/proc/net/unix", "utf8").split("\\n");',
  "      for (let i = 1; i < lines.length; i++) {",
  "        const cols = lines[i]?.trim().split(/\\s+/);",
  '        if (cols && cols.length >= 7 && cols[5] === "01" && (Number.parseInt(cols[3], 16) & 0x10000) !== 0 && cols[6] && cols[6] !== "0") inodes.add(cols[6]);',
  "      }",
  "    } catch {}",
  "    return inodes;",
  "  };",
  "  const isListeningSocket = (fd) => {",
  "    if (inspectEnabled) return false;",
  "    try {",
  "      const m = /^socket:\\[(\\d+)\\]$/.exec(readlinkSync(`/proc/self/fd/${fd}`));",
  "      if (!m) return false;",
  "      listeningInodes ??= readListening();",
  "      return listeningInodes.has(m[1]);",
  "    } catch { return false; }",
  "  };",
  "  let entries = [];",
  '  try { entries = readdirSync("/proc/self/fd"); } catch {}',
  "  for (const entry of entries) {",
  "    if (!/^\\d+$/.test(entry)) continue;",
  "    const fd = Number(entry);",
  "    if (fd < 3 || fd === ipcFd) continue;",
  "    try {",
  '      const info = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8");',
  "      const match = /^flags:\\s+([0-7]+)$/m.exec(info);",
  "      if (!match) continue;",
  "      const flags = Number.parseInt(match[1], 8);",
  "      if ((flags & oCloexec) === 0 || isListeningSocket(fd)) closeSync(fd);",
  "    } catch {}",
  "  }",
  "}",
].join("\n");

const LINUX_CLOSE_INHERITED_FDS_IMPORT_URL = `data:text/javascript,${encodeURIComponent(LINUX_CLOSE_INHERITED_FDS_MODULE)}`;

/**
 * Node CLI flags that close inherited non-FD_CLOEXEC descriptors and listening
 * TCP/Unix sockets >= 3 before a spawned Node script executes on Linux; empty
 * on other platforms.
 */
export function linuxNodeFdHygieneArgs(
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  return platform === "linux"
    ? ["--import", LINUX_CLOSE_INHERITED_FDS_IMPORT_URL]
    : [];
}
