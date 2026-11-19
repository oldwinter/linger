import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { atomicPrivate } from "./private-files.js";

const failure = vi.hoisted(() => ({
  stage: undefined as "write" | "sync" | undefined,
  error: Object.assign(new Error("Private write failed"), { code: "ENOSPC" }),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (args[1] === "wx" && failure.stage === "write") {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, "writeFile").mockImplementationOnce(async () => {
          await write("partial private contents");
          throw failure.error;
        });
      } else if (args[1] === "wx" && failure.stage === "sync") {
        vi.spyOn(handle, "sync").mockRejectedValueOnce(failure.error);
      }
      return handle;
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  failure.stage = undefined;
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it.each(["write", "sync"] as const)(
  "removes a temporary private file after a %s failure and permits retry",
  async (stage) => {
    const root = await mkdtemp(path.join(tmpdir(), "linger-private-write-"));
    roots.push(root);
    const file = path.join(root, "settings.json");
    await writeFile(file, "previous private contents", { mode: 0o600 });

    failure.stage = stage;
    await expect(atomicPrivate(file, "new private contents")).rejects.toBe(
      failure.error,
    );
    expect(await readFile(file, "utf8")).toBe("previous private contents");
    expect(await readdir(root)).toEqual(["settings.json"]);

    failure.stage = undefined;
    await atomicPrivate(file, "new private contents");
    expect(await readFile(file, "utf8")).toBe("new private contents");
    expect(await readdir(root)).toEqual(["settings.json"]);
  },
);
