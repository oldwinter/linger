import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubProactiveRule,
  TeamHubProactiveRuleBook,
} from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { ShadowRuleReviewPage } from "./shadow-rule-review-page";

const firstId = "pr_0000000000000000000000000000000b";
const secondId = "pr_0000000000000000000000000000000c";
const rulesPath = "/v0/tenants/{tenantId}/me/proactive-rules";
const rulePath = "/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}";
const promotionPath =
  "/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}/promotion";

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

function book(rules: TeamHubProactiveRule[]): TeamHubProactiveRuleBook {
  return {
    version: 2,
    rules,
    clues: [],
    divergences: [
      {
        id: "psd_0000000000000000000000000000000b",
        rule_id: firstId,
        guideline_version: 2,
        matter: "AWS invoice",
        shadow_action: "track",
        taken_action: "notify",
        created_at: "2026-11-04T08:00:00Z",
      },
      {
        id: "psd_0000000000000000000000000000000a",
        rule_id: firstId,
        guideline_version: 2,
        matter: "Older invoice",
        shadow_action: "silent",
        taken_action: "notify",
        created_at: "2026-11-01T08:00:00Z",
      },
    ],
    mandates: [],
  };
}

function renderReview(initial: TeamHubProactiveRuleBook) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", rulesPath, () => initial);
  const router = createMemoryRouter(
    [
      {
        element: <ShadowRuleReviewPage />,
        path: "/t/:tenantId/settings/my-rules/review",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/settings/my-rules/review"] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return runtime;
}

describe("Review new rules", () => {
  it("leaves a rule in shadow without writing, then promotes the next one", async () => {
    const initial = book([
      rule(firstId, "Vendor invoices", "shadow"),
      rule(secondId, "Travel receipts", "shadow"),
    ]);
    const runtime = renderReview(initial);
    const promote = vi.fn(({ params }: { params: { ruleId?: string } }) => {
      expect(params.ruleId).toBe(secondId);
      return book([
        rule(firstId, "Vendor invoices", "shadow"),
        rule(secondId, "Travel receipts", "active"),
      ]);
    });
    runtime.server.on("POST", promotionPath, promote);

    expect(
      await screen.findByRole("heading", { name: "Vendor invoices" }),
    ).toBeVisible();
    expect(screen.getByText("1 of 2")).toBeVisible();
    expect(
      screen.getByText(
        "AWS invoice: would follow up later, Another Me chose to tell now",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Older invoice/u)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Leave in shadow" }));
    expect(promote).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Travel receipts" }),
    ).toBeVisible();
    expect(screen.getByText("2 of 2")).toBeVisible();
    expect(
      screen.getByText(
        "Another Me has not differed from you on this rule yet.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(
      await screen.findByRole("heading", {
        name: "You promoted 1 rule. 1 stays in shadow.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Travel receipts")).toBeVisible();
    expect(promote).toHaveBeenCalledOnce();
  });

  it("stays on the rule when promotion fails", async () => {
    const runtime = renderReview(
      book([rule(firstId, "Vendor invoices", "shadow")]),
    );
    runtime.server.on("POST", promotionPath, () =>
      teamHubErrorResponse(500, "RULE_UNAVAILABLE", "Could not promote."),
    );
    expect(
      await screen.findByRole("heading", { name: "Vendor invoices" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(
      await screen.findByText("The change was not saved. Try again."),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Vendor invoices" }),
    ).toBeVisible();
  });

  it("says there is nothing new when every rule is already active", async () => {
    renderReview(book([rule(firstId, "Vendor invoices", "active")]));
    expect(
      await screen.findByRole("heading", { name: "No new rules to review." }),
    ).toBeVisible();
  });

  it("edits a shadow rule inline before promoting it and shows loading state", async () => {
    const initial = book([rule(firstId, "Vendor invoices", "shadow")]);
    const runtime = renderReview(initial);
    let resolveEdit!: () => void;
    const editResponse = new Promise<TeamHubProactiveRuleBook>((resolve) => {
      resolveEdit = () =>
        resolve(book([rule(firstId, "Urgent vendor invoices only", "shadow")]));
    });
    const patch = vi.fn(
      ({ body, params }: { body?: unknown; params: { ruleId?: string } }) => {
        expect(params.ruleId).toBe(firstId);
        expect(body).toEqual({ text: "Urgent vendor invoices only" });
        return editResponse;
      },
    );
    const promote = vi.fn(() =>
      book([rule(firstId, "Urgent vendor invoices only", "active")]),
    );
    runtime.server.on("PATCH", rulePath, patch);
    runtime.server.on("POST", promotionPath, promote);

    expect(
      await screen.findByRole("heading", { name: "Vendor invoices" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: "Rule text" });
    expect(editor).toHaveValue("Vendor invoices");

    fireEvent.change(editor, {
      target: { value: "Urgent vendor invoices only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    await act(async () => resolveEdit());

    expect(
      await screen.findByRole("heading", {
        name: "Urgent vendor invoices only",
      }),
    ).toBeVisible();
    expect(patch).toHaveBeenCalledOnce();
    expect(promote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(
      await screen.findByRole("heading", {
        name: "You promoted 1 rule. None stay in shadow.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Urgent vendor invoices only")).toBeVisible();
  });

  it("confirms before deleting a wrong learned rule and updates the review summary", async () => {
    const initial = book([
      rule(firstId, "Vendor invoices", "shadow"),
      rule(secondId, "Travel receipts", "shadow"),
    ]);
    const runtime = renderReview(initial);
    const remove = vi.fn(({ params }: { params: { ruleId?: string } }) => {
      expect(params.ruleId).toBe(firstId);
      return book([rule(secondId, "Travel receipts", "shadow")]);
    });
    const promote = vi.fn(() =>
      book([rule(secondId, "Travel receipts", "active")]),
    );
    runtime.server.on("DELETE", rulePath, remove);
    runtime.server.on("POST", promotionPath, promote);

    expect(
      await screen.findByRole("heading", { name: "Vendor invoices" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete rule?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete rule?" })).toBeNull();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const reopened = screen.getByRole("dialog", { name: "Delete rule?" });
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Delete rule" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Travel receipts" }),
    ).toBeVisible();
    expect(remove).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(
      await screen.findByRole("heading", {
        name: "You promoted 1 rule. 1 deleted.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Travel receipts")).toBeVisible();
  });
});
