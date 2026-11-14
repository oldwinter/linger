import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubProactiveRule,
  TeamHubProactiveRuleBook,
} from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { MyRulesPage } from "./my-rules-page";

const activeId = "pr_0000000000000000000000000000000a";
const shadowId = "pr_0000000000000000000000000000000b";
const rulesPath = "/v0/tenants/{tenantId}/me/proactive-rules";
const rulePath = "/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}";

function rule(
  id: string,
  text: string,
  status: TeamHubProactiveRule["status"],
): TeamHubProactiveRule {
  return {
    id,
    text,
    status,
    pinned: false,
    source: "learned",
    created_at: "2026-11-01T08:00:00Z",
    promoted_at: status === "active" ? "2026-11-01T08:00:00Z" : null,
    guideline_version: 2,
    mandate: "none",
  };
}

const book: TeamHubProactiveRuleBook = {
  version: 2,
  rules: [
    rule(activeId, "Client replies → remind directly", "active"),
    rule(shadowId, "Vendor invoices → track for follow-up", "shadow"),
  ],
  clues: [
    {
      matter: "Acme quote",
      kind: "client communication",
      time: null,
      leaning: "remind_directly",
      seen: 1,
      last_seen: "2026-11-01",
    },
  ],
  divergences: [
    {
      id: "psd_0000000000000000000000000000000a",
      rule_id: shadowId,
      guideline_version: 2,
      matter: "AWS invoice",
      shadow_action: "track",
      taken_action: "notify",
      created_at: "2026-11-02T08:00:00Z",
    },
  ],
  mandates: [],
};

function renderPage() {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", rulesPath, () => book);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider
          router={createMemoryRouter(
            [
              {
                element: <MyRulesPage />,
                path: "/t/:tenantId/settings/my-rules",
              },
            ],
            { initialEntries: ["/t/tenant-northstar/settings/my-rules"] },
          )}
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return runtime;
}

const row = (text: string) => screen.findByRole("listitem", { name: text });

describe("My Rules", () => {
  it("lists rules with their status, clues, and where a shadow rule would differ", async () => {
    renderPage();
    const active = await row("Client replies → remind directly");
    expect(within(active).getByText("Active")).toBeTruthy();
    expect(
      within(active).queryByRole("button", { name: /Promote/u }),
    ).toBeNull();
    const shadow = await row("Vendor invoices → track for follow-up");
    expect(within(shadow).getByText("Shadow")).toBeTruthy();
    expect(
      within(shadow).getByText(
        "AWS invoice: would follow up later, Another Me chose to tell now",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Review 1 new rule" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/settings/my-rules/review");
    expect(screen.getByText("Acme quote")).toBeTruthy();
    expect(screen.getByText("Tell now · seen 1")).toBeTruthy();
  });

  it("pins, edits, promotes and deletes a rule through TeamHub", async () => {
    const runtime = renderPage();
    const pinned = {
      ...book,
      rules: [{ ...book.rules[0]!, pinned: true }, book.rules[1]!],
    };
    runtime.server.on("PUT", `${rulePath}/pin`, ({ body, params }) => {
      expect(params).toMatchObject({ ruleId: activeId });
      expect(body).toEqual({ pinned: true });
      return pinned;
    });
    fireEvent.click(
      within(await row("Client replies → remind directly")).getByRole(
        "button",
        { name: "Pin rule" },
      ),
    );
    const pinnedRow = await row("Client replies → remind directly");
    expect(await within(pinnedRow).findByText("Pinned")).toBeTruthy();
    expect(
      within(pinnedRow).getByRole("button", { name: "Unpin rule" }),
    ).toBeTruthy();

    const edited = {
      ...pinned,
      rules: [
        pinned.rules[0]!,
        {
          ...pinned.rules[1]!,
          text: "Vendor invoices over 1000 → track for follow-up",
          source: "user" as const,
        },
      ],
    };
    runtime.server.on("PATCH", rulePath, ({ body, params }) => {
      expect(params).toMatchObject({ ruleId: shadowId });
      expect(body).toEqual({
        text: "Vendor invoices over 1000 → track for follow-up",
      });
      return edited;
    });
    fireEvent.click(
      within(await row("Vendor invoices → track for follow-up")).getByRole(
        "button",
        { name: "Edit rule" },
      ),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Rule text" }), {
      target: { value: " Vendor invoices over 1000 → track for follow-up " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const editedRow = await row(
      "Vendor invoices over 1000 → track for follow-up",
    );
    expect(within(editedRow).getByText("Edited by you")).toBeTruthy();

    const promoted = {
      ...edited,
      rules: [
        edited.rules[0]!,
        {
          ...edited.rules[1]!,
          status: "active" as const,
          promoted_at: "2026-11-03T08:00:00Z",
        },
      ],
    };
    runtime.server.on("POST", `${rulePath}/promotion`, ({ params }) => {
      expect(params).toMatchObject({ ruleId: shadowId });
      return promoted;
    });
    fireEvent.click(
      within(editedRow).getByRole("button", { name: /Promote/u }),
    );
    expect(
      await within(
        await row("Vendor invoices over 1000 → track for follow-up"),
      ).findByText("Active"),
    ).toBeTruthy();

    runtime.server.on("DELETE", rulePath, ({ params }) => {
      expect(params).toMatchObject({ ruleId: activeId });
      return { ...promoted, rules: [promoted.rules[1]!] };
    });
    fireEvent.click(
      within(await row("Client replies → remind directly")).getByRole(
        "button",
        { name: "Delete rule" },
      ),
    );
    expect(
      await screen.findByRole("listitem", {
        name: "Vendor invoices over 1000 → track for follow-up",
      }),
    ).toBeTruthy();
    await expect
      .poll(() =>
        screen.queryByRole("listitem", {
          name: "Client replies → remind directly",
        }),
      )
      .toBeNull();
  });

  it("lets the Human grant a mandate on an active rule and lists what Another Me did under it", async () => {
    const runtime = renderPage();
    expect(
      within(await row("Vendor invoices → track for follow-up")).queryByRole(
        "combobox",
        { name: "Mandate" },
      ),
    ).toBeNull();
    const granted: TeamHubProactiveRuleBook = {
      ...book,
      rules: [{ ...book.rules[0]!, mandate: "create" }, book.rules[1]!],
      mandates: [
        {
          owner_actor_id: "actor_human",
          rule_id: activeId,
          rule_text: "Client replies → remind directly",
          guideline_version: 3,
          event_source: "gmail",
          event_external_id: "thread_1",
          strength: "create",
          revoked: false,
          recorded_at: "2026-11-03T08:00:00Z",
          work_item_id: "workitem_1",
          number: 7,
          title: "Answer the Acme reply",
        },
      ],
    };
    runtime.server.on("PUT", `${rulePath}/mandate`, ({ body, params }) => {
      expect(params).toMatchObject({ ruleId: activeId });
      expect(body).toEqual({ mandate: "create" });
      return granted;
    });
    const active = await row("Client replies → remind directly");
    fireEvent.click(within(active).getByRole("combobox", { name: "Mandate" }));
    fireEvent.click(
      await screen.findByRole("option", { name: "Create a Work Item" }),
    );
    const actions = await screen.findByRole("list", {
      name: "Actions taken under this rule",
    });
    expect(
      within(actions).getByText("#7 Answer the Acme reply: created for gmail"),
    ).toBeTruthy();
    expect(
      within(await row("Client replies → remind directly")).getByRole(
        "combobox",
        { name: "Mandate" },
      ).textContent,
    ).toContain("Create a Work Item");
  });
});
