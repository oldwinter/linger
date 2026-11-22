import { execFile, spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

// The source supervisor imports this module directly, before any build.
const leaseKey = "LINGER_NATIVE_PROCESS_LEASE";
function runProcess(
  executable: string,
  args: string[],
  options: { timeoutMs: number; locale?: "c" | "inherited" },
) {
  // Inspectors must not inherit the lease and appear among the owned processes.
  // ps prints lstart in the caller's locale (a zh-CN Mac prints a different
  // number of fields), and a recorded birth must read the same from every
  // process that checks it, so inspectors run in the C locale.
  const env: NodeJS.ProcessEnv =
    options.locale === "inherited"
      ? { ...process.env }
      : { ...process.env, LC_ALL: "C", LANG: "C" };
  delete env[leaseKey];
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    execFile(
      executable,
      args,
      // Inspectors run in the background, including during Windows startup.
      {
        env,
        timeout: options.timeoutMs,
        maxBuffer: 2_000_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error && error.code !== 1)
          reject(
            new Error("Native process identity could not be inspected.", {
              cause: error,
            }),
          );
        else resolve({ code: error ? 1 : 0, stdout });
      },
    );
  });
}
// Windows has no process groups and no readable foreign environment. The
// supervisor carries the lease in its command line (the job file name), and
// what it starts is found through parent links; a creation time older than
// the parent's means a reused PID, never a child.
const WINDOWS_PROCESSES = String.raw`
$ErrorActionPreference = 'Stop'
$p = @(Get-CimInstance Win32_Process | ForEach-Object {
  [pscustomobject]@{ p = $_.ProcessId; q = $_.ParentProcessId; c = $_.CreationDate.ToFileTimeUtc(); l = [string]$_.CommandLine }
})
[pscustomobject]@{ p = $p } | ConvertTo-Json -Compress -Depth 3
`;
export interface WindowsProcess {
  pid: number;
  parent: number;
  created: number;
  command: string;
}
export interface WindowsSnapshot {
  processes: WindowsProcess[];
  /**
   * Listening TCP port to the owning PID, for the addresses the services
   * bind and check: 127.0.0.1, or every IPv4 address. Another program on
   * ::1 neither blocks them nor answers their health checks.
   */
  listeners: Map<number, number>;
}
type Rows<T> = T | T[] | null | undefined;
const rows = <T>(value: Rows<T>): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
function parseWindowsProcesses(stdout: string): WindowsProcess[] {
  const parsed = JSON.parse(stdout) as {
    p: Rows<{ p: number; q: number; c: number; l: string | null }>;
  };
  if (!parsed.p) throw new Error("Native processes could not be enumerated.");
  return rows(parsed.p).map((row) => ({
    pid: row.p,
    parent: row.q,
    created: row.c,
    command: row.l ?? "",
  }));
}

function addWindowsListener(listeners: Map<number, number>, line: string) {
  // A listening TCP row has no remote peer. The state text is localized.
  const match =
    /^\s*TCP\s+(127\.0\.0\.1|0\.0\.0\.0):(\d+)\s+0\.0\.0\.0:0\s+.+?\s+(\d+)\s*$/.exec(
      line,
    );
  if (!match) return;
  const [, ip, portText, pidText] = match;
  const port = Number(portText);
  const pid = Number(pidText);
  if (port < 1 || port > 65535 || pid < 1 || pid > 0xffffffff) return;
  // A specific loopback bind takes precedence over an IPv4 wildcard.
  if (ip === "127.0.0.1" || !listeners.has(port)) listeners.set(port, pid);
}

/** The IPv4 listeners a service's loopback health check can reach. */
export async function parseWindowsListeners(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<Map<number, number>> {
  const listeners = new Map<number, number>();
  for await (const line of lines) addWindowsListener(listeners, line);
  return listeners;
}

export async function windowsProcesses(): Promise<WindowsProcess[]> {
  const result = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESSES],
    { timeoutMs: 15_000 },
  );
  if (result.code !== 0)
    throw new Error("Native processes could not be enumerated.");
  return parseWindowsProcesses(result.stdout);
}

