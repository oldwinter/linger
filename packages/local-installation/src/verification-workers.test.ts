import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { c as archive } from "tar";
import { expect, it, vi } from "vitest";
import { ensureLocalmodelsTool } from "./localmodels-tool.js";
import { REGION_SCHEMA, regionFile } from "./region.js";
import {
  checkNativeRuntime,
  NATIVE_RUNTIME_DIRECTORY,
  NATIVE_RUNTIME_FILES,
} from "./native-runtime.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

it("finishes outstanding kit reads before removing a rejected installation stage", async () => {
  const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const home = await mkdtemp(path.join(tmpdir(), "localmodels-workers-"));
  const held = gate();
  const release = gate();
  const failedRead = gate();
  const finished = gate();
  let reading = false;
  let readerOpened = false;
  let removedWhileReading = false;
  let removedStage: string | undefined;
  let outcome: Promise<unknown> | undefined;
  const hash = (bytes: string | Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  try {
    await mkdir(path.dirname(regionFile(home)), { recursive: true });
    await writeFile(
      regionFile(home),
      JSON.stringify({
        schema: REGION_SCHEMA,
        region: "global",
        resolved_at: new Date().toISOString(),
        method: "probe",
      }),
    );
    const input = path.join(home, "input");
    const kit = path.join(input, "package");
    await mkdir(path.join(kit, "python"), { recursive: true });
    await mkdir(path.join(kit, "modules/localmodels"), { recursive: true });
    const body = JSON.stringify({
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      sourceCommit: "a".repeat(40),
      python: "python/python",
      moduleDir: "modules",
      assets: {
        "python/python": hash("python"),
        "modules/localmodels/__init__.py": hash("package"),
      },
    });
    await writeFile(path.join(kit, "tool.json"), body);
    await writeFile(path.join(kit, "python/python"), "broken");
    await writeFile(
      path.join(kit, "modules/localmodels/__init__.py"),
      "package",
    );
    const tarball = path.join(home, "kit.tgz");
    await archive({ file: tarball, cwd: input, gzip: true }, ["package"]);
    const bytes = await readFile(tarball);
    const source = {
      url: "https://example.com/tool.tgz",
      sha256: hash(bytes),
      bytes: bytes.length,
      sourceCommit: "a".repeat(40),
      manifestSha256: hash(body),
    };
    vi.mocked(createReadStream).mockImplementation((file, options) => {
      const stream = actualFs.createReadStream(file, options);
      if (typeof file !== "string") return stream;
      const damaged = file.endsWith(path.join("python", "python"));
      const slow = file.endsWith(
        path.join("modules", "localmodels", "__init__.py"),
      );
      if (!damaged && !slow) return stream;
      const iterator = stream[Symbol.asyncIterator].bind(stream);
      Object.defineProperty(stream, Symbol.asyncIterator, {
        value: async function* () {
          if (damaged) {
            await held.promise;
            try {
              yield* iterator();
            } finally {
              failedRead.resolve();
            }
            return;
          }
          await once(stream, "open");
          readerOpened = true;
          reading = true;
          held.resolve();
          try {
            await release.promise;
            yield* iterator();
          } finally {
            reading = false;
            finished.resolve();
          }
        },
      });
      return stream;
    });
    vi.mocked(rm).mockImplementation(async (file, options) => {
      if (
        typeof file === "string" &&
        path.basename(file).startsWith("pending-")
      ) {
        removedStage = file;
        removedWhileReading = reading;
      }
      return actual.rm(file, options);
    });
    outcome = ensureLocalmodelsTool(
      home,
      {},
      {
        source,
        fetcher: async () => new Response(bytes),
      },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    await failedRead.promise;
    await setImmediate();
    release.resolve();
    expect(await outcome).toMatchObject({
      message: "Upstream tool payload checksum mismatch.",
    });
    await finished.promise;
    expect(removedWhileReading).toBe(false);
    expect(removedStage).toBeDefined();
    expect(existsSync(removedStage!)).toBe(false);
  } finally {
    release.resolve();
    await outcome;
    if (readerOpened) await finished.promise;
    vi.mocked(createReadStream).mockImplementation(actualFs.createReadStream);
    vi.mocked(rm).mockImplementation(actual.rm);
    await actual.rm(home, { recursive: true, force: true });
  }
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat), rm: vi.fn(actual.rm) };
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("finishes outstanding file reads before removing an invalid runtime", async () => {
  const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const repo = await mkdtemp(path.join(tmpdir(), "native-runtime-workers-"));
  const directory = path.join(repo, NATIVE_RUNTIME_DIRECTORY);
  const held = gate();
  const release = gate();
  const failedStat = gate();
  const finished = gate();
  let reading = false;
  let readerOpened = false;
  let removedWhileReading = false;
  const entries = [
    "web/static-host.mjs",
    "web/dist/index.html",
    "node-services/dist/main.js",
    "node-services/dist/supervisor.js",
  ];
  const files: Record<string, { bytes: number; sha256: string }> = {};
  let checking: ReturnType<typeof checkNativeRuntime> | undefined;
  try {
    for (const file of entries) {
      const body = `contents of ${file}`;
      await mkdir(path.dirname(path.join(directory, file)), {
        recursive: true,
      });
      await writeFile(path.join(directory, file), body);
      files[file] = {
        bytes: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
      };
    }
    await writeFile(
      path.join(directory, NATIVE_RUNTIME_FILES),
      JSON.stringify({
        schema: 1,
        target: "linux-x64",
        sourceCommit: "a".repeat(40),
        sourceArchiveSha256: "b".repeat(64),
        files,
      }),
    );
    const damaged = path.join(directory, entries[0]!);
    const slow = path.join(directory, entries[1]!);
    await writeFile(damaged, "truncated");
    vi.mocked(createReadStream).mockImplementation((file, options) => {
      const stream = actualFs.createReadStream(file, options);
      if (file === slow) {
        const iterator = stream[Symbol.asyncIterator].bind(stream);
        Object.defineProperty(stream, Symbol.asyncIterator, {
          value: async function* () {
            await once(stream, "open");
            readerOpened = true;
            reading = true;
            held.resolve();
            try {
              await release.promise;
              yield* iterator();
            } finally {
              reading = false;
              finished.resolve();
            }
          },
        });
      }
      return stream;
    });
    vi.mocked(stat).mockImplementation(async (file, options) => {
      if (file === damaged) {
        await held.promise;
        const info = await actual.stat(file, options);
        failedStat.resolve();
        return info;
      }
      return actual.stat(file, options);
    });
    vi.mocked(rm).mockImplementation(async (file, options) => {
      if (file === directory) removedWhileReading = reading;
      return actual.rm(file, options);
    });
    checking = checkNativeRuntime(repo, { target: "linux-x64" });
    await failedStat.promise;
    // Drain the mismatch's promise continuations while the other real file
    // remains open. No elapsed-time threshold controls the held reader.
    await setImmediate();
    release.resolve();
    expect(await checking).toBe("removed");
    await finished.promise;
    expect(reading).toBe(false);
    expect(removedWhileReading).toBe(false);
    expect(existsSync(directory)).toBe(false);
  } finally {
    release.resolve();
    await checking?.catch(() => {});
    if (readerOpened) await finished.promise;
    vi.mocked(createReadStream).mockImplementation(actualFs.createReadStream);
    vi.mocked(stat).mockImplementation(actual.stat);
    vi.mocked(rm).mockImplementation(actual.rm);
    await actual.rm(repo, { recursive: true, force: true });
  }
});
