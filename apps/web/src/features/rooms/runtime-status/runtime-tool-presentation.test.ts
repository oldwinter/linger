import { describe, expect, it } from "vitest";

import { translate } from "@/i18n/language";

import {
  activityStatusLine,
  toolGroupPresentation,
  toolNameLabel,
  toolPresentation,
} from "./runtime-tool-presentation";

describe("toolPresentation", () => {
  it.each([
    ["command", "command"],
    ["read", "read"],
    ["file_change", "edit"],
    ["search", "search"],
    ["browse", "browser"],
    ["message", "message"],
    ["message_read", "message_read"],
    ["delegation", "delegation"],
    ["recovery", "recovery"],
    ["tool", "tool"],
    ["unknown_kind", "tool"],
  ])("presents the %s kind as %s", (kind, category) => {
    expect(toolPresentation(translate, kind).category).toBe(category);
  });

  it("does not expose tool input in activity path summaries", () => {
    expect(toolPresentation(translate, "read").summary).toBe("Reviewing files");
    expect(toolPresentation(translate, "message").summary).toBe(
      "Sending an update",
    );
    expect(toolPresentation(translate, "tool").summary).toBe(
      "Working on the task",
    );
  });

  it("labels a generic tool call by its tool name", () => {
    expect(
      toolPresentation(translate, "tool", "mcp__computer__get_window_state")
        .summary,
    ).toBe("Get window state");
    expect(toolPresentation(translate, "tool", "Skill").summary).toBe("Skill");
    expect(
      toolPresentation(translate, "unknown_kind", "run_script").summary,
    ).toBe("Run script");
    expect(
      toolPresentation(translate, "read", "mcp__computer__read").summary,
    ).toBe("Reviewing files");
    expect(toolNameLabel("mcp__teamhub__send_message")).toBe("Send message");
    expect(
      toolGroupPresentation(translate, [
        toolPresentation(translate, "tool", "Skill"),
      ]).label,
    ).toBe("Skill");
  });

  it("summarizes mixed or unknown operations as user-facing steps", () => {
    expect(
      toolGroupPresentation(
        translate,
        ["read", "command", "search"].map((kind) =>
          toolPresentation(translate, kind),
        ),
      ).label,
    ).toBe("Working through 3 steps");
    expect(
      toolGroupPresentation(translate, [
        toolPresentation(translate, "tool"),
        toolPresentation(translate, "tool"),
      ]).label,
    ).toBe("Working through 2 steps");
    expect(
      toolGroupPresentation(translate, [toolPresentation(translate, "search")])
        .label,
    ).toBe("Searching for information");
  });
});

describe("activityStatusLine", () => {
  it("takes the Runtime's description as a group title", () => {
    expect(
      activityStatusLine(
        translate,
        "command",
        JSON.stringify({
          command: "npm test",
          status_title: "Run the unit tests",
          status_steps: ["Running tests"],
        }),
      ),
    ).toEqual({ steps: [], title: "Run the unit tests" });
  });

  it("plays the steps the Computer read from the call", () => {
    expect(
      activityStatusLine(translate, "search", {
        status_steps: ['Searching for "fares"', "", 3, "Reading notes.md"],
      }),
    ).toEqual({ steps: ['Searching for "fares"', "Reading notes.md"] });
  });

  it.each([
    [
      "read",
      { file_path: "/work/docs/travel-préférences.md" },
      ["Reading files"],
    ],
    ["file_change", { paths: ["src/app.tsx"] }, ["Editing files"]],
    ["search", { query: "Tokyo flights Nov 7" }, ["Searching"]],
    ["browse", { url: "https://www.ceair.com/flights" }, ["Browsing the web"]],
    ["message_read", {}, ["Reading messages"]],
    ["recovery", {}, ["Recovering the task"]],
    ["tool", { server: "computer", arguments: {} }, ["Using tools"]],
    ["unknown", "{invalid", ["Using tools"]],
    ["command", { command: "python3 compare_fares.py" }, []],
  ])("names an unnamed %s call by its kind", (kind, input, steps) => {
    expect(
      activityStatusLine(
        translate,
        kind,
        typeof input === "string" ? input : JSON.stringify(input),
      ),
    ).toEqual({ steps });
  });
});