async function windowsListeners(
  systemRoot: string,
): Promise<Map<number, number>> {
  const env = { ...process.env };
  delete env[leaseKey];
  const child = spawn(
    path.win32.join(systemRoot, "System32", "netstat.exe"),
    ["-ano", "-p", "TCP"],
    { env, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  // Established and TIME_WAIT rows can exceed execFile's buffer. Consume
  // lines as they arrive and retain only the small index of listeners.
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let sawOutput = false;
  lines.on("line", () => (sawOutput = true));
  const status = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const timer = setTimeout(() => child.kill(), 15_000);
  try {
    const [listeners, code] = await Promise.all([
      parseWindowsListeners(lines),
      status,
    ]);
    if (code !== 0 || !sawOutput)
      throw new Error("Native TCP listeners could not be enumerated.");
    return listeners;
  } finally {
    clearTimeout(timer);
    lines.close();
  }
}

export async function windowsSnapshot(
  systemRoot: string,
): Promise<WindowsSnapshot> {
  const [processes, listeners] = await Promise.all([
    windowsProcesses(),
    windowsListeners(systemRoot),
  ]);
  return { processes, listeners };
}
/**
 * The PowerShell a supervisor starts to take this snapshot is its own child.
 * Counted as a service process, it kept every Windows supervisor alive after
 * its service died, so the record still claimed a running service. Releases
 * before this one ran the same query, so it is recognized by its script.
 */
function processInspection(candidate: WindowsProcess): boolean {
  return (
    /\bpowershell(?:\.exe)?\b/i.test(candidate.command) &&
    candidate.command.includes("Get-CimInstance Win32_Process")
  );
}
/** The supervisor holding the lease and everything it started, alive now. */
export function windowsLeaseTree(
  processes: WindowsProcess[],
  lease: string,
): WindowsProcess[] {
  const owner = processes.find((candidate) =>
    candidate.command.includes(`.${lease}.job`),
  );
  if (!owner) return [];
  const tree = [owner];
  for (let index = 0; index < tree.length; index++) {
    const parent = tree[index]!;
    for (const candidate of processes)
      if (
        candidate.parent === parent.pid &&
        candidate.created >= parent.created &&
        !processInspection(candidate) &&
        !tree.includes(candidate)
      )
        tree.push(candidate);
  }
  return tree;
}
/** Linux reads /proc directly: minimal hosts and containers often lack procps. */
export async function linuxProcessStates(
  ownedOnly = false,
): Promise<Array<{ pid: number; group: number; state: string }>> {
  const pids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
  const states = await Promise.all(
    pids.map(async (pid) => {
      try {
        if (
          ownedOnly &&
          (await stat(`/proc/${pid}`)).uid !== process.getuid?.()
        )
          return undefined;
        const line = await readFile(`/proc/${pid}/stat`, "utf8");
        const fields = line.slice(line.lastIndexOf(")") + 2).split(" ");
        return {
          pid: Number(pid),
          group: Number(fields[2]),
          state: fields[0] ?? "",
        };
      } catch {
        return undefined; // Exited while listing.
      }
    }),
  );
  return states.filter((state) => state !== undefined);
}
/**
 * Reads one `ps -o lstart=,uid=,pgid=,stat=` line. The start time is every
 * field before the last three, so its word count never shifts the others.
 */
export function darwinProcessIdentity(
  line: string,
): { birth: string; uid: number; group: number; state: string } | undefined {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) return;
  const [uid, group, state] = parts.slice(-3) as [string, string, string];
  if (!/^\d+$/.test(uid) || !/^\d+$/.test(group)) return;
  return {
    birth: `darwin:${parts.slice(0, -1).join(":")}`,
    uid: Number(uid),
    group: Number(group),
    state,
  };
}
/**
 * The birth of a macOS process as Linger 0.1.2 recorded it: lstart in the
 * locale the installer ran in, not the C locale every check now uses. Only
 * for converting such a record; undefined elsewhere.
 */
export function legacyDarwinIdentity(
  pid: number,
  lease: string,
): Promise<string | undefined> {
  if (process.platform !== "darwin") return Promise.resolve(undefined);
  return nativeProcessIdentity(pid, lease, true, "inherited");
}
/** Whether a recorded macOS birth reads lstart in the C locale. */
export function darwinBirthInCLocale(birth: string): boolean {
  return /^darwin:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat):(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec):\d{1,2}:\d{2}:\d{2}:\d{2}:\d{4}:\d+:\d+$/.test(
    birth,
  );
}
export async function nativeProcessIdentity(
  pid: number,
  lease: string,
  requireLeader = true,
  locale: "c" | "inherited" = "c",
): Promise<string | undefined> {
  try {
    if (process.platform === "win32") {
      const tree = windowsLeaseTree(await windowsProcesses(), lease);
      const found = tree.find((candidate) => candidate.pid === pid);
      if (!found || (requireLeader && found !== tree[0])) return;
      return `win32:${found.pid}:${found.created}`;
    }
    if (process.platform === "linux") {
      const [stat, status, environment] = await Promise.all([
        readFile(`/proc/${pid}/stat`, "utf8"),
        readFile(`/proc/${pid}/status`, "utf8"),
        readFile(`/proc/${pid}/environ`, "utf8"),
      ]);
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z" || (requireLeader && Number(fields[2]) !== pid))
        return;
      const uid = /^Uid:\s+(\d+)/m.exec(status)?.[1];
      if (Number(uid) !== process.getuid?.()) return;
      if (!environment.split("\0").includes(`${leaseKey}=${lease}`)) return;
      return `linux:${uid}:${fields[19]}`;
    }
    if (process.platform === "darwin") {
      const [identity, environment] = await Promise.all([
        runProcess(
          "/bin/ps",
          ["-p", String(pid), "-o", "lstart=,uid=,pgid=,stat="],
          { timeoutMs: 5_000, locale },
        ),
        // Read only this candidate. Never print the output: it contains
        // environment values. The unguessable launch lease survives execve.
        runProcess("/bin/ps", ["eww", "-p", String(pid), "-o", "command="], {
          timeoutMs: 5_000,
        }),
      ]);
      if (
        identity.code !== 0 ||
        environment.code !== 0 ||
        !environment.stdout.includes(`${leaseKey}=${lease}`)
      )
        return;
      const parsed = darwinProcessIdentity(identity.stdout);
      if (
        !parsed ||
        parsed.uid !== process.getuid?.() ||
        (requireLeader && parsed.group !== pid) ||
        parsed.state.startsWith("Z")
      )
        return;
      return parsed.birth;
    }
  } catch {
    return;
  }
}

