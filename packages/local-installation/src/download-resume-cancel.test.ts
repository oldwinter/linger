import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { downloadVerified } from "./download.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

it("stops reading a resumable partial when cancelled and keeps its bytes for retry", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const root = await mkdtemp(path.join(tmpdir(), "download-resume-cancel-"));
  const output = path.join(root, "runtime.tgz");
  const partial = `${output}.part`;
  const bytes = Buffer.alloc(1024 * 1024 + 13, 7);
  const controller = new AbortController();
  const reason = new Error(
    "Installation cancelled during resume verification.",
  );
  let readBytes = 0;
  let firstChunkBytes = 0;
  let closed: Promise<void> | undefined;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    init?.signal?.throwIfAborted();
    return new Response(null, { status: 416 });
  });
  try {
    await writeFile(partial, bytes);
    vi.mocked(createReadStream).mockImplementation((file, options) => {
      const stream = actual.createReadStream(file, options);
      if (file === partial) {
        closed = new Promise<void>((resolve) => stream.once("close", resolve));
        stream.on("data", (chunk: string | Buffer) => {
          readBytes += Buffer.byteLength(chunk);
          if (!controller.signal.aborted) {
            firstChunkBytes = Buffer.byteLength(chunk);
            controller.abort(reason);
          }
        });
      }
      return stream;
    });
    await expect(
      downloadVerified(
        {
          url: "https://example.com/runtime.tgz",
          output,
          algorithm: "sha256",
          digest: createHash("sha256").update(bytes).digest("hex"),
          maxBytes: bytes.length,
          signal: controller.signal,
          resumable: true,
        },
        fetcher,
      ),
    ).rejects.toBe(reason);
    await closed;
    expect(readBytes).toBeGreaterThan(0);
    expect(readBytes).toBe(firstChunkBytes);
    expect(readBytes).toBeLessThan(bytes.length);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(["runtime.tgz.part"]);
    expect((await readFile(partial)).equals(bytes)).toBe(true);
    vi.mocked(createReadStream).mockImplementation(actual.createReadStream);
    await downloadVerified(
      {
        url: "https://example.com/runtime.tgz",
        output,
        algorithm: "sha256",
        digest: createHash("sha256").update(bytes).digest("hex"),
        maxBytes: bytes.length,
        signal: new AbortController().signal,
        resumable: true,
      },
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(["runtime.tgz"]);
    expect((await readFile(output)).equals(bytes)).toBe(true);
  } finally {
    vi.mocked(createReadStream).mockImplementation(actual.createReadStream);
    await rm(root, { recursive: true, force: true });
  }
});
