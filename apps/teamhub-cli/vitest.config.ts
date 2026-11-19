import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These suites exercise real filesystem locks, fsync, and directory syncs.
    // Bound worker concurrency and give shared CI disks 15 s headroom while
    // keeping local runs strict at 5 s.
    testTimeout: process.env.CI ? 15_000 : 5_000,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    maxWorkers: 2,
  },
});
