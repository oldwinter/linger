import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { FinishThisPage } from "./finish-this-page";

it("marks an open job done so it leaves the open work", async () => {
  const runtime = createTestTeamHubRuntime();
  const posts: unknown[] = [];
  runtime.server.on(
    "POST",
    "/v0/work-items/{workItemId}/transitions",
    ({ body, request }) => {
      posts.push({
        body,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      });
      const current = runtime.seed.workItems.find(
        (item) => item.id === "work-item-typed-card",
      )!;
      const next: TeamHubWorkItem = {
        ...current,
        resolution: "completed",
        state: "resolved",
        version: current.version + 1,
      };
      return next;
    },
  );
  renderPage(runtime);

  expect(
    await screen.findByRole("heading", { name: "Finish this" }),
  ).toBeVisible();
  expect(screen.getByText("Ship typed-card collaboration")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Mark it done" }));

  expect(await screen.findByText("It's done. It sits in Done.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Open it again" })).toBeVisible();
  expect(posts).toEqual([
    {
      body: {
        expected_version: 1,
        resolution: "completed",
        state: "resolved",
      },
      idempotencyKey: expect.any(String),
    },
  ]);
});

it("leaves a job that is being carried out to its run", async () => {
  const runtime = createTestTeamHubRuntime();
  const current = runtime.seed.workItems.find(
    (item) => item.id === "work-item-typed-card",
  )!;
  runtime.seed.workItems = runtime.seed.workItems.map((item) =>
    item.id === current.id
      ? {
          ...item,
          task_execution: {
            control_revision: 1,
            control_settled_revision: 1,
            desired_control: "run",
            execution_revision: 1,
            execution_updated_at: "2026-07-30T08:42:00Z",
            generation: 1,
            pending_control: false,
            status: "running",
          },
        }
      : item,
  );
  renderPage(runtime);

  expect(
    await screen.findByText(
      "This job is being carried out. The dashboard leaves it to that run.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Mark it done" }),
  ).not.toBeInTheDocument();
});

function renderPage(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const router = createMemoryRouter(
    [
      {
        element: <FinishThisPage />,
        path: "/t/:tenantId/dashboard/:workItemId/finish",
      },
    ],
    {
      initialEntries: [
        "/t/tenant-northstar/dashboard/work-item-typed-card/finish",
      ],
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
}
