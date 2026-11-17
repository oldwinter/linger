import { readdir } from "node:fs/promises";
import path from "node:path";
import { inspectComputer, stopIdleComputer } from "./computer.js";
import { INSTANCE_NAME, convertibleLegacyRecord, lingerHome } from "./home.js";
import {
  composeProject,
  INSTANCE_BUSY,
  withInstanceLock,
  type Instance,
} from "./instance.js";
import { stopModelGateway } from "./model-gateway.js";
import {
  NATIVE_PROCESS_REPLACED,
  stopNativeProcess,
} from "./native-process.js";
import { nativeServices } from "./native-source.js";
import { atomicPrivate, readPrivate } from "./private-files.js";

// Environment keys that installs made while the product was named Simplex
// still carry; nothing reads them after this one-time migration.
const LEGACY_ENVIRONMENT_PREFIX = /^SIMPLEX_/gm;
// Generated instance files whose keys carried the legacy prefix. user.env is
// the person's own file and never held them.
const ENVIRONMENT_FILES = ["services.env", "livekit.env", "native.env"];

export interface LegacyMigrationOptions {
  /** The home to migrate; LINGER_HOME or ~/.simplexai by default. */
  readonly home?: string;
  /** Stops an instance's processes before its names change. */
  readonly stopInstance?: (instance: Instance) => Promise<void>;
}

/** An instance this run left with its legacy names, and why. */
export interface LegacyInstanceSkipped {
  readonly instance: string;
  readonly reason: string;
}

/**
 * Converts an installation made while the product was named Simplex, once:
 * each instance gets its Linger project name and LINGER_* environment keys.
 * An instance that fails keeps its legacy names, does not hold back the
 * others or Linger's start, and is tried again on the next run; the result
 * names each one and why.
 */
export async function migrateLegacyInstallation(
  options: LegacyMigrationOptions = {},
): Promise<LegacyInstanceSkipped[]> {
  const home = path.resolve(options.home ?? lingerHome());
  const stop = options.stopInstance ?? stopLegacyInstance;
  const directory = path.join(home, "instances");
  const skipped: LegacyInstanceSkipped[] = [];
  for (const name of await children(directory)) {
    if (!INSTANCE_NAME.test(name)) continue;
    const root = path.join(directory, name);
    try {
      // Converted instances are left unlocked: an installer job may hold
      // their lock while this runs at the next start.
      if (!isLegacy(await readInstance(root))) continue;
      await withInstanceLock({ root } as Instance, () =>
        migrateInstance(root, name, stop),
      );
    } catch (error) {
      skipped.push({
        instance: name,
        reason:
          (error as { code?: unknown }).code === INSTANCE_BUSY
            ? "Another Linger installer is using it. Close other Linger windows and installer pages, then start Linger again."
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  }
  return skipped;
}

async function children(directory: string): Promise<string[]> {
  return readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
}

// A damaged record is not this migration's to judge, as in
// legacyMigrationPending; the installer reports it when it loads the instance.
async function readInstance(root: string): Promise<Instance | undefined> {
  const text = await readPrivate(path.join(root, "instance.json"));
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as Instance;
  } catch {
    return undefined;
  }
}

function isLegacy(instance: Instance | undefined): instance is Instance {
  return convertibleLegacyRecord(instance);
}

/**
 * Stops what an instance runs from its folder, using its stored settings.
 * Only something still running holds the conversion back: a stop that fails
 * because the program or runtime that would do it left with the earlier app
 * finds nothing to stop, and nothing that keeps running reads the names
 * that change here.
 */
async function stopLegacyInstance(instance: Instance): Promise<void> {
  // A Computer whose status cannot be read takes no stop request either.
  const activeOperations = await inspectComputer(instance).then(
    (status) => status.activeOperations,
    () => -1,
  );
  if (activeOperations > 0)
    throw new Error(
      `Its Computer is running ${activeOperations} task(s). Let them finish or stop them, then start Linger again.`,
    );
  if (activeOperations === 0)
    await stopIdleComputer(instance).catch(() => undefined);
  for (const name of nativeServices)
    await stopNativeProcess(instance.root, name).catch((error: unknown) => {
      if ((error as { code?: unknown }).code === NATIVE_PROCESS_REPLACED)
        return;
      throw new Error(
        `Its ${name} service is still running and could not be stopped (${error instanceof Error ? error.message : String(error)}). Restart this computer, then start Linger again.`,
      );
    });
  // Only earlier releases started this gateway, with tools that may be gone.
  await stopModelGateway(instance, undefined).catch(() => undefined);
}

async function migrateInstance(
  root: string,
  name: string,
  stop: (instance: Instance) => Promise<void>,
): Promise<void> {
  const instance = await readInstance(root);
  if (!isLegacy(instance)) return;
  await stop(instance);
  for (const file of ENVIRONMENT_FILES) {
    const location = path.join(root, file);
    const text = await readPrivate(location);
    const renamed = text?.replace(LEGACY_ENVIRONMENT_PREFIX, "LINGER_");
    if (renamed !== text) await atomicPrivate(location, renamed!);
  }
  // Written last: the legacy project name is what marks the instance as
  // not yet migrated.
  await atomicPrivate(
    path.join(root, "instance.json"),
    JSON.stringify(
      { ...instance, project: composeProject(root, name) },
      null,
      2,
    ) + "\n",
  );
}
