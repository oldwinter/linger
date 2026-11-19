import { realpath } from "node:fs/promises";
import path from "node:path";

import { loadInstance } from "@linger/local-installation/instance";
import { restoreLocalModels } from "@linger/local-installation/local-models";
import { userEnvironmentPending } from "@linger/local-installation/user-environment";
import type { InstallOutcome } from "@linger/local-installation/events";
import {
  installNativeSource,
  probeNativeSourceServices,
} from "@linger/local-installation/native-source";

export interface ResumeOptions {
  home: string;
  sourceRepo: string;
  instanceName: string;
  externalComputer?: boolean;
  signal: AbortSignal;
  log: (message: string) => void;
}

type Instance = NonNullable<Awaited<ReturnType<typeof loadInstance>>>;

export interface ResumeEngine {
  run: (
    options: Parameters<typeof installNativeSource>[0],
  ) => Promise<InstallOutcome>;
  probe: (
    instance: Instance,
    signal: AbortSignal,
  ) => Promise<{ ready: boolean }[]>;
}

// How an installed instance starts again: its native processes.
const ENGINES: Partial<Record<Instance["mode"], ResumeEngine>> = {
  "source-native": {
    run: installNativeSource,
    probe: probeNativeSourceServices,
  },
};

/**
 * Starts the services of an installed source instance again, for example
 * after a reboot. It reuses the Harness and accounts saved by the first
 * install and asks for nothing; the services outlive this process.
 */
export async function resumeSourceInstance(
  options: ResumeOptions,
  {
    load = loadInstance,
    engines = ENGINES,
    pending = userEnvironmentPending,
    restore = restoreLocalModels,
  } = {},
): Promise<InstallOutcome> {
  const instance = await load({
    name: options.instanceName,
    home: options.home,
  });
  const engine = instance && engines[instance.mode];
  if (!instance?.source || !engine)
    return {
      code: 4,
      state: "action_required",
      message: `No source instance named ${options.instanceName}.`,
    };
  // A desktop update ships a new source tree, and a changed user.env new
  // keys; running services keep the old ones until they restart.
  const repo = await realpath(options.sourceRepo).catch(() =>
    path.resolve(options.sourceRepo),
  );
  // The instance names the checkout its services last became ready on, so
  // services that still run from an earlier one never count as running.
  if (
    instance.source.repo === repo &&
    (await engine.probe(instance, options.signal)).every(
      (check) => check.ready,
    ) &&
    !(await pending(instance))
  ) {
    // A quit stops the local models but leaves the services running, so
    // they come back here rather than with the services.
    const restored = await restore(instance, {
      signal: options.signal,
      onEvent: (event) => {
        if (event.message) options.log(event.message);
      },
    });
    if (restored) return restored;
    return {
      code: 0,
      state: "ready",
      message: "Services are already running.",
      details: { origin: instance.origin, source: instance.source.repo },
    };
  }
  const outcome = await engine.run({
    name: instance.name,
    home: options.home,
    repo: options.sourceRepo,
    externalComputer: options.externalComputer,
    signal: options.signal,
    onEvent: (event) => {
      if (event.message) options.log(event.message);
    },
  });
  if (outcome.code !== 0) return outcome;
  // The instance names a checkout only once its services serve from it, and
  // the origin they serve at: the run moves the web port off one another
  // program took.
  const serving = await load({
    name: options.instanceName,
    home: options.home,
  });
  return {
    ...outcome,
    details: {
      ...(outcome.details as object | undefined),
      origin: serving?.origin,
      source: serving?.source?.repo,
    },
  };
}
