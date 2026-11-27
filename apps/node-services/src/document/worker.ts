import { parentPort } from "node:worker_threads";

import { getRequestListener } from "@hono/node-server";

import { createDocumentRuntimeApp } from "./app.js";
import { createDocumentBodyStore } from "./bodies.js";
import { createDocumentComputationPool } from "./computation-pool.js";
import { readDocumentWorkerConfig } from "./config.js";
import { createDocumentRealtimeServer } from "./realtime.js";
import { drainDocumentRuntime } from "./shutdown.js";
import { documentLogger } from "./log.js";

// Half of the host's 20 s default, so the roles that stop after the Document
// Runtime still have time.
const shutdownTimeoutMs = 10_000;

// The host starts this module on its own thread through main.ts, so the jsdom
// globals and the Request/Response replacement stay out of the other roles.
const host = parentPort;
if (host === null) {
  throw new Error("Document Runtime must run in a worker thread");
}

const config = readDocumentWorkerConfig(process.env);
const bodies = createDocumentBodyStore(config.databaseUrl);
const runtimeInstanceId = "document_runtime_primary";
const computationWorkers = 1;
const server = createDocumentRealtimeServer({
  failureEvidenceDirectory: config.failureEvidenceDirectory,
  bodies,
  connectionTokenKey: config.connectionTokenKey,
  hostname: config.hostname,
  port: config.port,
  runtimeInstanceId,
});
const computation = createDocumentComputationPool({
  size: computationWorkers,
  reportError: (message) =>
    documentLogger().log("error", "document.computation_pool_error", {
      message,
    }),
});
const app = createDocumentRuntimeApp({
  changes: server.changes,
  computation,
  disconnect: (documentId, actorId) => server.disconnect(documentId, actorId),
  teamHubToken: config.teamHubToken,
});
server.httpServer.removeAllListeners("request");
const listener = getRequestListener(app.fetch);
server.httpServer.on("request", (request, response) => {
  void listener(request, response);
});
await server.listen();
documentLogger().log("info", "document.listening", {
  url: `http://${config.hostname}:${server.address.port}`,
});
void bodies.recordUnrecordedPoints().then(
  (documents) =>
    documentLogger().log("info", "document.unrecorded_points_armed", {
      documents,
    }),
  (error: unknown) =>
    documentLogger().log("warn", "document.unrecorded_points_failed", {
      error_name: error instanceof Error ? error.name : "unknown",
    }),
);

// The host asks for one drain and terminates the thread after the reply.
host.once("message", () => {
  void (async () => {
    let status = 1;
    try {
      status = await drainDocumentRuntime({
        runtime: server,
        timeoutMs: shutdownTimeoutMs,
        reportError: (message) =>
          documentLogger().log("error", "document.shutdown_error", { message }),
      });
    } catch (error: unknown) {
      documentLogger().log("error", "document.shutdown_error", {
        message: error instanceof Error ? error.message : String(error),
      });
      status = 1;
    } finally {
      try {
        await computation.close();
      } catch (error: unknown) {
        documentLogger().log("error", "document.shutdown_error", {
          message: error instanceof Error ? error.message : String(error),
        });
        status = 1;
      }
      try {
        await bodies.close();
      } catch (error: unknown) {
        documentLogger().log("error", "document.shutdown_error", {
          message: error instanceof Error ? error.message : String(error),
        });
        status = 1;
      }
      host.postMessage(status);
    }
  })();
});
host.postMessage("listening");
