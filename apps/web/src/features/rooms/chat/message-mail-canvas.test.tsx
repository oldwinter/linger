import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { MessageMailCanvas } from "./message-mail-canvas";

describe("MessageMailCanvas", () => {
  it("uses one subject toggle button with trailing chevron and a sibling open-in-panel control", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("GET", "/v0/documents/{documentId}/mail", () => ({
      can_edit: true,
      source_digest: `sha256:${"0".repeat(64)}`,
      status: "draft" as const,
      subject: "Launch announcement",
      to: "lisa@acme.com",
    }));
    const onOpen = vi.fn();

    render(
      <MemoryRouter>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <TeamHubRuntimeProvider runtime={runtime}>
            <MessageMailCanvas
              documentId="doc-mail-1"
              fallback={<span>Fallback</span>}
              onOpen={onOpen}
              tenantId="tenant-northstar"
            />
          </TeamHubRuntimeProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const card = await screen.findByRole("region", { name: "Email" });
    const expandableButtons = Array.from(
      card.querySelectorAll("button[aria-expanded]"),
    );
    expect(expandableButtons).toHaveLength(1);

    const toggle = expandableButtons[0] as HTMLButtonElement;
    expect(toggle).toHaveTextContent("Launch announcement");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.querySelectorAll("svg")).toHaveLength(2);
    expect(toggle.closest("h3")).not.toBeNull();

    const openInPanel = within(card).getByRole("button", {
      name: "Open in side panel",
    });
    expect(toggle).not.toContainElement(openInPanel);
    expect(openInPanel.closest("h3")).toBeNull();

    fireEvent.click(openInPanel);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const chevron = toggle.querySelectorAll("svg")[1];
    expect(chevron).toHaveClass("rotate-180");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
