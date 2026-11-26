import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { displayText } from "./display-text.js";
import { herdrCoreCommandDefinitions } from "./herdr-core-commands.js";
import { requestUrlText } from "./test-support/fetch-text.js";

function fixture(responder?: (url: string, body: unknown) => Response) {
  const calls: { url: string; body: unknown; opId: string | null }[] = [];
  const output: string[] = [];
  const errors: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const parsed = JSON.parse(displayText(init?.body ?? "{}"));
    const headers = new Headers(init?.headers);
    const urlText = requestUrlText(url);
    calls.push({
      url: urlText,
      body: parsed,
      opId: headers.get("x-teamhub-operation-id"),
    });
    if (responder) return responder(urlText, parsed);
    if (urlText.endsWith("/computer/herdr-core/ask")) {
      return Response.json({
        status: "asked",
        computer_id: "computer_one",
        room_id: "room_one",
        message_id: "message_hc_card",
        interaction_id: "interaction_hc",
      });
    }
    return Response.json({
      computer_id: "computer_one",
      tool_name: (parsed as { tool_name?: string }).tool_name ?? "status",
      result: { ok: true },
    });
  });
  const deps = {
    cwd: process.cwd(),
    env: {
      TEAMHUB_URL: "https://teamhub.example",
      TEAMHUB_TOKEN: "th_agent_fixture",
    },
    fetch: fetcher,
    stdout: (s: string) => void output.push(s),
    stderr: (s: string) => void errors.push(s),
  };
  return { calls, output, errors, deps };
}

describe("computer hc commands", () => {
  it("registers all 17 herdr-core subcommands", () => {
    expect(
      herdrCoreCommandDefinitions.map((def) => def.command.join(" ")),
    ).toEqual([
      "computer hc status",
      "computer hc ls",
      "computer hc get",
      "computer hc read",
      "computer hc run",
      "computer hc send",
      "computer hc keys",
      "computer hc interrupt",
      "computer hc kill",
      "computer hc rm",
      "computer hc exec",
      "computer hc file-read",
      "computer hc file-edit",
      "computer hc file-write",
      "computer hc templates",
      "computer hc machines",
      "computer hc ask",
    ]);
  });

  it("posts ask cards preserving option order for mixed text and key choices", async () => {
    const f = fixture();
    const code = await runCli(
      [
        "computer",
        "hc",
        "ask",
        "--address",
        "vps/t7",
        "--turn",
        "4",
        "--status-ms",
        "1732670400000",
        "--question",
        "Approve deploy?",
        "--option-keys",
        "Approve=y,Enter",
        "--option",
        "Abort",
        "--option-keys",
        "Cancel=C-c",
      ],
      f.deps,
    );
    expect(code, f.errors.join("")).toBe(0);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(
      "https://teamhub.example/api/agent/v1/computer/herdr-core/ask",
    );
    expect(f.calls[0]!.body).toEqual({
      address: "vps/t7",
      turn: 4,
      status_ms: 1732670400000,
      question: "Approve deploy?",
      options: [
        { label: "Approve", keys: ["y", "Enter"] },
        { label: "Abort" },
        { label: "Cancel", keys: ["C-c"] },
      ],
    });
    expect(f.output.join("")).toContain("Question card posted");
  });

  it("rejects control characters in option labels or keys before HTTP", async () => {
    const f = fixture();
    const code = await runCli(
      [
        "computer",
        "hc",
        "ask",
        "--address",
        "t7",
        "--turn",
        "1",
        "--status-ms",
        "100",
        "--question",
        "Run?",
        "--option-keys",
        "Yes=y\nrm",
      ],
      f.deps,
    );
    expect(code).toBe(2);
    expect(f.calls).toEqual([]);
  });

  it("forwards operation_id on mutating call commands and omits it on read-only commands", async () => {
    const f = fixture();
    expect(
      await runCli(
        [
          "computer",
          "hc",
          "run",
          "--line",
          "echo hi",
          "--label",
          "linger.room=room_1",
          "--keep",
          "--operation-id",
          "op_run_1",
        ],
        f.deps,
      ),
    ).toBe(0);
    expect(f.calls[0]).toMatchObject({
      url: "https://teamhub.example/api/agent/v1/computer/herdr-core/call",
      opId: "op_run_1",
      body: {
        operation_id: "op_run_1",
        tool_name: "run",
        arguments: {
          line: "echo hi",
          labels: { "linger.room": "room_1" },
          keep: true,
        },
      },
    });

    expect(
      await runCli(
        ["computer", "hc", "ls", "--all", "--status", "blocked"],
        f.deps,
      ),
    ).toBe(0);
    expect(f.calls[1]).toMatchObject({
      url: "https://teamhub.example/api/agent/v1/computer/herdr-core/call",
      opId: null,
      body: {
        tool_name: "list",
        arguments: { all: true, status: "blocked" },
      },
    });
  });

  it("renders raw terminal text directly for hc read", async () => {
    const f = fixture(() =>
      Response.json({
        computer_id: "computer_one",
        tool_name: "read",
        result: {
          text: "line 1\nline 2\n",
          complete: true,
          how: "scrollback",
          why: "",
        },
      }),
    );
    expect(
      await runCli(
        ["computer", "hc", "read", "vps/t7", "--lines", "50"],
        f.deps,
      ),
    ).toBe(0);
    expect(f.output.join("")).toBe("line 1\nline 2\n\n");
  });

  it("validates mutually exclusive --line and --argv on run and exec", async () => {
    const f = fixture();
    expect(
      await runCli(
        ["computer", "hc", "exec", "--line", "ls", "--argv", '["ls"]'],
        f.deps,
      ),
    ).toBe(2);
    expect(f.calls).toEqual([]);
  });

  it("computes deadline_ms from --timeout on send and exec", async () => {
    const f = fixture();
    expect(
      await runCli(
        [
          "computer",
          "hc",
          "send",
          "vps/t7",
          "--text",
          "continue",
          "--wait",
          "--timeout",
          "30",
        ],
        f.deps,
      ),
    ).toBe(0);
    expect(f.calls[0]!.body).toMatchObject({
      tool_name: "send",
      deadline_ms: 35_000,
      arguments: {
        address: "vps/t7",
        text: "continue",
        wait: true,
        timeout: 30,
      },
    });
  });
});
