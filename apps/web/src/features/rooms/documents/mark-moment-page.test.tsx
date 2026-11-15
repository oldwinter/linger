import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { MarkMomentPage } from "./mark-moment-page";

describe("Mark this moment", () => {
  it("keeps the current page as a history checkpoint", async () => {
    const runtime = createTestTeamHubRuntime();
    const marked: string[] = [];
    runtime.server.on(
      "POST",
      "/v0/documents/{documentId}/history/checkpoints",
      ({ params }) => {
        marked.push(params.documentId ?? "");
        return {
          document_id: params.documentId,
          id: "checkpoint-1",
          status: "completed",
          target_persisted_seq: 3,
        };
      },
    );
    const router = createMemoryRouter(
      [
        {
          element: <MarkMomentPage />,
          path: "/t/:tenantId/documents/:documentId/mark",
        },
      ],
      {
        initialEntries: [
          "/t/tenant-northstar/documents/document-product-v0-brief/mark",
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

    expect(await screen.findByText(/product-v0-brief\.md stays/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark it" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Marked. This moment stays in the page history.",
    );
    expect(marked).toEqual(["document-product-v0-brief"]);
  });
});
