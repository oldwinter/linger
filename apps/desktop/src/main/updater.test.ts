import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ComputerDaemonModule } from "./computer-daemon.js";
import type { DesktopConfig } from "./config.js";
import { stubModule, tempDirectory, testHost } from "./test-support.js";
import {
  type SpawnSetup,
  type UpdateState,
  type UpdaterOptions,
  UpdaterModule,
  appBundleOf,
  updateInstallFor,
} from "./updater.js";

const RELEASES = "https://github.com/simplexai-labs/linger/releases";
const PACKAGE = Buffer.from("new app archive");

const release = (
  version: string,
  {
    body = PACKAGE,
    target = "darwin-arm64",
    file = `Linger-${version}-macos-arm64.app.tar.gz`,
    feed = RELEASES,
  } = {},
) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = Buffer.from(
    JSON.stringify({
      schema: 2,
      version,
      packages: {
        [target]: {
          file,
          sha256: createHash("sha256").update(PACKAGE).digest("hex"),
          size: PACKAGE.length,
        },
      },
    }),
  );
  const files: Record<string, Buffer> = {
    [`${feed}/latest/download/manifest.json`]: manifest,
    [`${feed}/latest/download/manifest.json.sig`]: Buffer.from(
      sign(null, manifest, privateKey).toString("base64"),
    ),
    [`${feed}/download/desktop-v${version}/${file}`]: body,
  };
  const requested: string[] = [];
  const fetch = (async (url: URL) => {
    requested.push(url.toString());
    const content = files[url.toString()];
    return content
      ? new Response(new Uint8Array(content))
      : new Response("missing", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    files,
    requested,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
};

const setup = async (
  feed: ReturnType<typeof release>,
  options: Partial<UpdaterOptions> = {},
  config: Partial<DesktopConfig> = {},
) => {
  const root = tempDirectory();
  const applications = path.join(root, "Applications");
  const bundle = path.join(applications, "Linger.app");
  mkdirSync(bundle, { recursive: true });
  writeFileSync(path.join(bundle, "version"), "0.16.7");
  const downloads = path.join(root, "updates");
  let running = 0;
  let restarts = 0;
  let quits = 0;
  const opened: string[] = [];
  const announced: UpdateState[] = [];
  const runtime = {
    ...stubModule("ComputerDaemon"),
    running: () => running,
  } as unknown as ComputerDaemonModule;
  const updater = new UpdaterModule({
    version: "0.16.7",
    platform: "darwin",
    arch: "arm64",
    install: { kind: "app-bundle", appBundle: bundle },
    downloadDirectory: downloads,
    restart: async () => {
      restarts += 1;
    },
    quit: async () => {
      quits += 1;
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    announce: (state) => announced.push(state),
    fetch: feed.fetch,
    publicKey: feed.publicKey,
    checkDelayMs: 60 * 60_000,
    // The test archive holds the new version marker, not a real tarball.
    extract: async (archive, directory) => {
      const app = path.join(directory, "Linger.app");
      mkdirSync(app);
      writeFileSync(path.join(app, "version"), readFileSync(archive));
    },
    ...options,
  });
  const host = testHost([stubModule("Config"), runtime, updater], config);
  await host.start();
  const setRunning = (n: number) => {
    running = n;
    host.ctx.bus.emit("runtime.activity", n);
  };
  return {
    host,
    updater,
    bundle,
    applications,
    downloads,
    setRunning,
    opened,
    announced,
    restarts: () => restarts,
    quits: () => quits,
  };
};

describe("UpdaterModule", () => {
  it("installs a verified update from the latest release once running tasks finish", async () => {
    const feed = release("0.17.0");
    const {
      updater,
      bundle,
      applications,
      setRunning,
      restarts,
      host,
      announced,
    } = await setup(feed);
    await updater.check();
    expect(updater.state()).toEqual({ kind: "ready", version: "0.17.0" });
    expect(feed.requested).toEqual([
      `${RELEASES}/latest/download/manifest.json`,
      `${RELEASES}/latest/download/manifest.json.sig`,
      // From the release the signed manifest names, not whatever is latest
      // by the time of the download.
      `${RELEASES}/download/desktop-v0.17.0/Linger-0.17.0-macos-arm64.app.tar.gz`,
    ]);
    expect(announced).toEqual([{ kind: "ready", version: "0.17.0" }]);
    expect(readFileSync(path.join(bundle, "version"), "utf8")).toBe("0.16.7");

    setRunning(1);
    await updater.install();
    expect(updater.state()).toEqual({ kind: "waiting", version: "0.17.0" });
    expect(restarts()).toBe(0);

    setRunning(0);
    await waitFor(() => restarts() === 1);
    expect(readFileSync(path.join(bundle, "version"), "utf8")).toBe(
      PACKAGE.toString(),
    );
    // The replaced bundle stays until the next launch cleans it up.
    expect(readdirSync(applications).sort()).toEqual([
      expect.stringMatching(/^\.Linger-old-/),
      "Linger.app",
    ]);
    await host.stop("update");
    const next = new UpdaterModule({
      version: "0.17.0",
      platform: "darwin",
      arch: "arm64",
      install: { kind: "app-bundle", appBundle: bundle },
      downloadDirectory: tempDirectory(),
      restart: async () => {},
      quit: async () => {},
      openExternal: async () => {},
      checkDelayMs: 60 * 60_000,
    });
    await testHost([stubModule("Config"), stubModule("ComputerDaemon"), next])
      .start()
      .then(() => waitFor(() => readdirSync(applications).length === 1));
    expect(readdirSync(applications)).toEqual(["Linger.app"]);
  });

  it("refuses a manifest signed by another key", async () => {
    const feed = {
      ...release("0.17.0"),
      publicKey: release("0.17.0").publicKey,
    };
    const { updater } = await setup(feed);
    await updater.check();
    expect(updater.state()).toEqual({
      kind: "failed",
      error: "Update signature does not match",
    });
    expect(feed.requested).toHaveLength(2);
  });

  it("refuses a package that does not match its checksum", async () => {
    const feed = release("0.17.0", { body: Buffer.from("new app archivX") });
    const { updater, downloads, applications } = await setup(feed);
    await updater.check();
    expect(updater.state()).toEqual({
      kind: "failed",
      error: "Update package does not match its checksum",
    });
    expect(readdirSync(downloads)).toEqual([]);
    expect(readdirSync(applications)).toEqual(["Linger.app"]);
    await updater.install();
    expect(updater.state().kind).toBe("failed");
  });

  it("retries a dropped download soon instead of waiting a full interval", async () => {
    const feed = release("0.17.0");
    let drops = 1;
    const flaky = (async (url: URL) => {
      if (url.pathname.endsWith(".tar.gz") && drops-- > 0)
        throw new TypeError("terminated");
      return feed.fetch(url);
    }) as unknown as typeof globalThis.fetch;
    const { updater, host } = await setup(feed, {
      fetch: flaky,
      checkDelayMs: 1,
      retryDelayMs: 1,
      checkIntervalMs: 60 * 60_000,
    });
    await waitFor(() => updater.state().kind === "ready");
    expect(updater.state()).toEqual({ kind: "ready", version: "0.17.0" });
    await host.stop("quit");
  });

  it("stays idle when the latest release is not newer", async () => {
    const feed = release("0.16.7");
    const { updater } = await setup(feed);
    await updater.check();
    expect(updater.state()).toEqual({ kind: "idle" });
    expect(feed.requested).toHaveLength(2);
  });

  it("updates a prerelease to its release", async () => {
    const feed = release("0.16.7");
    const { updater } = await setup(feed, { version: "0.16.7-rc.2" });
    await updater.check();
    expect(updater.state()).toEqual({ kind: "ready", version: "0.16.7" });
  });

  it("stays idle when the latest release has no manifest", async () => {
    const feed = release("0.17.0");
    delete feed.files[`${RELEASES}/latest/download/manifest.json.sig`];
    const { updater, announced } = await setup(feed);
    await updater.check();
    expect(updater.state()).toEqual({ kind: "idle" });
    expect(announced).toEqual([]);
  });

  it("reads the feed the config names and refuses one without https", async () => {
    const own = "https://releases.example.com/linger";
    const feed = release("0.17.0", { feed: own });
    const { updater } = await setup(feed, {}, { updateFeedUrl: own });
    await updater.check();
    expect(updater.state()).toEqual({ kind: "ready", version: "0.17.0" });
    expect(feed.requested[0]).toBe(`${own}/latest/download/manifest.json`);

    const plain = await setup(
      release("0.17.0"),
      {},
      { updateFeedUrl: "http://releases.example.com/linger" },
    );
    await plain.updater.check();
    expect(plain.updater.state()).toEqual({
      kind: "failed",
      error: "The update feed must use https",
    });
  });
});

describe("UpdaterModule with the Windows setup program", () => {
  const SETUP = "Linger-0.17.0-windows-x64-setup.exe";
  const windows = async (spawn: SpawnSetup) => {
    const feed = release("0.17.0", { target: "win32-x64", file: SETUP });
    return {
      feed,
      ...(await setup(feed, {
        platform: "win32",
        arch: "x64",
        install: { kind: "windows-setup" },
        spawn,
      })),
    };
  };
  const recorder = () => {
    const calls: { file: string; args: readonly string[]; options: object }[] =
      [];
    const spawn: SpawnSetup = (file, args, options) => {
      calls.push({ file, args, options });
      const child = Object.assign(new EventEmitter(), { unref: () => {} });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    };
    return { calls, spawn };
  };

  it("runs the verified setup program silently once tasks finish, then quits", async () => {
    const { calls, spawn } = recorder();
    const { updater, downloads, feed, setRunning, quits, restarts } =
      await windows(spawn);
    await updater.check();
    expect(feed.requested.at(-1)).toBe(
      `${RELEASES}/download/desktop-v0.17.0/${SETUP}`,
    );
    expect(updater.state()).toEqual({ kind: "ready", version: "0.17.0" });
    expect(readdirSync(downloads)).toEqual([SETUP]);

    setRunning(2);
    await updater.install();
    expect(updater.state()).toEqual({ kind: "waiting", version: "0.17.0" });
    expect(calls).toEqual([]);

    setRunning(0);
    await waitFor(() => quits() === 1);
    expect(calls).toEqual([
      {
        file: path.join(downloads, SETUP),
        args: ["/update", "/relaunch"],
        options: { detached: true, stdio: "ignore" },
      },
    ]);
    expect(restarts()).toBe(0);
  });

  it("does not run a setup program that changed after its download", async () => {
    const { calls, spawn } = recorder();
    const { updater, downloads, quits } = await windows(spawn);
    await updater.check();
    writeFileSync(path.join(downloads, SETUP), "something else");
    await updater.install();
    expect(updater.state()).toEqual({
      kind: "failed",
      error: "Update package does not match its checksum",
    });
    expect(calls).toEqual([]);
    expect(quits()).toBe(0);
  });

  it("stays when the setup program cannot start", async () => {
    const spawn: SpawnSetup = () => {
      const child = Object.assign(new EventEmitter(), { unref: () => {} });
      queueMicrotask(() => child.emit("error", new Error("spawn EACCES")));
      return child;
    };
    const { updater, quits } = await windows(spawn);
    await updater.check();
    await updater.install();
    expect(updater.state()).toEqual({
      kind: "failed",
      error: "Error: spawn EACCES",
    });
    expect(quits()).toBe(0);
  });
});

describe("UpdaterModule for a download", () => {
  it("links a newer release without downloading it", async () => {
    const feed = release("0.17.0", {
      target: "linux-x64",
      file: "Linger-0.17.0-linux-x64.tar.gz",
    });
    const { updater, opened, announced, downloads } = await setup(feed, {
      platform: "linux",
      arch: "x64",
      install: { kind: "download" },
    });
    await updater.check();
    const available = {
      kind: "available",
      version: "0.17.0",
      url: `${RELEASES}/tag/desktop-v0.17.0`,
    };
    expect(updater.state()).toEqual(available);
    expect(feed.requested).toHaveLength(2);
    expect(() => readdirSync(downloads)).toThrow();

    await updater.check();
    expect(announced).toEqual([available]);
    await updater.install();
    expect(opened).toEqual([available.url]);
    expect(updater.state()).toEqual(available);
  });

  it("stays idle when the release has nothing for this platform", async () => {
    const feed = release("0.17.0");
    const { updater } = await setup(feed, {
      platform: "linux",
      arch: "x64",
      install: { kind: "download" },
    });
    await updater.check();
    expect(updater.state()).toEqual({ kind: "idle" });
  });
});

describe("updateInstallFor", () => {
  it("swaps the macOS bundle, runs the Windows setup and links elsewhere", () => {
    const none = () => false;
    expect(
      updateInstallFor(
        "darwin",
        "/Applications/Linger.app/Contents/MacOS/Linger",
        none,
      ),
    ).toEqual({ kind: "app-bundle", appBundle: "/Applications/Linger.app" });
    const installed = "C:\\Users\\a\\AppData\\Local\\Programs\\Linger";
    expect(
      updateInstallFor(
        "win32",
        `${installed}\\Linger.exe`,
        (file) => file === `${installed}\\Uninstall Linger.exe`,
      ),
    ).toEqual({ kind: "windows-setup" });
    // The portable folder has no uninstaller.
    expect(updateInstallFor("win32", "D:\\Linger\\Linger.exe", none)).toEqual({
      kind: "download",
    });
    expect(updateInstallFor("linux", "/opt/linger/linger", none)).toEqual({
      kind: "download",
    });
  });
});

describe("appBundleOf", () => {
  it("finds the app bundle around the executable", () => {
    expect(appBundleOf("/Applications/Linger.app/Contents/MacOS/Linger")).toBe(
      "/Applications/Linger.app",
    );
    expect(appBundleOf("/usr/lib/electron/electron")).toBeUndefined();
  });
});

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out");
};
