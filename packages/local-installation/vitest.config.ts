import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { defineConfig } from "vitest/config";

const windows = process.platform === "win32";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Real Windows ACL and listener checks launch PowerShell processes.
    testTimeout: windows ? 90_000 : 5_000,
    maxWorkers: 2,
    // macOS can return a symlinked temporary directory.
    env: windows ? {} : { TMPDIR: realpathSync(tmpdir()) },
    ...(windows
      ? {
          globalSetup: ["./test/windows-global-setup.ts"],
          setupFiles: ["./test/windows-setup.ts"],
        }
      : {}),
  },
});
