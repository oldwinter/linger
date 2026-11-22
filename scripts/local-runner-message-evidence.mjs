import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export class LocalMessageEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function verifyLocalRunEvidence({
  file,
  expected,
  expectedSha256,
  log,
  runId,
  signal,
}) {
  if (
    !nonEmptyString(file) ||
    !nonEmptyString(log) ||
    !nonEmptyString(runId) ||
    (expected === undefined &&
      !/^[a-f0-9]{64}$/.test(String(expectedSha256 ?? "")))
  )
    fail("INVALID_INPUT");
  try {
    const fileInfo = await lstat(file);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink())
      fail("INVALID_ARTIFACT_FILE");
    const content = await readFile(file, { signal });
    if (expected !== undefined) {
      const marker = Buffer.from(expected);
      if (fileInfo.size !== marker.length || !content.equals(marker))
        return false;
    } else if (sha256Hex(content) !== expectedSha256) {
      return false;
    }
    let successfulWrite = false;
    let succeeded = false;
    const stream = createReadStream(log, { encoding: "utf8", signal });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if ((event?.runId ?? event?.run_id) !== runId) continue;
        if (
          event.event === "agent.tool_call" &&
          event.tool_name === "write" &&
          event.is_error === false
        )
          successfulWrite = true;
        if (
          event.event === "local_run.terminal_persisted" &&
          event.resultCode === "succeeded"
        )
          succeeded = true;
        if (successfulWrite && succeeded) return true;
      }
    } finally {
      stream.destroy();
    }
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function assertLocalMessageEvidence({ report, runtime, expected }) {
  if (
    !Array.isArray(report) ||
    !Array.isArray(runtime?.runs) ||
    !Array.isArray(runtime?.operation_receipts) ||
    !expected ||
    ![
      expected.agentId,
      expected.roomId,
      expected.runId,
      expected.operationId,
      expected.finalText,
    ].every(nonEmptyString)
  )
    fail("INVALID_INPUT");
  const run = runtime.runs.find((row) => row.run_id === expected.runId);
  const operation = runtime.operation_receipts.find(
    (row) => row.operation_id === expected.operationId,
  );
  if (
    run?.agent_id !== expected.agentId ||
    run.status !== "succeeded" ||
    operation?.agent_id !== expected.agentId ||
    operation.run_id !== expected.runId
  )
    fail("RUNTIME_NOT_SUCCEEDED");
  const finalDigest = sha256Hex(expected.finalText);
  const publications = report.filter(
    (row) => row?.type === "agent.messages.published",
  );
  for (const row of publications) {
    if (
      row.transport !== "teamhub-cli" ||
      ![
        row.message_id,
        row.command_operation_id,
        row.agent_id,
        row.room_id,
      ].every(nonEmptyString) ||
      !/^[a-f0-9]{64}$/.test(row.body_sha256 ?? "") ||
      row.idempotency_key_present !== true
    )
      fail("INVALID_PUBLICATION");
    if (row.execution_run_ref || row.mcp_invocation_id || row.audit_id)
      fail("RETIRED_TRANSPORT_AUTHORITY");
  }
  const finals = publications.filter((row) => row.body_sha256 === finalDigest);
  if (finals.length === 0) fail("FINAL_MESSAGE_MISSING");
  if (finals.length !== 1) fail("FINAL_MESSAGE_DUPLICATED");
  const final = finals[0];
  if (final.agent_id !== expected.agentId || final.room_id !== expected.roomId)
    fail("PUBLICATION_IDENTITY_MISMATCH");
  for (const key of ["message_id", "command_operation_id"]) {
    if (
      new Set(publications.map((row) => row[key])).size !== publications.length
    )
      fail("PUBLICATION_DUPLICATED");
  }
  return {
    agent_id: expected.agentId,
    room_id: expected.roomId,
    local_run_id: expected.runId,
    runner_operation_id: expected.operationId,
    command_operation_id: final.command_operation_id,
    publication_count: finals.length,
    final_message_id: final.message_id,
    final_body_sha256: finalDigest,
    transport: "teamhub-cli",
    runtime_succeeded: true,
  };
}

const nonEmptyString = (value) => typeof value === "string" && value.length > 0;
const fail = (code) => {
  throw new LocalMessageEvidenceError(code);
};

async function runCli() {
  if (process.argv[2] === "--run-evidence") {
    const file = process.env.LINGER_ACCEPTANCE_FILE?.trim();
    const expected = process.env.LINGER_ACCEPTANCE_EXPECTED?.trim();
    const expectedSha256 =
      process.env.LINGER_ACCEPTANCE_EXPECTED_SHA256?.trim();
    const log = process.env.LINGER_ACCEPTANCE_AGENT_LOG?.trim();
    const runId = process.env.LINGER_ACCEPTANCE_RUN_ID?.trim();
    if (!file || !log || !path.isAbsolute(file) || !path.isAbsolute(log))
      fail("INVALID_INPUT");
    const hasMarker = /^LINGER_ACCEPTANCE_[A-F0-9]{16}$/.test(expected ?? "");
    const hasDigest = /^[a-f0-9]{64}$/.test(expectedSha256 ?? "");
    if (!runId || (!hasMarker && !hasDigest)) fail("INVALID_INPUT");
    const verified = await verifyLocalRunEvidence({
      file,
      expected: hasMarker ? expected : undefined,
      expectedSha256: hasMarker ? undefined : expectedSha256,
      log,
      runId,
      signal: AbortSignal.timeout(15_000),
    });
    if (!verified) fail("RUN_EVIDENCE_INCOMPLETE");
    process.stdout.write(
      `${JSON.stringify({
        result: "verified",
        run_id: runId,
        file_sha256: hasMarker ? sha256Hex(expected) : expectedSha256,
        file_content: "exact",
        successful_write: true,
        terminal_succeeded: true,
      })}\n`,
    );
    return;
  }

  const [
    reportPath,
    runtimePath,
    agentId,
    roomId,
    runId,
    operationId,
    finalText,
  ] = process.argv.slice(2);
  const report = readFileSync(reportPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
  const proof = assertLocalMessageEvidence({
    report,
    runtime,
    expected: { agentId, roomId, runId, operationId, finalText },
  });
  process.stdout.write(`${JSON.stringify(proof)}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli().catch((error) => {
    const code =
      error instanceof LocalMessageEvidenceError ? error.code : "INVALID_INPUT";
    process.stderr.write(`Local message evidence failed: ${code}\n`);
    process.exitCode = 1;
  });
}
