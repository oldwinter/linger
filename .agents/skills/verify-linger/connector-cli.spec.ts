import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { RoomDocumentE2EHarnessClient } from "../../../apps/web/e2e/room-document-e2e-harness-client";

const exec = promisify(execFile);
const evidence = process.env.VERIFY_LINGER_EVIDENCE!;
const config = process.env.CONNECTOR_CLI_PROOF_CONFIG!;
const provider = `http://127.0.0.1:${process.env.VERIFY_COMPOSIO_PORT ?? "28087"}`;
const web = `http://127.0.0.1:${process.env.PLAYWRIGHT_ROOM_DOCUMENT_WEB_PORT ?? "23008"}`;
const jsonLine = (output: string) =>
  JSON.parse(output.split("\n").find((line) => line.startsWith("{")) ?? "null");

test("connector CLI: Computer Use account authorization and persisted write", async ({
  request,
}) => {
  test.setTimeout(20 * 60 * 1000);
  if (process.env.CONNECTOR_CLI_MANUAL !== "1")
    throw new Error(
      "This proof requires actual Computer Use; set CONNECTOR_CLI_MANUAL=1",
    );
  const fixture = await new RoomDocumentE2EHarnessClient(request).reset();
  const cli = async (args: string[]) => {
    try {
      const result = await exec(
        process.execPath,
        [path.resolve("apps/teamhub-cli/dist/teamhub.js"), ...args, "--json"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TEAMHUB_CONFIG: config,
            TEAMHUB_STATE_ROOT: evidence,
          },
          maxBuffer: 8 << 20,
        },
      );
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      return {
        code: failure.code,
        stdout: failure.stdout,
        stderr: failure.stderr,
      };
    }
  };
  const args = ["gmail", "list", "--account", "owner@example.test"];
  const first = await cli(args);
  expect(first.code, first.stderr).toBe(4);
  const firstError = jsonLine(first.stderr).error;
  expect(firstError.code).toBe("authorization_required");
  const repeats = await Promise.all([cli(args), cli(args), cli(args)]);
  for (const repeat of repeats) {
    expect(repeat.code, repeat.stderr).toBe(4);
    expect(jsonLine(repeat.stderr).error.details.message_id).toBe(
      firstError.details.message_id,
    );
  }
  expect(
    (await (await fetch(`${provider}/proof/state`)).json()).executions,
  ).toEqual([]);
  await writeFile(
    path.join(evidence, "manual-ready.json"),
    JSON.stringify(
      {
        url: `${web}/t/${fixture.tenant_id}/rooms/${fixture.room_id}/chat`,
        cardMessageId: firstError.details.message_id,
        instruction: `Use actual Computer Use to log in as disposable Alice, open this Room, click Connect, complete the disposable Gmail provider page, and verify the connected card. Then create manual-done.json in this evidence directory.`,
      },
      null,
      2,
    ),
  );
  console.log(`COMPUTER_USE_READY ${evidence}/manual-ready.json`);
  await expect
    .poll(
      async () =>
        access(path.join(evidence, "manual-done.json")).then(
          () => true,
          () => false,
        ),
      { timeout: 17 * 60 * 1000, intervals: [1000] },
    )
    .toBe(true);
  const listed = await cli(args);
  expect(listed.code, listed.stderr).toBe(0);
  expect(JSON.parse(listed.stdout)).toMatchObject({
    account: { identityLabel: "owner@example.test" },
    messages: [{ messageId: "proof_message" }],
  });
  const drafted = await cli([
    "gmail",
    "draft",
    "--account",
    "owner@example.test",
    "--to",
    "alice@example.test",
    "--subject",
    "Computer Use Markdown proof",
    "--markdown",
    "--content",
    "# Verified\n\n**Backend HTML** conversion.",
  ]);
  expect(drafted.code, drafted.stderr).toBe(0);
  const draft = JSON.parse(drafted.stdout).result;
  expect(draft.action).toBe("drafted");
  const read = await cli([
    "gmail",
    "read",
    "--account",
    "owner@example.test",
    "--draft",
    draft.draftId,
  ]);
  expect(read.code, read.stderr).toBe(0);
  expect(JSON.parse(read.stdout).draft.mail.bodyHtml).toContain(
    "<h1>Verified</h1>",
  );
  const state = await (await fetch(`${provider}/proof/state`)).json();
  expect(
    state.executions.filter(
      (item: { slug: string }) => item.slug === "GMAIL_CREATE_EMAIL_DRAFT",
    ),
  ).toHaveLength(1);
  await writeFile(
    path.join(evidence, "proof.json"),
    JSON.stringify(
      {
        source: "current worktree CLI and real isolated TeamHub/PostgreSQL/Web",
        computerUse: JSON.parse(
          await readFile(path.join(evidence, "manual-done.json"), "utf8"),
        ),
        accountAuthorization: firstError.details,
        list: JSON.parse(listed.stdout),
        draft: JSON.parse(read.stdout),
        limitation:
          "Composio HTTP adapter and provider OAuth are disposable simulations. No real email was sent.",
        status: "passed",
      },
      null,
      2,
    ),
  );
});
