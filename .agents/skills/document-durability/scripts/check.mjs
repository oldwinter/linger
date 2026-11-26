#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TLC_VERSION = "1.7.4";
const TLC_URL = `https://github.com/tlaplus/tlaplus/releases/download/v${TLC_VERSION}/tla2tools.jar`;
const TLC_SHA256 =
  "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const CACHE_JAR = path.join(
  os.homedir(),
  ".cache",
  "linger-formal-verification",
  `tla2tools-${TLC_VERSION}.jar`,
);
const JAVA_FALLBACK_TOOL = "java@temurin-25";

const skillDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const specSource = path.join(skillDir, "DocumentDurability.tla");
const cfgSource = path.join(skillDir, "DocumentDurability.cfg");

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function ensureTlcJar() {
  const envJar = process.env.TLA2TOOLS;
  if (envJar) {
    if (!fs.existsSync(envJar)) {
      throw new Error(`TLA2TOOLS does not exist: ${envJar}`);
    }
    return envJar;
  }
  if (fs.existsSync(CACHE_JAR)) {
    const actual = sha256File(CACHE_JAR);
    if (actual === TLC_SHA256) {
      return CACHE_JAR;
    }
    fs.rmSync(CACHE_JAR, { force: true });
  }
  fs.mkdirSync(path.dirname(CACHE_JAR), { recursive: true });
  const response = await fetch(TLC_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download tla2tools.jar (${response.status} ${response.statusText})`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== TLC_SHA256) {
    throw new Error(
      `Downloaded tla2tools.jar checksum mismatch: expected ${TLC_SHA256}, got ${actual}`,
    );
  }
  const staged = `${CACHE_JAR}.${process.pid}.tmp`;
  fs.writeFileSync(staged, bytes);
  fs.renameSync(staged, CACHE_JAR);
  return CACHE_JAR;
}

function canRunTlc(javaBin, jarPath) {
  const probe = spawnSync(javaBin, ["-cp", jarPath, "tlc2.TLC", "-h"], {
    encoding: "utf8",
  });
  return probe.error === undefined && probe.status === 0;
}

function resolveJavaBinary(jarPath) {
  if (process.env.JAVA) {
    if (canRunTlc(process.env.JAVA, jarPath)) {
      return process.env.JAVA;
    }
    throw new Error(
      `JAVA (${process.env.JAVA}) cannot run tla2tools.jar v${TLC_VERSION}`,
    );
  }
  if (canRunTlc("java", jarPath)) {
    return "java";
  }
  const where = spawnSync(
    "mise",
    ["which", "java", "--tool", JAVA_FALLBACK_TOOL],
    {
      encoding: "utf8",
    },
  );
  if (where.status === 0 && where.stdout.trim()) {
    const miseJava = where.stdout.trim();
    if (canRunTlc(miseJava, jarPath)) {
      return miseJava;
    }
  }
  const install = spawnSync("mise", ["install", JAVA_FALLBACK_TOOL], {
    encoding: "utf8",
  });
  if (install.status !== 0) {
    throw new Error(
      `Java cannot run tla2tools.jar v${TLC_VERSION}, and mise install ${JAVA_FALLBACK_TOOL} failed:\n${install.stderr || install.stdout}`,
    );
  }
  const installedWhere = spawnSync(
    "mise",
    ["which", "java", "--tool", JAVA_FALLBACK_TOOL],
    { encoding: "utf8" },
  );
  if (installedWhere.status !== 0 || !installedWhere.stdout.trim()) {
    throw new Error(`Cannot locate installed ${JAVA_FALLBACK_TOOL} binary`);
  }
  return installedWhere.stdout.trim();
}

function parseConfig(cfgText) {
  const baseLines = [];
  const invariants = [];
  let section = "";
  for (const rawLine of cfgText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("\\*")) {
      continue;
    }
    const header = /^([A-Z_]+)\b(.*)$/.exec(trimmed);
    if (header) {
      section = header[1];
    }
    if (section === "INVARIANT" || section === "INVARIANTS") {
      const rest = header ? header[2] : trimmed;
      for (const token of rest.trim().split(/\s+/)) {
        if (token) invariants.push(token);
      }
      continue;
    }
    if (section === "CHECK_DEADLOCK") {
      continue;
    }
    baseLines.push(rawLine);
  }
  return { baseConfig: `${baseLines.join("\n")}\n`, invariants };
}

function runTlc({ javaBin, jarPath, workDir, cfgContent, runName }) {
  const cfgPath = path.join(workDir, `${runName}.cfg`);
  const metaDir = path.join(workDir, `${runName}-meta`);
  const tmpDir = path.join(workDir, `${runName}-tmp`);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(cfgPath, cfgContent);
  const result = spawnSync(
    javaBin,
    [
      "-XX:+UseParallelGC",
      `-Djava.io.tmpdir=${tmpDir}`,
      "-cp",
      jarPath,
      "tlc2.TLC",
      "-workers",
      "1",
      "-fp",
      "0",
      "-lncheck",
      "final",
      "-config",
      cfgPath,
      "-metadir",
      metaDir,
      "DocumentDurability",
    ],
    { cwd: workDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { status: result.status, output };
}

function extractDistinctStates(tlcOutput) {
  const matches = [
    ...tlcOutput.matchAll(
      /(\d+) states generated, (\d+) distinct states found/g,
    ),
  ];
  const last = matches.at(-1);
  if (!last) return undefined;
  return { generated: Number(last[1]), distinct: Number(last[2]) };
}

function extractTrace(tlcOutput) {
  const lines = tlcOutput.split(/\r?\n/);
  const start = lines.findIndex((line) => /^Error: /.test(line));
  if (start === -1) return [];
  const end = lines.findIndex(
    (line, idx) =>
      idx > start &&
      (/^\d+ states generated/.test(line) || /^Finished in /.test(line)),
  );
  const slice = lines.slice(start, end === -1 ? lines.length : end);
  const steps = [];
  let current = null;
  for (const line of slice) {
    const header = /^State (\d+): <(.+)>$/.exec(line);
    if (header) {
      if (current) steps.push(current);
      current = { step: Number(header[1]), label: header[2], lines: [] };
      continue;
    }
    if (current && line.startsWith("/\\ ")) {
      current.lines.push(line);
    } else if (
      current &&
      line.trim() !== "" &&
      !/^Error:|^The behavior/.test(line)
    ) {
      if (current.lines.length > 0) {
        current.lines[current.lines.length - 1] += ` ${line.trim()}`;
      }
    }
  }
  if (current) steps.push(current);
  return steps;
}

function formatTrace(steps) {
  const out = [];
  let previousFields = new Map();
  for (const step of steps) {
    const fields = new Map();
    const changed = [];
    for (const line of step.lines) {
      const match = /^\/\\\s+(\S+)\s+=\s+(.+)$/.exec(line);
      if (!match) {
        changed.push(line);
        continue;
      }
      const [, key, value] = match;
      fields.set(key, value);
      if (previousFields.get(key) !== value) {
        changed.push(`${key} = ${value}`);
      }
    }
    out.push(`  Step ${step.step}: ${step.label}`);
    for (const item of changed) {
      out.push(`    ${item}`);
    }
    previousFields = fields;
  }
  return out.join("\n");
}

async function main() {
  const jarPath = await ensureTlcJar();
  const javaBin = resolveJavaBinary(jarPath);
  const cfgText = fs.readFileSync(cfgSource, "utf8");
  const { baseConfig, invariants } = parseConfig(cfgText);

  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "linger-document-durability-"),
  );
  try {
    fs.copyFileSync(specSource, path.join(workDir, "DocumentDurability.tla"));

    const checks = [
      {
        name: "NoDeadlock",
        cfg: `${baseConfig}CHECK_DEADLOCK TRUE\n`,
      },
      ...invariants.map((name) => ({
        name,
        cfg: `${baseConfig}INVARIANT ${name}\nCHECK_DEADLOCK FALSE\n`,
      })),
    ];

    let anyFailed = false;
    let anyError = false;
    let stateCounts;

    console.log(
      `DocumentDurability (TLC v${TLC_VERSION}, ${invariants.length} invariant(s) + NoDeadlock)`,
    );

    for (const check of checks) {
      const run = runTlc({
        javaBin,
        jarPath,
        workDir,
        cfgContent: check.cfg,
        runName: check.name,
      });
      stateCounts ??= extractDistinctStates(run.output);
      if (run.status === 0) {
        console.log(`PASS  ${check.name}`);
        continue;
      }
      if (run.status === 11 || run.status === 12 || run.status === 13) {
        anyFailed = true;
        console.log(`FAIL  ${check.name}`);
        const trace = extractTrace(run.output);
        if (trace.length > 0) {
          console.log(formatTrace(trace));
        } else {
          console.log(run.output.trim());
        }
        continue;
      }
      anyError = true;
      console.error(`ERROR ${check.name} (TLC exit ${run.status})`);
      console.error(run.output.trim());
    }

    if (stateCounts) {
      console.log(
        `Explored ${stateCounts.distinct} distinct states (${stateCounts.generated} generated).`,
      );
    }

    if (anyError) process.exit(2);
    if (anyFailed) process.exit(1);
    process.exit(0);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
