import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { LeaveALinePage } from "./leave-a-line-page";

it("leaves a line on the job and keeps the lines already there", async () => {
  const runtime = createTestTeamHubRuntime();
  const jenny = runtime.seed.identity.actors[0]!;
  const lines = [
    {
      author: {
        display_name: "Maya Chen",
        id: "actor-maya",
        kind: "human" as const,
        tenant_id: "tenant-northstar",
      },
      body: "The typed cards need a second pass.",
      created_at: "2026-07-30T09:00:00Z",
      id: "comment-maya",
      segments: [
        {
          type: "text" as const,
          content: "The typed cards need a second pass.",
        },
      ],
      tenant_id: "tenant-northstar",
      updated_at: "2026-07-30T09:00:00Z",
      version: 1,
      work_item_id: "work-item-typed-card",
    },
  ];
  const posts: unknown[] = [];
  runtime.server.on("GET", "/v0/work-items/{workItemId}/comments", () => ({
    items: lines,
    page: { has_more: false },
  }));
  runtime.server.on(
    "POST",
    "/v0/work-items/{workItemId}/comments",
    ({ body, request }) => {
      posts.push({
        body,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      });
      const text = (body as { body: string }).body;
      const comment = {
        author: {
          display_name: jenny.display_name,
          id: jenny.id,
          kind: "human" as const,
          tenant_id: "tenant-northstar",
        },
        body: text,
        created_at: "2026-07-30T10:00:00Z",
        id: "comment-jenny",
        segments: [{ type: "text" as const, content: text }],
        tenant_id: "tenant-northstar",
        updated_at: "2026-07-30T10:00:00Z",
        version: 1,
        work_item_id: "work-item-typed-card",
      };
      lines.push(comment);
      return Response.json(comment, { status: 201 });
    },
  );
  renderPage(runtime);

  expect(
    await screen.findByRole("heading", { name: "Leave a line" }),
  ).toBeVisible();
  expect(screen.getByText("Ship typed-card collaboration")).toBeVisible();
  expect(
    await screen.findByText("The typed cards need a second pass."),
  ).toBeVisible();
  const submit = screen.getByRole("button", { name: "Leave this line" });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("The line"), {
    target: { value: "Hold the launch until the cards land." },
  });
  fireEvent.click(submit);

  expect(await screen.findByText("Saved. It stays on this job.")).toBeVisible();
  expect(
    screen.getByText("Hold the launch until the cards land."),
  ).toBeVisible();
  expect(posts).toEqual([
    {
      body: {
        body: "Hold the launch until the cards land.",
        segments: [
          {
            type: "text",
            content: "Hold the launch until the cards land.",
          },
        ],
      },
      idempotencyKey: expect.any(String),
    },
  ]);
});

function renderPage(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const router = createMemoryRouter(
    [
      {
        element: <LeaveALinePage />,
        path: "/t/:tenantId/dashboard/:workItemId/line",
      },
    ],
    {
      initialEntries: [
        "/t/tenant-northstar/dashboard/work-item-typed-card/line",
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
