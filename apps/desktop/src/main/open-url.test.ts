import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openWithXdg } from "./open-url.js";

const clean: string[] = [];
afterEach(async () => {
  for (const dir of clean.splice(0))
    await rm(dir, { recursive: true, force: true });
});

// A stand-in xdg-open that runs the given script.
const opener = async (script: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "xdg-open-"));
  clean.push(dir);
  const command = path.join(dir, "xdg-open");
  await writeFile(command, `#!${process.execPath}\n${script}`, {
    mode: 0o700,
  });
  return command;
};

describe.skipIf(process.platform === "win32")("openWithXdg", () => {
  it("opens when xdg-open exits cleanly", async () => {
    const command = await opener("process.exit(0)");
    await expect(
      openWithXdg("https://example.com", { command }),
    ).resolves.toBeUndefined();
  });

  it("fails when xdg-open finds no browser", async () => {
    // xdg-open exits 3 when it has no way to open the link.
    const command = await opener("process.exit(3)");
    await expect(
      openWithXdg("https://example.com", { command }),
    ).rejects.toThrow("xdg-open exited with 3");
  });

  it("fails when there is no xdg-open", async () => {
    await expect(
      openWithXdg("https://example.com", {
        command: path.join(tmpdir(), "no-such-xdg-open"),
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it("counts a browser that keeps running as opened", async () => {
    const command = await opener("setTimeout(() => {}, 2000)");
    await expect(
      openWithXdg("https://example.com", { command, waitMs: 100 }),
    ).resolves.toBeUndefined();
  });
});
