import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectComputer, stopIdleComputer } from "./computer.js";
import { loadInstance, withInstanceLock, type Instance } from "./instance.js";
import { migrateLegacyInstallation } from "./legacy-migration.js";
import { legacyMigrationPending } from "./home.js";
import { stopModelGateway } from "./model-gateway.js";
import {
  NATIVE_PROCESS_REPLACED,
  stopNativeProcess,
} from "./native-process.js";

vi.mock("./computer.js", async (original) => ({
  ...(await original<typeof import("./computer.js")>()),
  inspectComputer: vi.fn(),
  stopIdleComputer: vi.fn(),
}));
vi.mock("./native-process.js", async (original) => ({
  ...(await original<typeof import("./native-process.js")>()),
  stopNativeProcess: vi.fn(),
}));
vi.mock("./model-gateway.js", async (original) => ({
  ...(await original<typeof import("./model-gateway.js")>()),
  stopModelGateway: vi.fn(),
}));

const roots: string[] = [];
beforeEach(() => {
  vi.mocked(inspectComputer).mockResolvedValue({
    state: "offline",
    detail: "",
    runtimes: [],
    activeOperations: 0,
    connected: false,
  });
  vi.mocked(stopIdleComputer).mockResolvedValue(undefined);
  vi.mocked(stopNativeProcess).mockResolvedValue(undefined);
  vi.mocked(stopModelGateway).mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporary(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "linger-legacy-"));
  roots.push(root);
  return root;
}

async function put(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, contents, { mode: 0o600 });
}

// An instance as an install from before the rename left it.
async function legacyInstance(
  home: string,
  name: string,
  mode: Instance["mode"] = "source-native",
): Promise<Instance> {
  const root = path.join(home, "instances", name);
  const releaseDir = path.join(home, "releases", "1");
  const instance: Instance = {
    schemaVersion: 1,
    name,
    mode,
    root,
    project: `simplex-${name}-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`,
    origin: "http://localhost:3999",
    port: 3999,
    releaseDir,
    computerConfig: path.join(root, "computer", "config.json"),
    computerExecutable: path.join(releaseDir, "computer", "linger-computer"),
    ...(mode === "source-native"
      ? {
          source: {
            repo: releaseDir,
            ports: {
              web: 3999,
              teamhub: 4001,
              nodeServices: 4002,
              document: 4003,
              postgres: 4004,
            },
          },
        }
      : {}),
  };
  await put(path.join(root, "instance.json"), JSON.stringify(instance));
  await put(
    path.join(root, "services.env"),
    "SIMPLEX_POSTGRES_PASSWORD=pw\nSIMPLEX_SECRET_SEED=seed\nTEAMHUB_SECRET_ENCRYPTION_KEY=key\n",
  );
  await put(
    path.join(root, "computer", "config.json"),
    JSON.stringify({ state: path.join(root, "computer", "state") }),
  );
  return instance;
}

