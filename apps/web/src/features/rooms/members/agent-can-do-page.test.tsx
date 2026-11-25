import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { AgentCanDoPage } from "./agent-can-do-page";

describe("What an agent can do", () => {
  it("turns a skill off so the agent will not use it", async () => {
    const runtime = createTestTeamHubRuntime();
    let enabled = true;
    let version = 1;
    const puts: unknown[] = [];
    const binding = () => ({
      agent_actor_id: "actor-codex",
      binding_version: version,
      config: {},
      enabled,
      id: "binding-review",
      skill: {
        manifest_version: "1.0.0",
        skill_id: "skill-review-changes",
      },
      tenant_id: "tenant-northstar",
      updated_at: "2026-11-14T00:00:00Z",
      updated_by_actor_id: "actor-jenny",
    });
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/agents/{agentId}/skill-bindings",
      () => ({
        agent_actor_id: "actor-codex",
        binding_version: version,
        items: [binding()],
      }),
    );
    runtime.server.on(
      "PUT",
      "/v0/tenants/{tenantId}/agents/{agentId}/skill-bindings/{skillId}",
      ({ body }) => {
        puts.push(body);
        enabled = (body as { enabled: boolean }).enabled;
        version += 1;
        return binding();
      },
    );
    const router = createMemoryRouter(
      [
        {
          element: <AgentCanDoPage />,
          path: "/t/:tenantId/agents/:agentId/can-do",
        },
      ],
      {
        initialEntries: ["/t/tenant-northstar/agents/actor-codex/can-do"],
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

    fireEvent.click(
      await screen.findByRole("button", { name: "Turn off Review Changes" }),
    );
    expect(
      await screen.findByRole("button", { name: "Turn on Review Changes" }),
    ).toBeVisible();
    expect(screen.getByText("Off")).toBeVisible();
    expect(puts[0]).toMatchObject({
      enabled: false,
      expected_binding_version: 1,
      manifest_version: "1.0.0",
    });
  });

  it("separates always-on built-in skills from custom configurable skills", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.seed.tenantAgents = runtime.seed.tenantAgents.map((agent) =>
      agent.actor.id === "actor-codex"
        ? {
            ...agent,
            skill_bindings: [
              {
                enabled: true,
                is_default: true,
                manifest_version: "1.0.0",
                name: "TeamHub Basics",
                skill_id: "skill-teamhub-basics",
              },
            ],
          }
        : agent,
    );
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/agents/{agentId}/skill-bindings",
      () => ({
        agent_actor_id: "actor-codex",
        binding_version: 1,
        items: [],
      }),
    );
    const router = createMemoryRouter(
      [
        {
          element: <AgentCanDoPage />,
          path: "/t/:tenantId/agents/:agentId/can-do",
        },
      ],
      {
        initialEntries: ["/t/tenant-northstar/agents/actor-codex/can-do"],
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

    expect(
      await screen.findByRole("heading", { name: "Included by default" }),
    ).toBeVisible();
    expect(screen.getByText("TeamHub Basics")).toBeVisible();
    expect(screen.getByText("Always on")).toBeVisible();
    expect(
      screen.getByText(
        "No custom skills added yet. Add custom skills in Agent Info to turn them on or off here.",
      ),
    ).toBeVisible();
  });
});
