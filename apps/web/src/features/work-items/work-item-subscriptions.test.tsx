import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubTaskSubscription } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { WorkItemSubscriptionsSection } from "./work-item-subscriptions";

function makeSubscription(
  overrides: Partial<TeamHubTaskSubscription> = {},
): TeamHubTaskSubscription {
  return {
    created_at: "2026-11-27T08:00:00Z",
    created_by_actor_id: "actor-another-me",
    display_label: "conn_1:thread_1",
    id: "tsub_0123456789abcdef0123456789abcdef",
    normalized_source_key: "conn_1:thread_1",
    owner_actor_id: "actor-alice",
    source_type: "mail",
    status: "active",
    task_id: "work-item-task-1",
    tenant_id: "tenant-acme",
    ...overrides,
  };
}

function renderSection(
  kind: "issue" | "task",
  subscriptions: TeamHubTaskSubscription[],
) {
  const runtime = createTestTeamHubRuntime();
  const dropSpy = vi.fn();
  runtime.server
    .on("GET", "/v0/work-items/{workItemId}/subscriptions", () => ({
      items: subscriptions,
    }))
    .on(
      "POST",
      "/v0/work-items/{workItemId}/subscriptions/{subscriptionId}/drop",
      ({ params }) => {
        dropSpy(params.workItemId, params.subscriptionId);
        const match = subscriptions.find(
          (item) => item.id === params.subscriptionId,
        )!;
        return {
          ...match,
          dropped_at: "2026-11-27T09:00:00Z",
          dropped_by_actor_id: "actor-alice",
          dropped_by_kind: "owner" as const,
          status: "dropped" as const,
        };
      },
    );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <WorkItemSubscriptionsSection
          kind={kind}
          tenantId="tenant-acme"
          workItemId="work-item-task-1"
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { ...utils, dropSpy, runtime };
}

describe("WorkItemSubscriptionsSection", () => {
  it("renders nothing for non-task work items", () => {
    const { container } = renderSection("issue", [makeSubscription()]);
    expect(container.firstChild).toBeNull();
  });

  it("lists active subscriptions and lets the owner unsubscribe", async () => {
    const mailSub = makeSubscription();
    const githubSub = makeSubscription({
      display_label: "oldwinter/linger#6",
      dropped_at: "2026-11-27T08:30:00Z",
      dropped_by_actor_id: "actor-another-me",
      dropped_by_kind: "another_me",
      id: "tsub_fedcba9876543210fedcba9876543210",
      normalized_source_key: "oldwinter/linger#6",
      source_type: "github",
      status: "dropped",
    });
    const { dropSpy } = renderSection("task", [mailSub, githubSub]);

    expect(await screen.findByText("Follow-up subscriptions")).toBeTruthy();
    expect(screen.getByText("Mail")).toBeTruthy();
    expect(screen.getByText("conn_1:thread_1")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("oldwinter/linger#6")).toBeTruthy();
    expect(screen.getByText("Unsubscribed by Another Me")).toBeTruthy();

    const button = screen.getByRole("button", {
      name: "Unsubscribe conn_1:thread_1",
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(dropSpy).toHaveBeenCalledWith(
        "work-item-task-1",
        "tsub_0123456789abcdef0123456789abcdef",
      );
      expect(screen.getByText("Unsubscribed by you")).toBeTruthy();
    });
    expect(
      screen.queryByRole("button", { name: "Unsubscribe conn_1:thread_1" }),
    ).toBeNull();
  });
});