export async function nativeLeaseProcesses(
  lease: string,
): Promise<Array<{ pid: number; birth: string }>> {
  if (process.platform === "win32")
    // Descendants that outlive their parent keep a dead parent PID and drop
    // out of the tree; Windows does not reparent them.
    return windowsLeaseTree(await windowsProcesses(), lease).flatMap(
      (candidate) =>
        candidate.pid === process.pid
          ? []
          : [
              {
                pid: candidate.pid,
                birth: `win32:${candidate.pid}:${candidate.created}`,
              },
            ],
    );
  let candidates: number[];
  if (process.platform === "linux")
    // nativeProcessIdentity still checks the real owner and lease per candidate.
    candidates = (await linuxProcessStates(true)).flatMap(({ pid, state }) =>
      pid !== process.pid && state !== "Z" ? [pid] : [],
    );
  else {
    const result = await runProcess("/bin/ps", ["-axo", "pid=,uid=,stat="], {
      timeoutMs: 5000,
    });
    if (result.code !== 0)
      throw new Error("Native processes could not be enumerated.");
    candidates = result.stdout
      .trim()
      .split("\n")
      .flatMap((line) => {
        const [pid, uid, state] = line.trim().split(/\s+/);
        return Number(uid) === process.getuid?.() &&
          Number(pid) !== process.pid &&
          !state?.startsWith("Z")
          ? [Number(pid)]
          : [];
      });
  }
  if (process.platform === "darwin") {
    const leased: number[] = [];
    // Batch the private environment lookup, then fetch a birth identity only
    // for matching leases. One ps per host process makes ordinary down slow,
    // and so does running a busy host's batches one at a time.
    const batches: number[][] = [];
    for (let offset = 0; offset < candidates.length; offset += 32)
      batches.push(candidates.slice(offset, offset + 32));
    for (let offset = 0; offset < batches.length; offset += 4) {
      const listings = await Promise.all(
        batches
          .slice(offset, offset + 4)
          .map((batch) =>
            runProcess(
              "/bin/ps",
              ["eww", "-p", batch.join(","), "-o", "pid=,command="],
              { timeoutMs: 5000 },
            ),
          ),
      );
      for (const listing of listings)
        for (const line of listing.stdout.split("\n")) {
          const pid = /^\s*(\d+)\s/.exec(line)?.[1];
          if (pid && line.includes(`${leaseKey}=${lease}`))
            leased.push(Number(pid));
        }
    }
    candidates = leased;
  }
  const owned: Array<{ pid: number; birth: string }> = [];
  // Bound ps concurrency on hosts with many processes; their environment stays private.
  for (let offset = 0; offset < candidates.length; offset += 8) {
    const batch = await Promise.all(
      candidates.slice(offset, offset + 8).map(async (pid) => {
        const birth = await nativeProcessIdentity(pid, lease, false);
        return birth ? { pid, birth } : undefined;
      }),
    );
    for (const value of batch) if (value) owned.push(value);
  }
  return owned;
}
