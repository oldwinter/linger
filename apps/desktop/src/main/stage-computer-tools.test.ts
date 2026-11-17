import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  computerToolsDirectory,
  stageDesktopComputerTools,
} from "../../scripts/stage-computer-tools.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const dist = () => {
  const root = mkdtempSync(path.join(tmpdir(), "stage-computer-tools-"));
  roots.push(root);
  return root;
};

// Stands in for scripts/computer-tool-bundle.mjs: the staged bundle is valid
// when it holds the target's manifest and Node.js.
const staged: string[] = [];
const stage = async (bundle: string, target: string) => {
  staged.push(target);
  mkdirSync(path.join(bundle, "cli/computer-tools"), { recursive: true });
  mkdirSync(path.join(bundle, "runtime/bin"), { recursive: true });
  writeFileSync(path.join(bundle, "cli/computer-tools/manifest.json"), target);
  writeFileSync(path.join(bundle, "runtime/bin/node"), "node");
  return ["cli/computer-tools/manifest.json"];
};
const validate = async (bundle: string, target: string) => {
  if (
    readFileSync(
      path.join(bundle, "cli/computer-tools/manifest.json"),
      "utf8",
    ) !== target
  )
    throw new Error("Invalid Computer tool manifest");
  return ["cli/computer-tools/manifest.json"];
};

it("stages each target's tools and links this machine's for the source daemon", async () => {
  const root = dist();
  staged.length = 0;
  await stageDesktopComputerTools(["linux-x64", "linux-arm64"], {
    dist: root,
    host: "linux-x64",
    stage,
    validate,
  });
  expect(staged).toEqual(["linux-x64", "linux-arm64"]);
  // dist/computer/<target>/linger-computer-daemon finds them two folders up.
  expect(realpathSync(path.join(root, "computer/cli/computer-tools"))).toBe(
    realpathSync(
      path.join(
        computerToolsDirectory("linux-x64", root),
        "cli/computer-tools",
      ),
    ),
  );
  expect(existsSync(path.join(root, "computer/runtime/bin/node"))).toBe(true);
});

it("keeps tools that still validate and restages the others", async () => {
  const root = dist();
  await stageDesktopComputerTools(["linux-x64", "linux-arm64"], {
    dist: root,
    stage,
    validate,
  });
  writeFileSync(
    path.join(
      computerToolsDirectory("linux-arm64", root),
      "cli/computer-tools/manifest.json",
    ),
    "changed",
  );
  staged.length = 0;
  await stageDesktopComputerTools(["linux-x64", "linux-arm64"], {
    dist: root,
    stage,
    validate,
  });
  expect(staged).toEqual(["linux-arm64"]);

  // A new Node.js pin restages the tools that run on it.
  staged.length = 0;
  await stageDesktopComputerTools(["linux-x64", "linux-arm64"], {
    dist: root,
    stage,
    validate,
    nodeReleases: { "linux-x64": { archive: "node-next.tar.xz" } },
  });
  expect(staged).toEqual(["linux-x64", "linux-arm64"]);
});

it("fails the build when staging fails", async () => {
  await expect(
    stageDesktopComputerTools(["linux-x64"], {
      dist: dist(),
      stage: async () => {
        throw new Error("Computer tool assets do not match their manifest");
      },
      validate,
    }),
  ).rejects.toThrow("do not match their manifest");
});
