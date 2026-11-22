import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { downloadVerified } from "./download.js";

it.each(["sha256", "sha512"] as const)(
  "publishes a complete saved download without a network request (%s)",
  async (algorithm) => {
    const root = await mkdtemp(path.join(tmpdir(), "download-complete-"));
    const output = path.join(root, "runtime.tgz");
    const bytes = Buffer.from("complete trusted runtime archive");
    const options = {
      url: "https://example.com/runtime.tgz",
      output,
      algorithm,
      digest: createHash(algorithm).update(bytes).digest("hex"),
      maxBytes: bytes.length,
      resumable: true,
    };
    const timing = { attempts: 1, retryDelayMs: 0, idleTimeoutMs: 1_000 };
    const cancelled = new AbortController();
    const reason = new Error("Cancelled before publication.");
    try {
      await expect(
        downloadVerified(
          {
            ...options,
            signal: cancelled.signal,
            onProgress(completed) {
              if (completed === bytes.length) cancelled.abort(reason);
            },
          },
          async () => new Response(bytes),
          timing,
        ),
      ).rejects.toBe(reason);
      expect(await readdir(root)).toEqual(["runtime.tgz.part"]);
      expect(await readFile(`${output}.part`)).toEqual(bytes);

      const offline = vi.fn<typeof fetch>(async () => {
        throw new TypeError("Network unavailable.");
      });
      const progress = vi.fn();
      await downloadVerified(
        {
          ...options,
          signal: new AbortController().signal,
          onProgress: progress,
        },
        offline,
        timing,
      );
      expect(offline).not.toHaveBeenCalled();
      expect(progress).toHaveBeenLastCalledWith(bytes.length, bytes.length);
      expect(await readdir(root)).toEqual(["runtime.tgz"]);
      expect(await readFile(output)).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each(["incomplete", "damaged"])(
  "still requests bytes when the saved download is %s",
  async (kind) => {
    const root = await mkdtemp(path.join(tmpdir(), "download-incomplete-"));
    const output = path.join(root, "runtime.tgz");
    const bytes = Buffer.from("trusted runtime archive");
    const partial =
      kind === "incomplete" ? bytes.subarray(0, 7) : Buffer.alloc(bytes.length);
    try {
      await writeFile(`${output}.part`, partial);
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
        expect(new Headers(init?.headers).get("range")).toBe(
          `bytes=${partial.length}-`,
        );
        if (kind === "damaged") return new Response(null, { status: 416 });
        return new Response(bytes.subarray(partial.length), {
          status: 206,
          headers: {
            "content-range": `bytes ${partial.length}-${bytes.length - 1}/${bytes.length}`,
          },
        });
      });
      const result = downloadVerified(
        {
          url: "https://example.com/runtime.tgz",
          output,
          algorithm: "sha256",
          digest: createHash("sha256").update(bytes).digest("hex"),
          maxBytes: bytes.length,
          resumable: true,
          signal: new AbortController().signal,
        },
        fetcher,
      );
      if (kind === "damaged") await expect(result).rejects.toThrow(/checksum/i);
      else {
        await result;
        expect(await readFile(output)).toEqual(bytes);
      }
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await readdir(root)).toEqual(
        kind === "damaged" ? [] : ["runtime.tgz"],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
