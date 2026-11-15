import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubProactiveRule,
  TeamHubProactiveRuleBook,
} from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import type { TestRouteHandler } from "@/test/teamhub-test-server";

import { RuleNextPage } from "./rule-next-page";

const shadowId = "pr_0000000000000000000000000000000b";

function rule(status: TeamHubProactiveRule["status"]): TeamHubProactiveRule {
  return {
    created_at: "2026-11-01T08:00:00Z",
    guideline_version: 2,
    id: shadowId,
    mandate: "none",
    pinned: false,
    promoted_at: status === "active" ? "2026-11-02T08:00:00Z" : null,
    source: "learned",
    status,
    text: "Vendor invoices → track for follow-up",
  };
}

function book(
  status: TeamHubProactiveRule["status"],
): TeamHubProactiveRuleBook {
  return {
    clues: [],
    divergences: [
      {
        created_at: "2026-11-02T08:00:00Z",
        guideline_version: 2,
        id: "psd_0000000000000000000000000000000a",
        matter: "AWS invoice",
        rule_id: shadowId,
        shadow_action: "track",
        taken_action: "notify",
      },
    ],
    mandates: [],
    rules: [rule(status)],
    version: 2,
  };
}

function renderPage(status: TeamHubProactiveRule["status"] = "shadow") {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/me/proactive-rules", () =>
    book(status),
  );
  const promote = vi.fn<TestRouteHandler>(() => book("active"));
  runtime.server.on(
    "POST",
    "/v0/tenants/{tenantId}/me/proactive-rules/{ruleId}/promotion",
    promote,
  );
  const router = createMemoryRouter(
    [
      {
        element: <RuleNextPage />,
        path: "/t/:tenantId/settings/rule-changes/:ruleId",
      },
    ],
    {
      initialEntries: [`/t/tenant-northstar/settings/rule-changes/${shadowId}`],
    },
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
  return promote;
}

describe("RuleNextPage", () => {
  it("lets a shadow rule decide, so the next match follows it", async () => {
    const promote = renderPage();
    expect(
      await screen.findByText(
        "On AWS invoice, Another Me chose to tell you now. From the next time this rule decides, it will follow up later.",
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Let this rule decide" }),
    );
    expect(await screen.findByText("This rule already decides.")).toBeVisible();
    expect(promote).toHaveBeenCalledTimes(1);
  });
});
