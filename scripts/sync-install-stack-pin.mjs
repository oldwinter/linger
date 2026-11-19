#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MARKER_BEGIN = "# >>> stack release pin";
const MARKER_END = "# <<< stack release pin";
const BLOCK_PATTERN =
  /# >>> stack release pin\r?\n[\s\S]*?\r?\n# <<< stack release pin/g;

function parseArgs(argv) {
  let mode = "check";
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") {
      mode = "write";
    } else if (arg === "--check") {
      mode = "check";
    } else if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--root requires a directory path");
      }
      root = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { mode, root };
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readPinField(text, pattern, label, file) {
  const match = pattern.exec(text);
  if (!match?.[1]) {
    throw new Error(`Missing ${label} in ${file}`);
  }
  return match[1];
}

function readSourcePins(root) {
  const stackShRel = "scripts/installs/stack.sh";
  const stackPs1Rel = "scripts/installs/stack.ps1";
  const shBytes = readFileSync(path.join(root, stackShRel));
  const psBytes = readFileSync(path.join(root, stackPs1Rel));
  const shText = shBytes.toString("utf8");
  const psText = psBytes.toString("utf8");

  const shVersion = readPinField(
    shText,
    /^STACK_VERSION='([^']+)'/m,
    "STACK_VERSION",
    stackShRel,
  );
  const shNpm = readPinField(
    shText,
    /^STACK_NPM_VERSION='([^']+)'/m,
    "STACK_NPM_VERSION",
    stackShRel,
  );
  const psVersion = readPinField(
    psText,
    /^\$StackVersion = '([^']+)'/m,
    "$StackVersion",
    stackPs1Rel,
  );
  const psNpm = readPinField(
    psText,
    /^\$StackNpmVersion = '([^']+)'/m,
    "$StackNpmVersion",
    stackPs1Rel,
  );

  if (shVersion !== psVersion) {
    throw new Error(
      `Version mismatch between ${stackShRel} (${shVersion}) and ${stackPs1Rel} (${psVersion})`,
    );
  }
  if (shNpm !== psNpm) {
    throw new Error(
      `npm version mismatch between ${stackShRel} (${shNpm}) and ${stackPs1Rel} (${psNpm})`,
    );
  }

  return {
    version: shVersion,
    npmVersion: shNpm,
    shSha256: sha256Hex(shBytes),
    psSha256: sha256Hex(psBytes),
  };
}

function renderShellBlock(pins, eol) {
  return [
    MARKER_BEGIN,
    `STACK_PIN_NPM_VERSION='${pins.npmVersion}'`,
    `STACK_PIN_SHA256='${pins.shSha256}'`,
    MARKER_END,
  ].join(eol);
}

function renderPowershellBlock(pins, eol) {
  return [
    MARKER_BEGIN,
    `$script:StackPinNpmVersion = '${pins.npmVersion}'`,
    `$script:StackPinSha256 = '${pins.psSha256}'`,
    MARKER_END,
  ].join(eol);
}

function syncTarget(root, relativePath, renderBlock) {
  const fullPath = path.join(root, relativePath);
  const current = readFileSync(fullPath, "utf8");
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const matches = [...current.matchAll(BLOCK_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one '${MARKER_BEGIN}'..'${MARKER_END}' block in ${relativePath}, found ${matches.length}`,
    );
  }
  const expectedBlock = renderBlock(eol);
  const existingBlock = matches[0][0];
  const updated =
    existingBlock === expectedBlock
      ? current
      : current.slice(0, matches[0].index) +
        expectedBlock +
        current.slice(matches[0].index + existingBlock.length);
  return {
    relativePath,
    fullPath,
    changed: updated !== current,
    updated,
  };
}

function main() {
  const { mode, root } = parseArgs(process.argv.slice(2));
  const pins = readSourcePins(root);
  const results = [
    syncTarget(root, "scripts/install/install.sh", (eol) =>
      renderShellBlock(pins, eol),
    ),
    syncTarget(root, "scripts/install/install.ps1", (eol) =>
      renderPowershellBlock(pins, eol),
    ),
  ];

  const drifted = results.filter((entry) => entry.changed);
  if (mode === "write") {
    for (const entry of drifted) {
      writeFileSync(entry.fullPath, entry.updated, "utf8");
      process.stdout.write(`Updated ${entry.relativePath}\n`);
    }
    if (drifted.length === 0) {
      process.stdout.write("Install stack release pins are up to date.\n");
    }
    return;
  }

  if (drifted.length > 0) {
    const names = drifted.map((entry) => entry.relativePath).join(", ");
    process.stderr.write(
      `Stack release pin drift in: ${names}\nRun: node scripts/sync-install-stack-pin.mjs --write\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Verified install stack pins (${pins.version} / ${pins.npmVersion}).\n`,
  );
}

main();
