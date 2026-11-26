import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

// A browser smoke target for the Linger web shell. The runner starts the Vite dev
// server itself, with TeamHub pointed at a closed port so the tests never reach a
// developer's local stack (default ports 8080/3000, ~/.simplexai, .linger-runtime/).
export default {
  projectId: "linger-web",
  targets: [
    {
      name: "web",
      engine: web(),
      app: {
        url: "http://127.0.0.1:44177",
        environment: "test",
        command: {
          executable: "pnpm",
          args: [
            "--dir",
            "apps/web",
            "exec",
            "vite",
            "--port",
            "{port}",
            "--strictPort",
          ],
          env: {
            TEAMHUB_BASE_URL: "http://127.0.0.1:9",
            DOCUMENT_RUNTIME_URL: "http://127.0.0.1:9",
            AGENT_SERVICE_URL: "http://127.0.0.1:9",
            PORT: "{port}",
          },
          startupTimeout: 120_000,
          log: ".e2e/logs/web-dev.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
