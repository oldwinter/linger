import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  hasReleaseExecutableMode,
  prepareLocalComputerRelease,
} from "./prepare-local-computer-release.mjs";

it.each(["linux-x64", "darwin-arm64"])(
  "rejects %s on a Windows host before creating a release",
  async (target) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "linger-release-policy-"),
    );
    try {
      await expect(
        prepareLocalComputerRelease(
          [
            "--targets",
            "win32-x64," + target,
            "--output",
            path.join(root, "release"),
          ],
          { hostPlatform: "win32" },
        ),
      ).rejects.toThrow("Build Linux and macOS releases on a Unix host.");
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("accepts a Windows executable without POSIX execute bits", () => {
  expect(hasReleaseExecutableMode(0o100666, "win32")).toBe(true);
});

it.each(["linux", "darwin"])(
  "requires execute bits on %s staging files",
  (hostPlatform) => {
    expect(hasReleaseExecutableMode(0o100644, hostPlatform)).toBe(false);
    expect(hasReleaseExecutableMode(0o100755, hostPlatform)).toBe(true);
  },
);