describe("migrateLegacyInstallation", () => {
  it("gives each instance its Linger names once", async () => {
    const home = await temporary();
    await legacyInstance(home, "desktop");
    const stopped: string[] = [];
    const options = {
      home,
      stopInstance: vi.fn(async (instance: Instance) => {
        stopped.push(instance.name);
      }),
    };
    expect(await legacyMigrationPending(home)).toBe(true);

    await migrateLegacyInstallation(options);

    const instance = (await loadInstance({ name: "desktop", home }))!;
    expect(instance.project).toMatch(/^linger-desktop-[a-f0-9]{12}$/);
    expect(
      await readFile(path.join(instance.root, "services.env"), "utf8"),
    ).toBe(
      "LINGER_POSTGRES_PASSWORD=pw\nLINGER_SECRET_SEED=seed\nTEAMHUB_SECRET_ENCRYPTION_KEY=key\n",
    );
    expect(stopped).toEqual(["desktop"]);
    expect(await legacyMigrationPending(home)).toBe(false);

    await migrateLegacyInstallation(options);
    expect(stopped).toEqual(["desktop"]);
  });

  it("converts an instance whose release folder and Computer are gone", async () => {
    const home = await temporary();
    await legacyInstance(home, "desktop");

    await migrateLegacyInstallation({ home });

    const instance = (await loadInstance({ name: "desktop", home }))!;
    expect(instance.project).toMatch(/^linger-desktop-[a-f0-9]{12}$/);
    // The folder stays: it can hold the person's data.
    expect(
      await readFile(path.join(instance.root, "services.env"), "utf8"),
    ).toContain("LINGER_");
    expect(await legacyMigrationPending(home)).toBe(false);
  });

  it("still names an instance whose live Computer refuses to stop", async () => {
    const home = await temporary();
    const instance = await legacyInstance(home, "stuck");
    const computer =
      await vi.importActual<typeof import("./computer.js")>("./computer.js");
    vi.mocked(inspectComputer).mockImplementationOnce(computer.inspectComputer);
    await mkdir(path.dirname(instance.computerExecutable), {
      recursive: true,
    });
    await writeFile(
      instance.computerExecutable,
      `#!${process.execPath}\nprocess.stdout.write('{"daemon":{"state":"running","active_operations":1},"runtimes":[]}\\n');\n`,
      { mode: 0o700 },
    );

    expect(await migrateLegacyInstallation({ home })).toEqual([
      {
        instance: "stuck",
        reason:
          "Its Computer is running 1 task(s). Let them finish or stop them, then start Linger again.",
      },
    ]);
    expect(stopIdleComputer).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        await readFile(path.join(instance.root, "instance.json"), "utf8"),
      ).project,
    ).toBe(instance.project);
    expect(
      await readFile(path.join(instance.root, "services.env"), "utf8"),
    ).toContain("SIMPLEX_");
    expect(await legacyMigrationPending(home)).toBe(true);
  });

  it("skips a damaged record and converts the other instances", async () => {
    const home = await temporary();
    await put(path.join(home, "instances", "broken", "instance.json"), "{");
    await legacyInstance(home, "desktop");
    const stopInstance = vi.fn(async () => {});

    await migrateLegacyInstallation({ home, stopInstance });

    expect(stopInstance).toHaveBeenCalledTimes(1);
    expect((await loadInstance({ name: "desktop", home }))!.project).toMatch(
      /^linger-desktop-/,
    );
  });

  it("converts the other instances when one fails, names it and retries it later", async () => {
    const home = await temporary();
    await legacyInstance(home, "alpha");
    await legacyInstance(home, "beta");
    const stopInstance = vi.fn(async (instance: Instance) => {
      if (instance.name === "alpha")
        throw new Error("Instance busy: active operations are running");
    });

    expect(await migrateLegacyInstallation({ home, stopInstance })).toEqual([
      {
        instance: "alpha",
        reason: "Instance busy: active operations are running",
      },
    ]);

    expect(stopInstance).toHaveBeenCalledTimes(2);
    expect((await loadInstance({ name: "beta", home }))!.project).toMatch(
      /^linger-beta-/,
    );
    expect(await legacyMigrationPending(home)).toBe(true);

    stopInstance.mockImplementation(async () => {});
    await migrateLegacyInstallation({ home, stopInstance });
    expect((await loadInstance({ name: "alpha", home }))!.project).toMatch(
      /^linger-alpha-/,
    );
    expect(await legacyMigrationPending(home)).toBe(false);
  });

  it("reports an instance whose lock another installer holds", async () => {
    const home = await temporary();
    const instance = await legacyInstance(home, "desktop");
    const stopInstance = vi.fn(async () => {});

    const skipped = await withInstanceLock(instance, () =>
      migrateLegacyInstallation({ home, stopInstance }),
    );

    expect(skipped).toEqual([
      {
        instance: "desktop",
        reason: expect.stringMatching(/^Another Linger installer is using it/),
      },
    ]);

    expect(stopInstance).not.toHaveBeenCalled();
    expect(await legacyMigrationPending(home)).toBe(true);
  });

  it("converges after a crash that renamed only some keys", async () => {
    const home = await temporary();
    const instance = await legacyInstance(home, "desktop");
    // The state a crash leaves between the env rewrite and instance.json.
    await put(
      path.join(instance.root, "services.env"),
      "LINGER_POSTGRES_PASSWORD=pw\nSIMPLEX_SECRET_SEED=seed\n",
    );
    const stopInstance = vi.fn(async () => {});

    await migrateLegacyInstallation({ home, stopInstance });

    expect(stopInstance).toHaveBeenCalledTimes(1);
    expect(
      await readFile(path.join(instance.root, "services.env"), "utf8"),
    ).toBe("LINGER_POSTGRES_PASSWORD=pw\nLINGER_SECRET_SEED=seed\n");
    expect(await legacyMigrationPending(home)).toBe(false);
  });

  it("leaves a home without legacy instances untouched", async () => {
    const home = await temporary();
    const stopInstance = vi.fn(async () => {});
    await migrateLegacyInstallation({ home, stopInstance });
    expect(stopInstance).not.toHaveBeenCalled();
    expect(await legacyMigrationPending(home)).toBe(false);
  });

  it("does not count a damaged instance record as pending", async () => {
    const home = await temporary();
    await put(path.join(home, "instances", "broken", "instance.json"), "{");
    expect(await legacyMigrationPending(home)).toBe(false);
  });

  it("explains an instance it has not converted when the installer loads it", async () => {
    const home = await temporary();
    await legacyInstance(home, "desktop");
    await expect(loadInstance({ name: "desktop", home })).rejects.toThrow(
      /still has its names from the earlier Simplex app.*--migrate to see why/,
    );
  });
});

