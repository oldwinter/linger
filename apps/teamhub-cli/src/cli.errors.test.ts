import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { writeCliConfig } from "./test-support/cli-config.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function run(
  args: readonly string[],
  response?: () => Response,
  configured = true,
) {
  const cwd = await mkdtemp(path.join(tmpdir(), "teamhub-cli-errors-"));
  roots.push(cwd);
  const fetcher = vi.fn<typeof fetch>(async () => {
    if (!response) throw new TypeError("offline");
    return response();
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    cwd,
    env: configured
      ? writeCliConfig(path.join(cwd, "config"), {
          scope: { kind: "room", id: "room_fixture" },
        })
      : { HOME: cwd },
    fetch: fetcher,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join(""), fetcher };
}

describe("command errors name what to fix", () => {
  it("lists every missing Tracking Item field before any request", async () => {
    const result = await run([
      "tracking-items",
      "add",
      "--item",
      '{"kind":"meeting","content":"x"}',
    ]);
    expect(result.code).toBe(2);
    expect(result.fetcher).not.toHaveBeenCalled();
    expect(result.stderr).toBe(
      [
        "teamhub: invalid_input: The --item JSON does not match tracking-items add.",
        "Command: teamhub tracking-items add",
        "Issue: due_at: missing: required; use null if there is none.",
        "Issue: due_text: missing: required; use null if there is none.",
        "Issue: source_ref: missing: required.",
        "Issue: source_date: missing: required.",
        "Issue: source_timezone: missing: required.",
        "Issue: idempotency_key: missing: required.",
        "",
      ].join("\n"),
    );
  });

  it("gives JSON output the same issues", async () => {
    const result = await run([
      "tracking-items",
      "add",
      "--item",
      '{"kind":"event","content":"x","due_at":null,"due_text":null,"source_ref":"r","source_date":"2026-11-22","source_timezone":"UTC","idempotency_key":"k"}',
      "--json",
    ]);
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "invalid_input",
        message: "The --item JSON does not match tracking-items add.",
        command: "tracking-items add",
        details: {
          issues: [
            {
              path: "kind",
              code: "invalid_value",
              message: 'must be one of todo, question, meeting; got "event".',
            },
          ],
        },
      },
    });
  });

  it("shows a local message even when it names an address", async () => {
    const result = await run([
      "room",
      "handoff",
      "--inbox",
      "room_abc",
      "--content",
      "hi",
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "teamhub: invalid_input: --inbox accepts only a room: address.",
    );
  });

  it("never sends a lone - as a body", async () => {
    const result = await run([
      "message",
      "send",
      "--attach",
      "report.pdf",
      "--content",
      "-",
    ]);
    expect(result.code).toBe(2);
    expect(result.fetcher).not.toHaveBeenCalled();
    expect(result.stderr).toContain(
      'Issue: --content: invalid_value: "-" would be sent as literal text; to read stdin use --file -.',
    );
  });

  it("names the output flag of a folder the command cannot write into", async () => {
    const result = await run([
      "docs",
      "get",
      "document_abc",
      "-o",
      "/nonexistent-teamhub-cli/dir/out.md",
    ]);
    expect(result.code).toBe(2);
    expect(result.fetcher).not.toHaveBeenCalled();
    expect(result.stderr).toContain(
      "teamhub: invalid_input: The -o path could not be written.",
    );
    expect(result.stderr).toContain(
      "Issue: -o: unwritable: /nonexistent-teamhub-cli/dir: not found.",
    );
    expect(result.stderr).not.toContain("ENOENT");
    const file = await run([
      "docs",
      "get",
      "document_abc",
      "--output",
      path.join(fileURLToPath(import.meta.url), "out.md"),
    ]);
    expect(file.stderr).toMatch(
      /Issue: --output: unwritable: .*cli\.errors\.test\.ts: not a directory\./u,
    );
  });

  it("replaces TeamHub's prose with the code's template but keeps its issues", async () => {
    const result = await run(
      ["agent", "get", "--agent-id", "actor_one"],
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "not_found",
              message: "agent actor_one missing in room:room_secret",
              request_id: "request_one",
              issues: [
                {
                  path: "actor_id",
                  code: "unknown_agent",
                  message: "No such Agent.",
                },
              ],
            },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    );
    expect(result.code).toBe(5);
    expect(result.stderr).toContain(
      "teamhub: not_found: The requested resource is unavailable.",
    );
    expect(result.stderr).toContain(
      "Issue: actor_id: unknown_agent: No such Agent.",
    );
    expect(result.stderr).not.toContain("room_secret");
  });

  it("checks the input before the configuration", async () => {
    const result = await run(
      ["tracking-items", "add", "--item", '{"kind":"meeting","content":"x"}'],
      undefined,
      false,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "Issue: due_text: missing: required; use null if there is none.",
    );
  });

  it("lists the commands of a group for an unknown subcommand", async () => {
    const result = await run(["tracking-items", "ad", "--json"]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr).error).toEqual({
      code: "usage",
      message: 'Unknown command "tracking-items ad".',
      details: {
        group: "tracking-items",
        commands: ["list", "add", "update", "done"],
      },
    });
    const text = await run(["tracking-items", "ad"]);
    expect(text.stderr).toContain(
      "Commands in tracking-items: list, add, update, done.",
    );
  });

  it("lists the allowed flags and the usage for an unknown flag", async () => {
    const result = await run(["tracking-items", "add", "--bogus"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      [
        "teamhub: usage: Unknown flag --bogus.",
        "Command: teamhub tracking-items add",
        "Issue: --bogus: unknown_field: not allowed. Allowed: --item, --item-file, --json.",
        "Usage: teamhub tracking-items add [flags]",
        "",
      ].join("\n"),
    );
  });

  it("names the flag, line and column of broken JSON", async () => {
    const result = await run([
      "tracking-items",
      "add",
      "--item",
      '{\n  "kind": "meeting",\n  content: "x"\n}',
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "Issue: --item: invalid_json: line 3, column 3: expected a property name in double quotes.",
    );
  });

  it("names a flag range with its bounds and the given value", async () => {
    const result = await run(["tracking-items", "list", "--limit", "0"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "Issue: --limit: out_of_range: must be an integer from 1 to 200; got 0.",
    );
  });

  it("reports a lost Tracking Item write as an unknown outcome", async () => {
    const item = JSON.stringify({
      kind: "todo",
      content: "x",
      due_at: null,
      due_text: null,
      source_ref: "message_1",
      source_date: "2026-11-23",
      source_timezone: "UTC",
      idempotency_key: "key-1",
    });
    const result = await run([
      "tracking-items",
      "add",
      "--item",
      item,
      "--json",
    ]);
    expect(result.code).toBe(1);
    const error = JSON.parse(result.stderr).error;
    expect(error.code).toBe("outcome_unknown");
    expect(error.message).toContain("same idempotency_key");
    expect(result.fetcher).toHaveBeenCalledTimes(1);
    expect(
      new Headers(result.fetcher.mock.calls[0]![1]!.headers).has(
        "x-teamhub-operation-id",
      ),
    ).toBe(false);
  });

  it("names a response without TeamHub's envelope by its status", async () => {
    const result = await run(
      ["tracking-items", "list", "--json"],
      () => new Response("denied", { status: 401 }),
    );
    expect(result.code).toBe(4);
    expect(JSON.parse(result.stderr).error).toMatchObject({
      code: "unauthenticated",
      message: "The Agent identity credential is invalid or expired.",
    });
  });

  it("treats a bare 429 as rate limiting and a bare 408 as a dependency failure", async () => {
    const limited = await run(
      ["tracking-items", "list", "--json"],
      () => new Response("slow down", { status: 429 }),
    );
    expect(limited.code).toBe(1);
    expect(JSON.parse(limited.stderr).error.code).toBe("provider_rate_limited");
    const timedOut = await run(
      ["tracking-items", "list", "--json"],
      () => new Response("timeout", { status: 408 }),
    );
    expect(timedOut.code).toBe(1);
    expect(JSON.parse(timedOut.stderr).error.code).toBe(
      "dependency_unavailable",
    );
  });

  it("lowercases a TeamHub code and shows its request ID", async () => {
    const result = await run(["tracking-items", "list"], () =>
      Response.json(
        {
          error: {
            code: "DEPENDENCY_UNAVAILABLE",
            message: "postgres timed out at 10.0.0.4",
            request_id: "req_1",
          },
        },
        { status: 503 },
      ),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      [
        "teamhub: dependency_unavailable: A service TeamHub depends on is temporarily unavailable; run this command again later.",
        "Command: teamhub tracking-items list",
        "Request ID: req_1",
        "",
      ].join("\n"),
    );
  });
});
