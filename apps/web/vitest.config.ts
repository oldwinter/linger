import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { hugeiconsPerIconImports } from "./vitest.hugeicons-imports";
import { partitionTestFiles } from "./vitest.isolation";

const root = fileURLToPath(new URL(".", import.meta.url));
const nodeFiles = partitionTestFiles(root, "src/**/*.test.ts");
const domFiles = partitionTestFiles(root, "src/**/*.test.tsx");

export default defineConfig({
  plugins: [react(), hugeiconsPerIconImports()],
  test: {
    testTimeout: 15_000,
    hookTimeout: 15_000,
    setupFiles: ["src/test/setup.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.build.test.ts"],
    // Files sharing a worker must not see each other's stubs, spies, or env.
    unstubGlobals: true,
    unstubEnvs: true,
    restoreMocks: true,
    // Four workers leave room for the dev stack.
    maxWorkers: 4,
    // Threads share one process: about half the system CPU of forks.
    pool: "threads",
    // Logic tests (.ts) skip the jsdom environment; a .ts file that needs the
    // DOM opts in with `// @vitest-environment jsdom`.
    // Creating a jsdom window and importing the app graph costs more than most
    // files' tests, so files without module mocks share one environment and
    // module cache per worker. src/test/setup.ts resets the globals they touch.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: nodeFiles.shared,
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "node-isolated",
          environment: "node",
          include: nodeFiles.isolated,
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: domFiles.shared,
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom-isolated",
          environment: "jsdom",
          include: domFiles.isolated,
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