describe("stopping a legacy instance", () => {
  it("converts an instance whose Computer status cannot be read", async () => {
    const home = await temporary();
    await legacyInstance(home, "default");
    vi.mocked(inspectComputer).mockResolvedValueOnce({
      state: "action_required",
      detail: "Computer status could not be inspected.",
      runtimes: [],
      activeOperations: -1,
      connected: false,
    });

    expect(await migrateLegacyInstallation({ home })).toEqual([]);

    expect(stopIdleComputer).not.toHaveBeenCalled();
    expect((await loadInstance({ name: "default", home }))!.project).toMatch(
      /^linger-default-/,
    );
  });

  it("stops an idle Computer, and leaves one running tasks as it was", async () => {
    const home = await temporary();
    await legacyInstance(home, "default");
    const status = {
      state: "offline" as const,
      detail: "",
      runtimes: [],
      connected: false,
    };
    vi.mocked(inspectComputer).mockResolvedValueOnce({
      ...status,
      activeOperations: 2,
    });

    expect(await migrateLegacyInstallation({ home })).toEqual([
      {
        instance: "default",
        reason:
          "Its Computer is running 2 task(s). Let them finish or stop them, then start Linger again.",
      },
    ]);
    expect(stopIdleComputer).not.toHaveBeenCalled();

    vi.mocked(inspectComputer).mockResolvedValueOnce({
      ...status,
      activeOperations: 0,
    });
    expect(await migrateLegacyInstallation({ home })).toEqual([]);
    expect(stopIdleComputer).toHaveBeenCalledTimes(1);
    expect(await legacyMigrationPending(home)).toBe(false);
  });

  it("converts an instance whose Computer runtime is gone", async () => {
    const home = await temporary();
    await legacyInstance(home, "default");
    vi.mocked(inspectComputer).mockRejectedValueOnce(
      new Error("Managed runtime is not installed"),
    );

    expect(await migrateLegacyInstallation({ home })).toEqual([]);
    expect(stopIdleComputer).not.toHaveBeenCalled();
    expect(await legacyMigrationPending(home)).toBe(false);
  });

  it("converts an idle instance whose stops find nothing to stop", async () => {
    const home = await temporary();
    await legacyInstance(home, "default-current");
    vi.mocked(inspectComputer).mockResolvedValueOnce({
      state: "offline",
      detail: "",
      runtimes: [],
      activeOperations: 0,
      connected: false,
    });
    vi.mocked(stopIdleComputer).mockRejectedValueOnce(
      new Error("Could not stop instance Computer; run linger-computer doctor"),
    );
    vi.mocked(stopNativeProcess).mockRejectedValueOnce(
      Object.assign(new Error("Native postgres process identity changed"), {
        code: NATIVE_PROCESS_REPLACED,
      }),
    );
    vi.mocked(stopModelGateway).mockRejectedValueOnce(
      new Error("The owned model gateway could not be stopped."),
    );

    expect(await migrateLegacyInstallation({ home })).toEqual([]);
    expect(await legacyMigrationPending(home)).toBe(false);
  });

  it("skips an instance whose service is still running, saying so", async () => {
    const home = await temporary();
    await legacyInstance(home, "default");
    await legacyInstance(home, "desktop");
    vi.mocked(stopNativeProcess).mockImplementation(async (root, name) => {
      if (root.endsWith(`${path.sep}default`) && name === "postgres")
        throw new Error(
          "Native postgres did not stop; identity record retained.",
        );
    });

    const skipped = await migrateLegacyInstallation({ home });

    expect(skipped).toEqual([
      {
        instance: "default",
        reason:
          "Its postgres service is still running and could not be stopped (Native postgres did not stop; identity record retained.). Restart this computer, then start Linger again.",
      },
    ]);
    expect(skipped[0]!.reason).not.toMatch(/stop any task/i);
    expect((await loadInstance({ name: "desktop", home }))!.project).toMatch(
      /^linger-desktop-/,
    );
  });

  it("leaves an install from the Docker era as it was", async () => {
    const home = await temporary();
    const root = path.join(home, "instances", "default");
    const record = JSON.stringify({
      name: "default",
      mode: "release",
      root,
      project: "simplex-default-0123456789ab",
    });
    await put(path.join(root, "instance.json"), record);

    expect(await legacyMigrationPending(home)).toBe(false);
    expect(await migrateLegacyInstallation({ home })).toEqual([]);
    expect(inspectComputer).not.toHaveBeenCalled();
    expect(await readFile(path.join(root, "instance.json"), "utf8")).toBe(
      record,
    );
    await expect(loadInstance({ name: "default", home })).rejects.toThrow(
      /ran in Docker/,
    );
  });
});
