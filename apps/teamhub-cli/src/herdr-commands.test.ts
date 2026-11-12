import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { displayText } from "./display-text.js";
import { requestUrlText } from "./test-support/fetch-text.js";

function fixture(answer: () => Promise<Response>) {
  const calls: { url: string; body: unknown }[] = [];
  const output: string[] = [],
    errors: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    calls.push({
      url: requestUrlText(url),
      body: JSON.parse(displayText(init?.body ?? "{}")),
    });
    return answer();
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

const answer = [
  "computer",
  "herdr",
  "answer",
  "--pane",
  "w1:p1",
  "--state",
  "5",
  "--text",
  "Use option A",
];

describe("computer herdr answer", () => {
  it("sends the Human's answer once and says whether it arrived", async () => {
    const f = fixture(async () =>
      Response.json({
        status: "pane_not_blocked",
        computer_id: "computer_one",
      }),
    );
    expect(await runCli(answer, f.deps)).toBe(0);
    expect(f.calls).toEqual([
      {
        url: "https://teamhub.example/api/agent/v1/computer/herdr/answer",
        body: { pane_id: "w1:p1", state_change_seq: 5, text: "Use option A" },
      },
    ]);
    expect(f.output.join("")).toContain(
      "Not sent: the agent already moved on from that question.",
    );
  });

  it("refuses keys hidden in the answer before calling TeamHub", async () => {
    const f = fixture(async () => Response.json({}));
    const withEnter = [...answer.slice(0, -1), "A\nrm -rf ~"];
    expect(await runCli(withEnter, f.deps)).not.toBe(0);
    expect(f.calls).toEqual([]);
    expect(f.errors.join("")).toContain("one line");
  });

  it("never invites a retry when TeamHub's answer is lost", async () => {
    const f = fixture(async () => {
      throw new TypeError("socket hang up");
    });
    expect(await runCli([...answer, "--json"], f.deps)).not.toBe(0);
    expect(f.calls).toHaveLength(1);
    const failure = f.errors.join("") + f.output.join("");
    expect(failure).toContain("outcome_unknown");
    expect(failure).toContain("do not send it again");
  });
});
