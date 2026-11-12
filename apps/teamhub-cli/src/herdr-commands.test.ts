import { describe, expect, it, vi } from "vitest";
import { businessCommandDefinitions as commandDefinitions } from "./business-commands.js";
import { runCli } from "./cli.js";
import { displayText } from "./display-text.js";
import { requestUrlText } from "./test-support/fetch-text.js";

function fixture() {
  const calls: { url: string; body: unknown }[] = [];
  const output: string[] = [],
    errors: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    calls.push({
      url: requestUrlText(url),
      body: JSON.parse(displayText(init?.body ?? "{}")),
    });
    return Response.json({
      status: "asked",
      computer_id: "computer_one",
      room_id: "room_one",
      message_id: "message_card",
      interaction_id: "interaction_one",
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

const ask = [
  "computer",
  "herdr",
  "ask",
  "--pane",
  "w1:p1",
  "--state",
  "5",
  "--question",
  "Use A or B?",
  "--option",
  "A",
  "--option",
  "B",
];

describe("computer herdr ask", () => {
  it("posts the coding agent's question and choices, never an answer", async () => {
    const f = fixture();
    expect(await runCli(ask, f.deps)).toBe(0);
    expect(f.calls).toEqual([
      {
        url: "https://teamhub.example/api/agent/v1/computer/herdr/ask",
        body: {
          pane_id: "w1:p1",
          state_change_seq: 5,
          question: "Use A or B?",
          options: ["A", "B"],
        },
      },
    ]);
    expect(f.output.join("")).toContain("Question card posted");
  });

  it("refuses keys hidden in a choice before calling TeamHub", async () => {
    const f = fixture();
    const withEnter = [...ask.slice(0, -1), "B\nrm -rf ~"];
    expect(await runCli(withEnter, f.deps)).not.toBe(0);
    expect(f.calls).toEqual([]);
    expect(f.errors.join("")).toContain("one line");
  });

  it("has no command that types into a pane", () => {
    const herdr = commandDefinitions.filter(
      (definition) =>
        definition.command[0] === "computer" &&
        definition.command[1] === "herdr",
    );
    expect(herdr.map((definition) => definition.command.join(" "))).toEqual([
      "computer herdr ask",
    ]);
    expect(Object.keys(herdr[0]!.options)).not.toContain("--text");
  });
});
