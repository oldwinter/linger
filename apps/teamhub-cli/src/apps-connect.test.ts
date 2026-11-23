import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { displayText } from "./display-text.js";
import { commandExamples } from "./test-support/command-examples.js";
import { requestUrlText } from "./test-support/fetch-text.js";

function fixture(response: Record<string, unknown>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const output: string[] = [],
    errors: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    calls.push({
      url: requestUrlText(url),
      body: JSON.parse(displayText(init?.body ?? "{}")),
    });
    return Response.json(response);
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
const ready = {
  status: "ready",
  account: { connection_id: "c1", identity_label: "a@b", app_key: "linear" },
};

describe("apps connect", () => {
  it("returns the ready account and posts only the app key", async () => {
    const f = fixture(ready);
    expect(await runCli(["apps", "connect", "linear", "--json"], f.deps)).toBe(
      0,
    );
    expect(f.calls).toEqual([
      {
        url: "https://teamhub.example/api/agent/v1/apps/account",
        body: { app_key: "linear" },
      },
    ]);
    expect(JSON.parse(f.output.join(""))).toMatchObject({
      status: "ready",
      account: { connection_id: "c1" },
    });
  });
  it("renders one text line", async () => {
    const f = fixture(ready);
    expect(await runCli(["apps", "connect", "linear"], f.deps)).toBe(0);
    expect(f.output.join("")).toContain("c1");
    expect(f.output.join("")).toContain("a@b");
  });
  it("forwards --account", async () => {
    const f = fixture(ready);
    await runCli(
      ["apps", "connect", "linear", "--account", "c1", "--json"],
      f.deps,
    );
    expect(f.calls[0]!.body).toEqual({ app_key: "linear", account: "c1" });
  });
  it("exits 4 with the authorization card", async () => {
    const f = fixture({
      status: "authorization_required",
      room_id: "room_one",
      message_id: "message_card",
      interaction_id: "i1",
    });
    expect(await runCli(["apps", "connect", "linear"], f.deps)).toBe(4);
    const text = f.errors.join("");
    expect(text).toContain("authorization_required");
    expect(text).toContain("Authorization card: message_card");
  });
  it("renders an Outlook account as the Microsoft sign-in name", async () => {
    const f = fixture({
      status: "ready",
      account: {
        connection_id: "c1",
        identity_label: "a@b",
        app_key: "outlook",
      },
    });
    expect(await runCli(["apps", "connect", "outlook"], f.deps)).toBe(0);
    expect(f.output.join("")).toContain(
      "Connected: c1 (a@b - Microsoft sign-in name, the mailbox address may differ)",
    );
  });
  it("marks only Outlook candidates as sign-in names", async () => {
    const f = fixture({
      status: "account_ambiguous",
      candidates: [
        { connection_id: "c2", identity_label: "w@x", app_key: "outlook" },
        { connection_id: "c3", identity_label: "g@x", app_key: "gmail" },
      ],
    });
    expect(await runCli(["apps", "connect", "outlook"], f.deps)).not.toBe(0);
    const text = f.errors.join("");
    expect(text).toContain(
      "Account: c2  w@x - Microsoft sign-in name, the mailbox address may differ",
    );
    expect(text).toMatch(/Account: c3 {2}g@x$/m);
  });
  it("reports ambiguous accounts with candidates", async () => {
    const f = fixture({
      status: "account_ambiguous",
      candidates: [{ connection_id: "c2", identity_label: "w@x" }],
    });
    expect(
      await runCli(["apps", "connect", "linear", "--json"], f.deps),
    ).not.toBe(0);
    expect(JSON.parse(f.errors.join("")).error).toMatchObject({
      code: "account_ambiguous",
      message:
        "The requested account is unavailable or more than one account matches. If one of the candidates is the account you meant, run again with --account set to its connection ID; otherwise pass the account's label (for example its email address) with --account to ask the user to authorize it.",
      details: { candidates: [{ connection_id: "c2" }] },
    });
  });
  it.each([["Linear!"], [], ["a", "b"]])(
    "rejects invalid positionals %j before any HTTP call",
    async (...positionals) => {
      const f = fixture(ready);
      expect(
        await runCli(["apps", "connect", ...positionals, "--json"], f.deps),
      ).not.toBe(0);
      // A wrong value is invalid_input; a wrong argument count is usage.
      expect(JSON.parse(f.errors.join("")).error.code).toBe(
        positionals.length === 1 ? "invalid_input" : "usage",
      );
      expect(f.calls).toEqual([]);
    },
  );
  it.each([
    ["apps", "connect", "linear"],
    ["apps", "search", ...commandExamples.search_app_tools!],
    ["apps", "execute", ...commandExamples.execute_app_tool!],
  ])(
    "tells the Agent the user has not set up Composio: %s %s",
    async (...args) => {
      const f = fixture(ready);
      f.deps.fetch = vi.fn<typeof fetch>(async () =>
        Response.json(
          {
            error: {
              code: "provider_key_required",
              message: "Backend prose the CLI does not show",
              request_id: "request_one",
            },
          },
          { status: 409 },
        ),
      );
      expect(await runCli([...args, "--json"], f.deps)).toBe(4);
      const { error } = JSON.parse(f.errors.join(""));
      // Nothing reached the application, so the command can simply run again.
      expect(error.code).toBe("provider_key_required");
      expect(error.message).toContain("has not set up Composio");
      expect(error.message).toContain("run this command again");
      expect(error.message).not.toContain("Backend prose");
    },
  );
  it("shows help offline", async () => {
    const f = fixture(ready);
    expect(
      await runCli(["apps", "connect", "--help"], { ...f.deps, env: {} }),
    ).toBe(0);
    expect(f.output.join("")).toContain("apps connect");
    expect(f.calls).toEqual([]);
  });
});
