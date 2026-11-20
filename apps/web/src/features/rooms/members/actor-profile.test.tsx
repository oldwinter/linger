import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubActor } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { ActorProfilePanel } from "./actor-profile";

describe("ActorProfilePanel (Human)", () => {
  it("collapses repeated human role metadata into a single pill and omits empty description filler", async () => {
    const runtime = createTestTeamHubRuntime();
    const actor: TeamHubActor = {
      created_at: "2026-09-10T08:00:00Z",
      display_name: "Maya Chen",
      handle: "@maya",
      id: "actor-maya",
      kind: "human",
      tenant_id: "tenant-northstar",
    };

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider runtime={runtime}>
          <Suspense fallback={null}>
            <ActorProfilePanel
              actor={actor}
              onClose={vi.fn()}
              onSelectActor={vi.fn()}
              tenantId="tenant-northstar"
            />
          </Suspense>
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    const panel = await screen.findByRole("complementary", {
      name: "Maya Chen profile",
    });
    expect(within(panel).getByText("Joined")).toBeVisible();
    expect(within(panel).getAllByText("Member")).toHaveLength(1);
    expect(within(panel).queryByText("Human")).toBeNull();
    expect(within(panel).queryByText("Role")).toBeNull();
    expect(within(panel).queryByText("No description")).toBeNull();
    expect(panel.querySelector("header")).not.toHaveTextContent("Member");
  });
});
