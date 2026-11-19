import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, onTestFinished, test, vi } from "vitest";

// Every identity check fails, as a localized `ps` once made them on macOS:
// neither the supervisor nor what it started can be proved by its lease.
vi.mock("./native-process-identity.js", async (original) => ({
  ...(await original<typeof import("./native-process-identity.js")>()),
  nativeProcessIdentity: async () => undefined,
  nativeLeaseProcesses: async () => [],
}));
const { startNativeProcess } = await import("./native-process.js");

vi.setConfig({ testTimeout: 30_000, expect: { poll: { timeout: 15_000 } } });

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux")
      return !execFileSync("cat", [`/proc/${pid}/stat`], { encoding: "utf8" })
        .replace(/^.*\) /s, "")
        .startsWith("Z");
    return true;
  } catch {
    return false;
  }
}

(process.platform === "win32" ? test.skip : test)(
  "ends the launched supervisor and its service when their identity cannot be verified",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "native-unverified-"));
    onTestFinished(async () => {
      try {
        execFileSync("pkill", ["-KILL", "-f", root]);
      } catch {
        // pkill exits 1 when nothing matched.
      }
      await rm(root, { recursive: true, force: true });
    });
    await expect(
      startNativeProcess({
        root,
        name: "postgres",
        executable: process.execPath,
        args: [
          "-e",
          "require('node:fs').writeFileSync('service.pid',String(process.pid));setInterval(()=>{},1000)",
          // Names the root on its command line, so the check below finds it.
          root,
        ],
        cwd: root,
        env: process.env,
      }),
    ).rejects.toThrow("Native postgres identity could not be verified.");
    const service = Number(
      await readFile(path.join(root, "service.pid"), "utf8").catch(() => "0"),
    );
    // A service left running here held postmaster.pid against every retry.
    if (service) await expect.poll(() => alive(service)).toBe(false);
    await expect
      .poll(() =>
        execFileSync("ps", ["-axo", "stat=,command="], { encoding: "utf8" })
          .split("\n")
          .filter((line) => line.includes(root) && !/^\s*Z/.test(line)),
      )
      .toEqual([]);
  },
);
