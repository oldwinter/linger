import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubData } from "@/features/teamhub/teamhub-api";

import { AuthenticatedRouteLoading } from "./route-loading-surface";

describe("AuthenticatedRouteLoading", () => {
  it("names the destination Room for assistive tech but draws only shapes", async () => {
    const runtime = createTestTeamHubRuntime();

    const rooms = await teamHubData(
      runtime.client.api.GET("/v0/tenants/{tenantId}/rooms", {
        params: { path: { tenantId: "tenant-northstar" } },
      }),
    );

    render(
      <AuthenticatedRouteLoading
        pathname="/t/tenant-northstar/rooms/room-gtm-launch/chat"
        rooms={rooms.items}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Loading gtm-launch" }),
    ).toHaveAttribute("data-loading-route", "room");
    // No title or status text lands ahead of the rest of the Room.
    expect(screen.queryByText("gtm-launch")).toBeNull();
  });

  it.each([
    ["/t/tenant-northstar/documents/document-1", "Document", "document"],
    ["/t/tenant-northstar/dashboard/work-item-a", "Dashboard", "dashboard"],
    ["/t/tenant-northstar/library/my-documents", "Library", "library"],
    ["/t/tenant-northstar/library/wiki", "Wiki", "library"],
    ["/t/tenant-northstar/wiki-preview", "Wiki", "library"],
    ["/t/tenant-northstar/computers", "Local computers", "page"],
    ["/t/tenant-northstar/rooms/catch-up", "Catch up", "page"],
    ["/t/tenant-northstar/settings/account", "Settings", "page"],
    ["/t/tenant-northstar/jump", "Jump", "page"],
    ["/t/tenant-northstar/awake", "Who is awake", "page"],
    ["/t/tenant-northstar/surprise", "Surprise me", "page"],
    ["/t/tenant-northstar/voices", "Who is speaking", "page"],
    ["/t/tenant-northstar/hearing", "Right now", "page"],
    ["/t/tenant-northstar/work-items/wi-1", "Work Item", "page"],
    ["/t/tenant-northstar/unknown-destination", "page", "page"],
  ])("maps %s to the %s loading surface", (pathname, label, kind) => {
    render(<AuthenticatedRouteLoading pathname={pathname} rooms={[]} />);

    expect(
      screen.getByRole("status", { name: `Loading ${label}` }),
    ).toHaveAttribute("data-loading-route", kind);
  });

  it("renders skeleton chrome without stale sidebar labels while a Document loads", () => {
    render(
      <AuthenticatedRouteLoading
        pathname="/t/tenant-northstar/documents/document-1"
        rooms={[]}
      />,
    );

    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.queryByText("My pages")).toBeNull();
    expect(screen.queryByText("Shared with me")).toBeNull();
    expect(
      screen.getByRole("status", { name: "Loading Document body" }),
    ).toBeVisible();
  });

  it("omits the obsolete sidebar placeholder while a Library route loads", () => {
    const { container } = render(
      <AuthenticatedRouteLoading
        pathname="/t/tenant-northstar/library/meetings"
        rooms={[]}
      />,
    );

    expect(container.querySelector("aside")).toBeNull();
    for (const item of ["Overview", "Search", "Wiki", "My pages"]) {
      expect(screen.queryByText(item)).toBeNull();
    }
  });
});
