import { writeFile } from "node:fs/promises";
import path from "node:path";
import { LOCALMODELS_KIT_VERIFICATION_FAILED } from "@linger/local-installation/localmodels-tool";
import { NATIVE_PROCESS_IDENTITY_UNVERIFIED } from "@linger/local-installation/native-process";
import {
  NATIVE_SERVICE_STOP_FAILED,
  nativeServices,
} from "@linger/local-installation/native-source";
import { privateDirectory, privateWrite } from "./storage.js";

type Stage = "manager" | "services" | "localmodels" | "helper";
interface Failure {
  stage: Stage;
  code: string;
  service?: string;
}
const codes = new Set<string>([
  LOCALMODELS_KIT_VERIFICATION_FAILED,
  NATIVE_PROCESS_IDENTITY_UNVERIFIED,
  NATIVE_SERVICE_STOP_FAILED,
]);
const services = new Set<string>(nativeServices);

// Only structured allowlisted fields are persisted; errors can contain secrets.
export function stopFailure(stage: Stage, error: unknown): Failure {
  const value = error as {
    code?: unknown;
    nativeService?: unknown;
    name?: unknown;
  } | null;
  const code =
    typeof value?.code === "string" && codes.has(value.code)
      ? value.code
      : value?.name === "TimeoutError"
        ? "TIMEOUT"
        : "STOP_FAILED";
  const service =
    typeof value?.nativeService === "string" &&
    services.has(value.nativeService)
      ? value.nativeService
      : undefined;
  return { stage, code, ...(service ? { service } : {}) };
}

export async function recordStopOutcome(
  home: string,
  failures: Failure[],
): Promise<void> {
  const directory = path.join(home, "installer");
  const report = {
    time: new Date().toISOString(),
    exitCode: failures.length ? 1 : 0,
    failures: failures.slice(0, 12),
  };
  await privateDirectory(directory);
  if (failures.length) {
    try {
      await writeFile(
        path.join(directory, "stop-first-failure.json"),
        JSON.stringify(report),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  await privateWrite(path.join(directory, "stop-latest.json"), report);
}
