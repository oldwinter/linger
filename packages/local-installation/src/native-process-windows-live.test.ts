import { createServer } from "node:net";
import { expect, test } from "vitest";
import { windowsSnapshot } from "./native-process-identity.js";

test.skipIf(process.platform !== "win32")(
  "finds a real IPv4 listener and its owning process",
  async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const snapshot = await windowsSnapshot(
        process.env.SystemRoot ?? "C:\\Windows",
      );
      expect(snapshot.listeners.get(address.port)).toBe(process.pid);
      expect(
        snapshot.processes.some((entry) => entry.pid === process.pid),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  30_000,
);
