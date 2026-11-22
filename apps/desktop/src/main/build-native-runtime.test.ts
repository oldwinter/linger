import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { copyExternals } from "../../scripts/build-native-runtime.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// A hoisted node_modules as `pnpm deploy --config.node-linker=hoisted` writes
// it, with officeparser and the dependencies its 8.2.0 manifest declares.
const deployed = () => {
  const root = mkdtempSync(path.join(tmpdir(), "build-native-runtime-"));
  roots.push(root);
  const add = (name: string, dependencies: Record<string, string> = {}) => {
    const directory = path.join(root, "deploy/node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ name, version: "1.0.0", dependencies }),
    );
    writeFileSync(path.join(directory, "index.js"), "");
  };
  add("officeparser", { "pdfjs-dist": "1", "tesseract.js": "1" });
  add("pdfjs-dist");
  add("tesseract.js", { "tesseract.js-core": "1", "node-fetch": "1" });
  add("tesseract.js-core");
  add("node-fetch");
  return root;
};

it("leaves out the OCR engine officeparser only loads with OCR on", async () => {
  const root = deployed();
  const output = path.join(root, "output");
  const result = await copyExternals(path.join(root, "deploy"), output, [
    "officeparser",
  ]);
  expect(result.packages.map((item) => item.package).sort()).toEqual([
    "node_modules/officeparser",
    "node_modules/pdfjs-dist",
  ]);
  expect(result.excluded).toEqual({});
  expect(existsSync(path.join(output, "node_modules/officeparser"))).toBe(true);
  for (const name of ["tesseract.js", "tesseract.js-core", "node-fetch"])
    expect(existsSync(path.join(output, "node_modules", name))).toBe(false);
});
