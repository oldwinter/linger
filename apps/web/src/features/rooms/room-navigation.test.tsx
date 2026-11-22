import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import { RoomNavigation } from "./room-navigation";
import { teamHubData } from "@/features/teamhub/teamhub-api";

describe("Room navigation", () => {
  // The Room list is a lazy chunk and most tests query it synchronously, so
  // load it once before any test regardless of the order they run in.
  beforeAll(async () => {
    renderNavigation(await navigationFixture(), new QueryClient());
    await screen.findByRole("navigation", { name: "Room navigation" });
    cleanup();
  });

  it("opens the mobile navigation in one dialog with one close action", async () => {
    const matchMedia = window.matchMedia.bind(window);
    const viewport = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        ...matchMedia(query),
        matches: query === "(width < 48rem)",
      }));
    try {
      const fixture = await navigationFixture();
      renderNavigation(fixture, new QueryClient());
      const dialog = screen.getByRole("dialog", { name: "Room navigation" });
      expect(
        within(dialog).getByRole("navigation", {
          name: "Primary navigation",
        }),
      ).toBeVisible();
      expect(
        await within(dialog).findByRole("navigation", {
          name: "Room navigation",
        }),
      ).toBeVisible();
      expect(
        within(dialog).getAllByRole("button", {
          name: "Close Room navigation",
        }),
      ).toHaveLength(1);
      expect(
        within(dialog).getByRole("link", { name: fixture.rooms[0]!.name }),
      ).toHaveAttribute("aria-current", "page");
    } finally {
      viewport.mockRestore();
    }
  });

  it("opens the Room list at the threads sidebar width and preserves resize preferences", async () => {
    const fixture = await navigationFixture();
    const key = `linger:room-list-width:${fixture.tenant.id}`;
    localStorage.removeItem(key);
    renderNavigation(fixture, new QueryClient());
    const resize = screen.getByRole("separator", {
      name: "Resize Chat navigation",
    });
    expect(resize).toHaveAttribute("aria-valuenow", "380");
    fireEvent.keyDown(resize, { key: "ArrowRight" });
    expect(resize).toHaveAttribute("aria-valuenow", "388");
    expect(localStorage.getItem(key)).toBe("388");
    fireEvent.doubleClick(resize);
    expect(resize).toHaveAttribute("aria-valuenow", "380");
    const workspace = screen.getByRole("link", {
      name: "Library",
    });
    expect(workspace).not.toHaveAttribute("title");
    expect(
      workspace.querySelector(".primary-navigation-label"),
    ).toHaveTextContent("Library");
    localStorage.removeItem(key);
  });

  it("loads activity once for the Room list", async () => {
    const fixture = await navigationFixture();
    const read = vi.fn(() => ({
      failed_room_ids: [],
      running_room_ids: [fixture.rooms[0]!.id],
    }));
    fixture.runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/room-activity",
      read,
    );
    renderNavigation(fixture, new QueryClient());
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Agent working" })).toBeVisible(),
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("opens global search from both the primary rail and Room navigation", async () => {
    const fixture = await navigationFixture();
    const onOpenSearch = vi.fn();
    renderNavigation(
      fixture,
      new QueryClient(),
      undefined,
      undefined,
      onOpenSearch,
    );
    const primary = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    const navigation = screen.getByRole("navigation", {
      name: "Room navigation",
    });
    const railSearch = within(primary).getByRole("button", { name: "Search" });
    expect(railSearch).toHaveAttribute("aria-keyshortcuts", "Control+k Meta+k");
    expect(railSearch).toHaveAttribute(
      "title",
      expect.stringMatching(/Search \((⌘K|Ctrl K)\)/),
    );
    expect(
      railSearch.querySelector(".primary-navigation-label"),
    ).toHaveTextContent("Search");
    expect(railSearch.querySelector("kbd")).toBeNull();
    expect(railSearch.querySelector("svg.room-rail-glyph")).not.toBeNull();
    fireEvent.click(railSearch);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(railSearch.querySelector("kbd")).toHaveTextContent(/⌘K|Ctrl K/);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(railSearch.querySelector("kbd")).toBeNull();

    const search = within(navigation).getByRole("button", { name: "Search" });
    expect(search).toHaveAttribute("aria-keyshortcuts", "Control+k Meta+k");
    expect(search).toHaveAttribute(
      "title",
      expect.stringMatching(/Search \((⌘K|Ctrl K)\)/),
    );
    fireEvent.click(search);
    expect(onOpenSearch).toHaveBeenCalledTimes(2);
    expect(
      within(primary)
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual(["Messages", "Dashboard", "Library", "Wiki", "Connectors"]);
    expect(
      within(navigation).getByRole("button", { name: "Pocket Notes" }),
    ).toBeVisible();
  });

  it("keeps the Search trigger in the primary rail on non-Room routes and shows its shortcut when expanded", async () => {
    const fixture = await navigationFixture();
    const onOpenSearch = vi.fn();
    renderNavigation(
      fixture,
      new QueryClient(),
      `/t/${fixture.tenant.id}/apps`,
      undefined,
      onOpenSearch,
    );
    const primary = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    const railSearch = within(primary).getByRole("button", { name: "Search" });
    expect(railSearch).toBeVisible();
    expect(railSearch.querySelector("kbd")).toHaveTextContent(/⌘K|Ctrl K/);
    fireEvent.click(railSearch);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("toggles the primary sidebar without changing the current Room", async () => {
    const fixture = await navigationFixture();
    renderNavigation(fixture, new QueryClient());
    const pathname = screen.getByTestId("location").textContent;
    // Collapsed, the corner shows the brand; hovering reveals the toggle.
    const expand = screen.getByRole("button", { name: "Expand sidebar" });
    expect(
      expand.querySelector(".primary-navigation-toggle-logo"),
    ).not.toBeNull();
    expect(
      expand.querySelector(".primary-navigation-toggle-glyph svg"),
    ).not.toBeNull();
    fireEvent.click(expand);
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen
        .getByRole("button", { name: "Collapse sidebar" })
        .querySelector(".primary-navigation-toggle-logo"),
    ).toBeNull();
    expect(
      screen.getByRole("navigation", { name: "Room navigation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("separator", { name: "Resize Chat navigation" }),
    ).toBeVisible();
    const header = screen.getByRole("button", {
      name: "Collapse sidebar",
    }).parentElement;
    expect(header).toContainElement(
      screen.getByRole("img", { name: "Linger" }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(pathname);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(
      screen.getByRole("navigation", { name: "Room navigation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: fixture.rooms[0]!.name }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("keeps the web rail in the desktop app and lets the Chat list collapse", async () => {
    const desktop = window as { lingerDesktop?: unknown };
    desktop.lingerDesktop = {};
    try {
      const fixture = await navigationFixture();
      renderNavigation(fixture, new QueryClient());
      expect(
        screen.getByRole("button", { name: "Expand sidebar" }),
      ).toBeVisible();
      const links = within(
        screen.getByRole("navigation", { name: "Primary navigation" }),
      ).getAllByRole("link");
      // Icons only; each full name appears under the pointer, as on the web.
      expect(
        links.map((link) =>
          link.querySelector(".primary-navigation-label")?.textContent?.trim(),
        ),
      ).toEqual(["Messages", "Dashboard", "Library", "Wiki", "Connectors"]);
      const toolbar = await screen.findByRole("toolbar", {
        name: "Message actions",
      });
      expect(within(toolbar).getByText("Messages")).toBeVisible();
      expect(
        within(toolbar).queryByRole("button", { name: "Search" }),
      ).toBeNull();
      expect(
        within(
          screen.getByRole("navigation", { name: "Room navigation" }),
        ).getByRole("button", { name: "Search" }),
      ).toBeVisible();
      fireEvent.click(
        within(toolbar).getByRole("button", { name: "Hide Chat list" }),
      );
      expect(
        screen.queryByRole("navigation", { name: "Room navigation" }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show Chat list" }));
      expect(
        await screen.findByRole("navigation", { name: "Room navigation" }),
      ).toBeVisible();
    } finally {
      delete desktop.lingerDesktop;
    }
  });

  it("shows fixture unread projections without creating another activity surface", async () => {
    const fixture = await navigationFixture();

    renderNavigation(fixture, new QueryClient());

    expect(screen.getByLabelText("1 unread mention")).toBeVisible();
    expect(screen.getAllByLabelText("1 unread message")).toHaveLength(1);
  });

  it("does not clear authoritative unread state from navigation alone", async () => {
    const fixture = await navigationFixture();

    renderNavigation(fixture, new QueryClient());

    // The away recap repeats these Room names above the list; both its rows and
    // the Room rows navigate, so scope these clicks to the Room list itself.
    const messages = () =>
      screen.getByRole("heading", { name: "Messages" }).closest("section")!;
    fireEvent.click(
      within(messages()).getByRole("link", { name: /gtm-launch/ }),
    );
    expect(screen.getByLabelText("1 unread mention")).toBeVisible();
    expect(screen.getAllByLabelText("1 unread message")).toHaveLength(1);
    fireEvent.click(within(messages()).getByRole("link", { name: /^all$/ }));
    expect(screen.getByLabelText("1 unread mention")).toBeVisible();
    expect(screen.getAllByLabelText("1 unread message")).toHaveLength(1);
  });

  it("renders Direct Rooms under Chats", async () => {
    const fixture = await navigationFixture();

    renderNavigation(fixture, new QueryClient());

    expect(screen.getByRole("heading", { name: "Messages" })).toBeVisible();
    const messages = screen
      .getByRole("heading", { name: "Messages" })
      .closest("section")!;
    expect(within(messages).getByRole("link", { name: /Codex/ })).toBeVisible();
  });

  it("pins Another Me as its own card above the Chats list", async () => {
    const fixture = await navigationFixture();
    const anotherMe = await teamHubData(
      fixture.runtime.client.api.GET("/v0/tenants/{tenantId}/another-me", {
        params: { path: { tenantId: fixture.tenant.id } },
      }),
    );
    const anotherMeRoom = fixture.rooms.find(
      (room) => room.id === anotherMe.room_id,
    );
    if (!anotherMeRoom) throw new Error("Fixture Another Me Room is missing");

    renderNavigation(fixture, new QueryClient(), undefined, anotherMe.room_id);

    const agentsSection = screen
      .getByRole("heading", { name: "Messages" })
      .closest("section")!;
    const anotherMeLabel = `${anotherMeRoom.direct_peer!.display_name} chat`;
    const card = screen.getByRole("link", { name: anotherMeLabel });
    expect(
      within(agentsSection).queryByRole("link", { name: anotherMeLabel }),
    ).toBeNull();
    expect(
      card.compareDocumentPosition(agentsSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(card.closest(".another-me-card")).not.toBeNull();
    expect(card).toHaveAttribute(
      "href",
      `/t/${fixture.tenant.id}/rooms/${anotherMeRoom.id}/chat`,
    );
    expect(
      screen.getByText(anotherMeRoom.direct_peer!.display_name),
    ).toBeVisible();
  });

  it("keeps Account identity and actions out of Room navigation", async () => {
    const fixture = await navigationFixture();

    renderNavigation(fixture, new QueryClient());

    expect(screen.queryByText("Jenny Bin")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menu", { name: "Account actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Log out" }),
    ).not.toBeInTheDocument();
  });

  it.each(["Messages", "Library"])(
    "keeps %s selection free of a dark background or selectable glyph",
    async (label) => {
      const fixture = await navigationFixture();
      const pathname =
        label === "Library"
          ? `/t/${fixture.tenant.id}/library`
          : `/t/${fixture.tenant.id}/rooms/${fixture.rooms[0]!.id}/chat`;
      renderNavigation(fixture, new QueryClient(), pathname);
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveClass("select-none", "text-app-ink");
      expect(link).not.toHaveClass("bg-black/5");
      const glyph = link.querySelector("svg.room-rail-glyph");
      expect(glyph).toHaveClass("pointer-events-none");
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    },
  );

  it("draws a Hugeicons glyph for every product rail destination", async () => {
    const fixture = await navigationFixture();

    renderNavigation(
      fixture,
      new QueryClient(),
      `/t/${fixture.tenant.id}/rooms/${fixture.rooms[0]!.id}/chat`,
      undefined,
    );

    expect(
      within(
        screen.getByRole("navigation", { name: "Primary navigation" }),
      ).getAllByRole("link"),
    ).toHaveLength(5);
    for (const label of [
      "Messages",
      "Dashboard",
      "Library",
      "Wiki",
      "Connectors",
    ]) {
      expect(
        screen
          .getByRole("link", { name: label })
          .querySelector("svg.room-rail-glyph"),
      ).not.toBeNull();
    }
  });

  it("keeps Members inside the shared primary navigation", async () => {
    const fixture = await navigationFixture();

    renderNavigation(
      fixture,
      new QueryClient(),
      `/t/${fixture.tenant.id}/apps`,
    );

    expect(
      screen.queryByRole("navigation", { name: "Room navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toContainElement(
      screen.getByRole("button", { name: "Account menu test slot" }),
    );
    expect(screen.getByRole("link", { name: "Connectors" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("exposes separate Workspace and Wiki destinations", async () => {
    const fixture = await navigationFixture();

    renderNavigation(fixture, new QueryClient());

    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute(
      "href",
      `/t/${fixture.tenant.id}/library`,
    );
    expect(screen.getByRole("link", { name: "Wiki" })).toHaveAttribute(
      "href",
      `/t/${fixture.tenant.id}/library/wiki`,
    );
    fireEvent.click(screen.getByRole("link", { name: "Wiki" }));
    expect(screen.getByRole("link", { name: "Wiki" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Library" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps Local computers in Settings instead of primary navigation", async () => {
    const fixture = await navigationFixture();

    renderNavigation(
      fixture,
      new QueryClient(),
      `/t/${fixture.tenant.id}/computers`,
    );

    expect(
      screen.queryByRole("link", { name: "Local computers" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Room navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /cloud/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps Workspace as the Document destination without a Shared Files rail item", async () => {
    const fixture = await navigationFixture();

    renderNavigation(fixture, new QueryClient());

    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Files" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library" })).toBeVisible();
  });

  it("expands the primary rail with visible labels in the mobile drawer on non-Room routes", async () => {
    const matchMedia = window.matchMedia.bind(window);
    const viewport = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        ...matchMedia(query),
        matches: query === "(width < 48rem)",
      }));
    try {
      const fixture = await navigationFixture();
      renderNavigation(
        fixture,
        new QueryClient(),
        `/t/${fixture.tenant.id}/apps`,
      );
      const sidebar = screen.getByRole("complementary", {
        name: "Collaboration sidebar",
      });
      expect(sidebar).toHaveAttribute("data-expanded", "true");
      expect(sidebar).toHaveClass("w-[220px]");
      expect(
        screen.queryByRole("button", { name: /sidebar$/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("jenny's space")).toBeVisible();
    } finally {
      viewport.mockRestore();
    }
  });

  it.each([
    ["/work-items/wi-1", "Dashboard"],
    ["/wiki-preview", "Wiki"],
    ["/library/remembered", "Wiki"],
    ["/library/introduction", "Wiki"],
    ["/library/life", "Wiki"],
  ])(
    "marks %s active under %s in the primary rail",
    async (suffix, activeLabel) => {
      const fixture = await navigationFixture();
      renderNavigation(
        fixture,
        new QueryClient(),
        `/t/${fixture.tenant.id}${suffix}`,
      );
      expect(screen.getByRole("link", { name: activeLabel })).toHaveAttribute(
        "aria-current",
        "page",
      );
      if (activeLabel === "Wiki") {
        expect(
          screen.getByRole("link", { name: "Library" }),
        ).not.toHaveAttribute("aria-current");
      }
    },
  );
});

async function navigationFixture() {
  const runtime = createTestTeamHubRuntime();

  const tenant = runtime.seed.tenant;
  const rooms = await teamHubData(
    runtime.client.api.GET("/v0/tenants/{tenantId}/rooms", {
      params: { path: { tenantId: tenant.id } },
    }),
  );
  const otherTenant = {
    ...tenant,
    id: "tenant-southstar",
    name: "Southstar",
  };

  return {
    otherTenant,
    rooms: rooms.items,
    runtime,
    tenant,
  };
}

function renderNavigation(
  fixture: Awaited<ReturnType<typeof navigationFixture>>,
  queryClient: QueryClient,
  initialEntry = `/t/${fixture.tenant.id}/rooms/${fixture.rooms[0]!.id}/chat`,
  anotherMeRoomId?: string,
  onOpenSearch?: () => void,
) {
  const navigation = (
    <>
      <RoomNavigation
        onOpenSearch={onOpenSearch}
        username="jenny"
        accountMenu={<button aria-label="Account menu test slot" />}
        anotherMeRoomId={anotherMeRoomId}
        mobileOpen
        onCloseMobile={vi.fn()}
        onCreateRoom={vi.fn()}
        rooms={fixture.rooms}
        tenant={fixture.tenant}
      />
      <LocationProbe />
    </>
  );

  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={fixture.runtime}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              element={navigation}
              path="/t/:tenantId/rooms/:roomId/:view"
            />
            <Route element={navigation} path="/t/:tenantId/library/*" />
            <Route element={navigation} path="/t/:tenantId/wiki-preview" />
            <Route element={navigation} path="/t/:tenantId/work-items/*" />
            <Route element={navigation} path="/t/:tenantId/apps" />
            <Route element={navigation} path="/t/:tenantId/computers" />
            <Route element={navigation} path="/t/:tenantId/settings/*" />
          </Routes>
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
