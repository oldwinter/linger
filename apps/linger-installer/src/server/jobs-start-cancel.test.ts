import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { JobManager } from "./jobs.js";
import { privateWrite } from "./storage.js";

vi.mock("./storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage.js")>();
  return { ...actual, privateWrite: vi.fn(actual.privateWrite) };
});

async function setup(
  inputFailure?: Error,
  phase: "input" | "snapshot" = "input",
) {
  const actual =
    await vi.importActual<typeof import("./storage.js")>("./storage.js");
  const root = await mkdtemp(path.join(tmpdir(), "installer-start-cancel-"));
  const directory = path.join(root, "jobs");
  const run = vi.fn<ConstructorParameters<typeof JobManager>[1]>(async () => ({
    state: "ready",
    code: 0,
    message: "Ready",
  }));
  const jobs = new JobManager(directory, run);
  await jobs.load();
  let blocked = false;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(privateWrite).mockImplementation(async (file, value) => {
    const input = file.endsWith(".input.json");
    if (!blocked && (phase === "input" ? input : !input)) {
      blocked = true;
      enter();
      await released;
      if (inputFailure) throw inputFailure;
    }
    await actual.privateWrite(file, value);
  });
  return {
    jobs,
    run,
    directory,
    entered,
    release,
    async cleanup() {
      release();
      await jobs.shutdown();
      vi.mocked(privateWrite).mockImplementation(actual.privateWrite);
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("never executes a queued job canceled while its initial input is being saved", async () => {
  const fixture = await setup();
  const { jobs, run, directory, entered, release } = fixture;
  const starting = jobs.start({ instance: "default" });
  try {
    await entered;
    const id = jobs.list()[0]!.id;
    const wasBusy = jobs.busy;
    const canceled = jobs.cancel(id);
    expect(jobs.get(id)?.state).toBe("canceled");
    release();
    expect((await canceled)?.state).toBe("canceled");
    await starting;
    await jobs.wait(id);
    expect(run).not.toHaveBeenCalled();
    expect(wasBusy).toBe(true);
    expect(jobs.get(id)?.state).toBe("canceled");
    const saved = JSON.parse(
      await readFile(path.join(directory, `${id}.json`), "utf8"),
    );
    expect(saved.job.state).toBe("canceled");
    const retry = await jobs.start({ instance: "default" });
    await jobs.wait(retry.id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(jobs.get(retry.id)?.state).toBe("succeeded");
  } finally {
    release();
    await starting;
    await fixture.cleanup();
  }
});

it("does not publish a canceled job whose initial private input could not be saved", async () => {
  const failure = new Error("Cannot save the input file");
  const fixture = await setup(failure);
  const { jobs, run, directory, entered, release } = fixture;
  const starting = jobs.start({ instance: "default" });
  const rejectedStart = expect(starting).rejects.toBe(failure);
  let canceled: Promise<unknown> | undefined;
  try {
    await entered;
    canceled = jobs.cancel(jobs.list()[0]!.id).catch(() => undefined);
    release();
    await rejectedStart;
    await canceled;
    expect(run).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
    const restarted = new JobManager(directory, run);
    await restarted.load();
    expect(restarted.list()).toEqual([]);
  } finally {
    release();
    await rejectedStart;
    await canceled;
    await fixture.cleanup();
  }
});

it("shutdown cancels and drains initial job persistence before returning", async () => {
  const fixture = await setup();
  const { jobs, run, entered, release } = fixture;
  const starting = jobs.start({ instance: "default" });
  let shutdown: Promise<void> | undefined;
  try {
    await entered;
    let stopped = false;
    shutdown = jobs.shutdown().then(() => {
      stopped = true;
    });
    await setImmediate();
    expect(stopped).toBe(false);
    release();
    await starting;
    await shutdown;
    expect(run).not.toHaveBeenCalled();
    expect(jobs.list()[0]?.state).toBe("canceled");
    expect(jobs.busy).toBe(false);
  } finally {
    release();
    await starting;
    await shutdown;
    await fixture.cleanup();
  }
});

it("waits for a deduplicated queued start through its initial persistence and execution", async () => {
  const fixture = await setup();
  const { jobs, run, entered, release } = fixture;
  const starting = jobs.start({ instance: "default" });
  let waiting: Promise<void> | undefined;
  try {
    await entered;
    const duplicate = await jobs.start({ instance: "default" });
    let finished = false;
    waiting = jobs.wait(duplicate.id).then(() => {
      finished = true;
    });
    await setImmediate();
    expect(finished).toBe(false);
    release();
    expect((await starting).id).toBe(duplicate.id);
    await waiting;
    expect(run).toHaveBeenCalledTimes(1);
    expect(jobs.get(duplicate.id)?.state).toBe("succeeded");
  } finally {
    release();
    await starting;
    await waiting;
    await fixture.cleanup();
  }
});

it("persists cancellation requested after the first job snapshot was captured", async () => {
  const fixture = await setup(undefined, "snapshot");
  const { jobs, run, directory, entered, release } = fixture;
  const starting = jobs.start({ instance: "default" });
  let canceled: Promise<unknown> | undefined;
  try {
    await entered;
    const id = jobs.list()[0]!.id;
    canceled = jobs.cancel(id);
    release();
    await starting;
    await canceled;
    expect(run).not.toHaveBeenCalled();
    const saved = JSON.parse(
      await readFile(path.join(directory, `${id}.json`), "utf8"),
    );
    expect(saved.job.state).toBe("canceled");
    expect(saved.events.at(-1)?.state).toBe("canceled");
  } finally {
    release();
    await starting;
    await canceled;
    await fixture.cleanup();
  }
});

it("shutdown drains other jobs without repeating an input error reported by start", async () => {
  const failure = new Error("Cannot save the input file");
  const fixture = await setup(failure);
  const { jobs, run, entered, release } = fixture;
  let aborted!: () => void;
  const abortedRun = new Promise<void>((resolve) => (aborted = resolve));
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  run.mockImplementation(async (_input, signal) => {
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted();
          resolve();
        },
        { once: true },
      );
    });
    await finished;
    return { state: "cancelled", code: 1, message: "Canceled" };
  });
  const starting = jobs.start({ instance: "default" });
  const rejectedStart = expect(starting).rejects.toBe(failure);
  let shutdown: Promise<unknown> | undefined;
  try {
    await entered;
    const running = await jobs.start({ instance: "other" });
    let stopped = false;
    shutdown = jobs.shutdown().then(
      () => {
        stopped = true;
      },
      (error: unknown) => {
        stopped = true;
        return error;
      },
    );
    release();
    await rejectedStart;
    expect(
      await Promise.race([
        abortedRun.then(() => "aborted"),
        shutdown.then(() => "stopped"),
      ]),
    ).toBe("aborted");
    expect(stopped).toBe(false);
    finish();
    expect(await shutdown).toBeUndefined();
    expect(jobs.get(running.id)?.state).toBe("canceled");
  } finally {
    release();
    finish();
    await rejectedStart;
    await shutdown;
    await fixture.cleanup();
  }
});

it("shutdown still reports a failed cancellation save for a retained job", async () => {
  const actual =
    await vi.importActual<typeof import("./storage.js")>("./storage.js");
  const fixture = await setup(undefined, "snapshot");
  const { jobs, run, entered, release } = fixture;
  const failure = new Error("Cannot save the canceled snapshot");
  const starting = jobs.start({ instance: "default" });
  let shutdown: Promise<unknown> | undefined;
  try {
    await entered;
    const id = jobs.list()[0]!.id;
    shutdown = jobs.shutdown().catch((error: unknown) => error);
    // The first captured snapshot is already inside the original write;
    // fail the next write, which must record the late cancellation.
    vi.mocked(privateWrite).mockRejectedValue(failure);
    release();
    await starting;
    expect(await shutdown).toBe(failure);
    expect(jobs.get(id)?.state).toBe("canceled");
    expect(run).not.toHaveBeenCalled();
  } finally {
    release();
    await starting;
    await shutdown;
    vi.mocked(privateWrite).mockImplementation(actual.privateWrite);
    const recovered = await jobs.start({ instance: "recovered" });
    await jobs.wait(recovered.id);
    await fixture.cleanup();
  }
});
