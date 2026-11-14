import { describe, expect, it } from "vitest";

import { workItemMarkdown } from "./work-item-markdown";

const link =
  "https://linger.example/t/tenant-northstar/dashboard/workitem-login";

describe("Work Item Markdown", () => {
  it("writes the title, facts, description, and link", () => {
    const text = workItemMarkdown({
      item: item({ assignees: [assignment("Codex")] }),
      link,
    });

    expect(text).toBe(
      [
        "# Fix login failure",
        "Open · High · Assigned to Codex",
        "Email login returns 500.",
        link,
      ].join("\n\n"),
    );
  });

  it("leaves the assignee out when none is set", () => {
    expect(workItemMarkdown({ item: item(), link })).toBe(
      [
        "# Fix login failure",
        "Open · High",
        "Email login returns 500.",
        link,
      ].join("\n\n"),
    );
  });

  it("leaves an empty description out", () => {
    expect(workItemMarkdown({ item: item({ description: "" }), link })).toBe(
      ["# Fix login failure", "Open · High", link].join("\n\n"),
    );
  });

  it("leaves the assignee and a whitespace-only description out", () => {
    expect(
      workItemMarkdown({
        item: item({ assignees: [], description: "  \n " }),
        link,
      }),
    ).toBe(["# Fix login failure", "Open · High", link].join("\n\n"));
  });
});

type MarkdownItem = Parameters<typeof workItemMarkdown>[0]["item"];

function item(override: Partial<MarkdownItem> = {}): MarkdownItem {
  return {
    assignees: [],
    description: "Email login returns 500.",
    priority: "high",
    state: "open",
    title: "Fix login failure",
    ...override,
  };
}

function assignment(name: string): MarkdownItem["assignees"][number] {
  const actor = {
    display_name: name,
    id: `actor-${name.toLowerCase()}`,
    kind: "agent" as const,
    tenant_id: "tenant-northstar",
  };
  return { actor, assigned_at: "2026-07-30T00:00:00Z", assigned_by: actor };
}
