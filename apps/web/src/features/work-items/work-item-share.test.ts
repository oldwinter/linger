import { describe, expect, it } from "vitest";

import { workItemShare, workItemShareIdempotencyKey } from "./work-item-share";

const url =
  "https://linger.example/t/tenant-northstar/dashboard/workitem-login";

describe("workItemShare", () => {
  it("writes the Item's Markdown with its absolute link", () => {
    expect(
      workItemShare({
        item: item({ assignees: [assignment("Codex")] }),
        url,
      }).text,
    ).toBe(
      [
        "# Fix login failure",
        "Open · High · Assigned to Codex",
        "Email login returns 500.",
        url,
      ].join("\n\n"),
    );
  });

  it("leaves out assignees and an empty description", () => {
    expect(workItemShare({ item: item({ description: "" }), url }).text).toBe(
      ["# Fix login failure", "Open · High", url].join("\n\n"),
    );
  });

  it("changes its version with the Item revision", () => {
    expect(workItemShare({ item: item(), url }).version).toBe(
      "workitem-login:1",
    );
    expect(workItemShare({ item: item({ version: 2 }), url }).version).toBe(
      "workitem-login:2",
    );
  });
});

describe("workItemShareIdempotencyKey", () => {
  it("keeps one key per Item revision and Room", () => {
    expect(workItemShareIdempotencyKey("workitem-login:1", "room-all")).toBe(
      "work-item-share:workitem-login:1:room-all",
    );
    expect(workItemShareIdempotencyKey("workitem-login:1", "room-all")).toBe(
      workItemShareIdempotencyKey("workitem-login:1", "room-all"),
    );
  });

  it("gives another Room and another revision their own keys", () => {
    expect(
      workItemShareIdempotencyKey("workitem-login:1", "room-all"),
    ).not.toBe(
      workItemShareIdempotencyKey("workitem-login:1", "room-product-v0"),
    );
    expect(
      workItemShareIdempotencyKey("workitem-login:1", "room-all"),
    ).not.toBe(workItemShareIdempotencyKey("workitem-login:2", "room-all"));
  });
});

type ShareItem = Parameters<typeof workItemShare>[0]["item"];

function item(override: Partial<ShareItem> = {}): ShareItem {
  return {
    assignees: [],
    description: "Email login returns 500.",
    id: "workitem-login",
    priority: "high",
    state: "open",
    title: "Fix login failure",
    version: 1,
    ...override,
  };
}

function assignment(name: string): ShareItem["assignees"][number] {
  return {
    actor: {
      display_name: name,
      id: "actor-codex",
      kind: "agent",
      tenant_id: "tenant-northstar",
    },
    assigned_at: "2026-07-30T00:00:00Z",
    assigned_by: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
  };
}
