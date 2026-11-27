import { join } from "node:path";

import { serviceCredential } from "@linger/service-kit/node";

import {
  DOCUMENT_RUNTIME_DEFAULT_ADDRESS,
  readListenAddress,
} from "../listen-address.js";
import { mirrorHome } from "../paths.js";

export interface DocumentWorkerConfig {
  hostname: string;
  port: number;
  teamHubToken: string;
  connectionTokenKey: string;
  databaseUrl: string;
  failureEvidenceDirectory: string;
}

/** Reads Document Runtime worker configuration from the environment. */
export function readDocumentWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DocumentWorkerConfig {
  const { host: hostname, port } = readListenAddress(
    environment,
    "DOCUMENT_RUNTIME_HTTP_ADDRESS",
    DOCUMENT_RUNTIME_DEFAULT_ADDRESS,
  );
  const teamHubToken = serviceCredential("node-services-internal", environment);
  const connectionTokenKey = serviceCredential(
    "document-connection-token",
    environment,
  );
  if (!teamHubToken || !connectionTokenKey) {
    throw new TypeError("LINGER_SECRET_SEED is required");
  }
  // The Runtime saves Document bodies in TeamHub's database.
  const databaseUrl = environment.TEAMHUB_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new TypeError("TEAMHUB_DATABASE_URL is required");
  }
  return {
    hostname,
    port,
    teamHubToken,
    connectionTokenKey,
    databaseUrl,
    failureEvidenceDirectory: join(
      mirrorHome(environment),
      "document-runtime",
      "failure-evidence",
    ),
  };
}
