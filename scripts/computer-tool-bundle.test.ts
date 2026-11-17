import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  nodeRuntimeEntry,
  recordSignedComputerTools,
  validatedComputerToolBundle,
} from "./computer-tool-bundle.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

const checksum = (content: Buffer) =>
  createHash("sha256").update(content).digest("hex");
const macho = (text: string) =>
  Buffer.concat([Buffer.from("cffaedfe", "hex"), Buffer.from(text)]);

// What stageComputerTools and stagePinnedNodeRuntime write, without the
// packages and the downloads.
async function stagedBundle(target: string) {
  const bundle = await mkdtemp(path.join(os.tmpdir(), "computer-tool-bundle-"));
  temporaryRoots.push(bundle);
  const tools = path.join(bundle, "cli/computer-tools");
  const files: Record<string, Buffer> = {
    "extensions/pi-mcp.mjs": Buffer.from("export default {}\n"),
    "node_modules/@playwright/mcp/cli.js": Buffer.from("console.log(1)\n"),
    "node_modules/native/prebuilt.node": macho("native"),
  };
  if (target.startsWith("darwin-")) {
    files["cua/CuaDriver.app/Contents/MacOS/cua-driver"] = macho("app");
    files["cua/cua-driver"] = macho("driver");
  }
  const assets = [];
  for (const name of Object.keys(files).sort()) {
    await mkdir(path.dirname(path.join(tools, name)), { recursive: true });
    await writeFile(path.join(tools, name), files[name]);
    assets.push({
      path: name,
      size_bytes: files[name].length,
      sha256: checksum(files[name]),
      mode: 0o644,
    });
  }
  await writeFile(
    path.join(tools, "manifest.json"),
    JSON.stringify({
      schema_version: 1,
      versions: { playwright: "0.0.83", pi: "1.2.0", cua: "0.35.4" },
      target,
      playwright_entry: "node_modules/@playwright/mcp/cli.js",
      pi_extension: "extensions/pi-mcp.mjs",
      cua_entry: target.startsWith("darwin-") ? "cua/cua-driver" : "",
      packages: [],
      assets,
      artifact_sha256: checksum(Buffer.from(JSON.stringify(assets))),
    }),
  );
  const node = path.join(bundle, nodeRuntimeEntry(target));
  await mkdir(path.dirname(node), { recursive: true });
  await writeFile(node, "node");
  await chmod(node, 0o755);
  return { bundle, tools };
}

describe("Computer tool bundle", () => {
  it("accepts the staged tools with an executable Node.js", async () => {
    const { bundle } = await stagedBundle("linux-x64");
    expect(await validatedComputerToolBundle(bundle, "linux-x64")).toContain(
      "cli/computer-tools/manifest.json",
    );
  });

  it("rejects missing, changed or misplaced tools and a non-executable Node.js", async () => {
    const empty = await mkdtemp(
      path.join(os.tmpdir(), "computer-tool-bundle-"),
    );
    temporaryRoots.push(empty);
    await expect(
      validatedComputerToolBundle(empty, "linux-x64"),
    ).rejects.toThrow();

    const changed = await stagedBundle("linux-x64");
    await writeFile(
      path.join(changed.tools, "extensions/pi-mcp.mjs"),
      "changed\n",
    );
    await expect(
      validatedComputerToolBundle(changed.bundle, "linux-x64"),
    ).rejects.toThrow("do not match their manifest");

    const other = await stagedBundle("linux-x64");
    await expect(
      validatedComputerToolBundle(other.bundle, "linux-arm64"),
    ).rejects.toThrow("Invalid Computer tool manifest");

    const { bundle } = await stagedBundle("linux-x64");
    await chmod(path.join(bundle, nodeRuntimeEntry("linux-x64")), 0o644);
    await expect(
      validatedComputerToolBundle(bundle, "linux-x64"),
    ).rejects.toThrow("not executable");
  });

  it("records re-signed Mach-O files but keeps vendor-signed ones as they were", async () => {
    const { bundle, tools } = await stagedBundle("darwin-arm64");
    for (const name of ["node_modules/native/prebuilt.node", "cua/cua-driver"])
      await writeFile(
        path.join(tools, name),
        Buffer.concat([await readFile(path.join(tools, name)), macho("sig")]),
      );
    await recordSignedComputerTools(bundle, ["cua/cua-driver"]);
    await expect(
      validatedComputerToolBundle(bundle, "darwin-arm64"),
    ).rejects.toThrow("do not match their manifest");

    await writeFile(path.join(tools, "cua/cua-driver"), macho("driver"));
    await validatedComputerToolBundle(bundle, "darwin-arm64");

    // Only Mach-O files: any other change still fails.
    await writeFile(path.join(tools, "extensions/pi-mcp.mjs"), "changed\n");
    await recordSignedComputerTools(bundle);
    await expect(
      validatedComputerToolBundle(bundle, "darwin-arm64"),
    ).rejects.toThrow("do not match their manifest");
  });

  it("checks a bundle from the command line for the packaging scripts", async () => {
    const script = path.join(import.meta.dirname, "computer-tool-bundle.mjs");
    const { bundle } = await stagedBundle("linux-x64");
    await promisify(execFile)(process.execPath, [
      script,
      "verify",
      bundle,
      "linux-x64",
    ]);
    await expect(
      promisify(execFile)(process.execPath, [
        script,
        "verify",
        bundle,
        "win32-x64",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Invalid Computer tool manifest"),
    });
  });
});
