import { expect, test, vi } from "vitest";
import type { Instance } from "@linger/local-installation/instance";
import type { installNativeSource } from "@linger/local-installation/native-source";
import { resumeSourceInstance, type ResumeEngine } from "./resume.js";

const instance = {
  name: "desktop",
  mode: "source-native",
  origin: "http://localhost:3000",
  source: { repo: "/source" },
} as Instance;
const options = {
  home: "/home",
  sourceRepo: "/source",
  instanceName: "desktop",
  externalComputer: true,
  signal: new AbortController().signal,
  log: () => {},
};

const native = (run: ResumeEngine["run"], ready: boolean) => ({
  "source-native": { run, probe: async () => [{ ready }] },
});

test("starts the saved instance again without new input", async () => {
  const run = vi.fn<typeof installNativeSource>(async () => ({
    code: 0,
    state: "ready",
    message: "ok",
  }));
  const outcome = await resumeSourceInstance(options, {
    load: async () => instance,
    engines: native(run, false),
  });
  expect(outcome).toMatchObject({
    code: 0,
    details: { origin: "http://localhost:3000" },
  });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "desktop",
      home: "/home",
      repo: "/source",
      externalComputer: true,
    }),
  );
  expect(run.mock.calls[0]![0]).not.toHaveProperty("password");
});

test("leaves running services alone", async () => {
  const run = vi.fn();
  expect(
    await resumeSourceInstance(options, {
      load: async () => instance,
      engines: native(run, true),
      pending: async () => false,
      restore: async () => undefined,
    }),
  ).toMatchObject({ code: 0, details: { origin: instance.origin } });
  expect(run).not.toHaveBeenCalled();
});

test("brings the local models back while the services keep running", async () => {
  const run = vi.fn();
  const restore = vi.fn(async () => undefined);
  expect(
    await resumeSourceInstance(options, {
      load: async () => instance,
      engines: native(run, true),
      pending: async () => false,
      restore,
    }),
  ).toMatchObject({ code: 0, state: "ready" });
  expect(restore).toHaveBeenCalledWith(
    instance,
    expect.objectContaining({ signal: options.signal }),
  );
  expect(run).not.toHaveBeenCalled();
});

test("reports a local model restore that failed", async () => {
  const failed = {
    code: 4,
    state: "action_required" as const,
    message: "The local model stack is not ready.",
    details: { code: "LOCAL_MODELS_RECOVERY_REQUIRED" },
  };
  expect(
    await resumeSourceInstance(options, {
      load: async () => instance,
      engines: native(vi.fn(), true),
      pending: async () => false,
      restore: async () => failed,
    }),
  ).toEqual(failed);
});

test("leaves the local models to a full start", async () => {
  const restore = vi.fn(async () => undefined);
  await resumeSourceInstance(options, {
    load: async () => instance,
    engines: native(
      vi.fn<ResumeEngine["run"]>(async () => ({
        code: 0,
        state: "ready",
        message: "ok",
      })),
      false,
    ),
    restore,
  });
  expect(restore).not.toHaveBeenCalled();
});

test("restarts running services for a changed user.env", async () => {
  const run = vi.fn<ResumeEngine["run"]>(async () => ({
    code: 0,
    state: "ready",
    message: "ok",
  }));
  await resumeSourceInstance(options, {
    load: async () => instance,
    engines: native(run, true),
    pending: async () => true,
  });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ repo: "/source" }),
  );
});

test("moves running services to a new source tree", async () => {
  const run = vi.fn<ResumeEngine["run"]>(async () => ({
    code: 0,
    state: "ready",
    message: "ok",
  }));
  await resumeSourceInstance(options, {
    load: async () =>
      ({ ...instance, source: { repo: "/old-source" } }) as Instance,
    engines: native(run, true),
  });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ repo: "/source" }),
  );
});

test("reports the source the services serve from", async () => {
  expect(
    await resumeSourceInstance(options, {
      load: async () => instance,
      engines: native(vi.fn(), true),
      pending: async () => false,
      restore: async () => undefined,
    }),
  ).toMatchObject({ code: 0, details: { source: "/source" } });
  // The instance names a new checkout only once its services became ready
  // on it, so a run that never restarted them reports the old one.
  const run = vi.fn<ResumeEngine["run"]>(async () => ({
    code: 0,
    state: "ready",
    message: "ok",
  }));
  const old = { ...instance, source: { repo: "/old-source" } } as Instance;
  expect(
    await resumeSourceInstance(options, {
      load: async () => old,
      engines: native(run, true),
    }),
  ).toMatchObject({ code: 0, details: { source: "/old-source" } });
});

test("reports the origin the services moved to", async () => {
  const moved = { ...instance, origin: "http://localhost:3001" } as Instance;
  const load = vi
    .fn<() => Promise<Instance>>()
    .mockResolvedValueOnce(instance)
    .mockResolvedValue(moved);
  const run = vi.fn<ResumeEngine["run"]>(async () => ({
    code: 0,
    state: "ready",
    message: "ok",
    details: { origin: moved.origin },
  }));
  expect(
    await resumeSourceInstance(options, {
      load,
      engines: native(run, false),
    }),
  ).toMatchObject({ code: 0, details: { origin: "http://localhost:3001" } });
});

test("needs an installed source instance", async () => {
  expect(
    await resumeSourceInstance(options, {
      load: async () => ({ ...instance, source: undefined }),
    }),
  ).toMatchObject({ code: 4 });
  expect(
    await resumeSourceInstance(options, { load: async () => undefined }),
  ).toMatchObject({ code: 4 });
});
