import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { ComputerCanDoPage } from "./computer-can-do-page";
import type { ComputerPermissionStatus } from "./computer-permissions-api";

const permissionsPath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/permissions";

function status(
  screenState: ComputerPermissionStatus["subjects"][number]["permissions"][number]["state"],
): ComputerPermissionStatus {
  return {
    host: "desktop",
    platform: "darwin",
    subjects: [
      {
        permissions: [
          {
            id: "screen_recording",
            prompt: "available",
            relaunch_required: false,
            state: screenState,
          },
          {
            id: "accessibility",
            prompt: "available",
            relaunch_required: false,
            state: "granted",
          },
        ],
        subject: "linger",
      },
    ],
  };
}

function renderPage(runtime: ReturnType<typeof createTestTeamHubRuntime>) {
  const router = createMemoryRouter(
    [
      {
        element: <ComputerCanDoPage />,
        path: "/t/:tenantId/settings/computers/:computerId/can-do",
      },
    ],
    {
      initialEntries: [
        "/t/tenant-northstar/settings/computers/computer-jenny-mac/can-do",
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

describe("What this Mac can do", () => {
  it("asks macOS for screen recording and shows the grant", async () => {
    const runtime = createTestTeamHubRuntime();
    const posted: unknown[] = [];
    let current = status("not_determined");
    runtime.server.on("GET", permissionsPath, () => current);
    runtime.server.on("POST", permissionsPath, ({ body }) => {
      posted.push(body);
      current = status("granted");
      return current;
    });
    renderPage(runtime);

    expect(
      await screen.findByRole("heading", { name: "What Jenny's Mac can do" }),
    ).toBeVisible();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ask macOS for Screen Recording",
      }),
    );
    await waitFor(() => expect(screen.getAllByText("Granted")).toHaveLength(2));
    expect(
      screen.queryByRole("button", { name: "Ask macOS for Screen Recording" }),
    ).toBeNull();
    expect(posted).toEqual([
      {
        action: "prompt",
        permission: "screen_recording",
        subject: "linger",
      },
    ]);
  });

  it("says when the computer has no macOS permissions", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("GET", permissionsPath, () => ({
      host: "standalone",
      platform: "linux",
      subjects: [],
    }));
    renderPage(runtime);
    expect(
      await screen.findByText(
        "This computer does not use macOS privacy permissions.",
      ),
    ).toBeVisible();
  });
});
