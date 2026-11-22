import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/web", emptyOutDir: true },
  server: { host: "127.0.0.1" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Server job and launcher suites exercise real atomic writes (fsync) into tmpdir.
    // Bound worker concurrency and give shared CI disks 15 s headroom while
    // keeping local runs strict at 5 s.
    testTimeout: process.env.CI ? 15_000 : 5_000,
    maxWorkers: 2,
  },
});
