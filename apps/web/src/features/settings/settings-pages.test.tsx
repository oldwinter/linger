import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useNavigate,
} from "react-router";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { defineGlobalProperty } from "@/test/global-properties";

import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import { DisconnectAccountDialog } from "./account-disconnect-dialogs";
import { AccountSettingsPage } from "./account-settings-page";
import { SettingsLayout } from "./settings-page";
import { ShortcutsSettingsPage } from "./shortcuts-settings-page";

// The dialog imports its sections lazily, so pay that cost before the first
// assertion instead of racing a dynamic import inside a findBy timeout.
beforeAll(async () => {
  await Promise.all([
    import("./account-settings-page"),
    import("@/features/local-computer/computers-page"),
  ]);
});

beforeEach(() => {
  const values = new Map<string, string>();
  defineGlobalProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Settings surfaces", () => {
  it("saves the display name in place without changing the overview", async () => {
    const runtime = await testRuntime();
    const before = await runtime.client.getPersonalProfile("tenant-northstar");
    const saved = {
      ...(await accountProfile(runtime)),
      name: "Jenny Card",
      name_user_managed: true,
    };
    const patch = vi.fn(() => saved);
    runtime.server.on("PATCH", "/v0/tenants/{tenantId}/account-profile", patch);
    renderSettings(runtime);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit display name" }),
    );
    const nameField = screen.getByRole("textbox", {
      name: "Profile display name",
    });
    fireEvent.change(nameField, { target: { value: "Jenny Card" } });
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/account-profile",
      () => saved,
    );
    // Enter saves in place, as an Agent's name does.
    fireEvent.keyDown(nameField, { key: "Enter" });
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Profile display name" }),
      ).not.toBeInTheDocument(),
    );
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { name: "Jenny Card" },
        params: { tenantId: "tenant-northstar" },
      }),
    );
    expect(
      (await screen.findAllByText("Jenny Card", { exact: true }))[0],
    ).toBeVisible();
    expect(await runtime.client.getPersonalProfile("tenant-northstar")).toEqual(
      before,
    );
  });

  it("switches Settings sections through their own addresses and supports browser Back", async () => {
    const runtime = await testRuntime();
    renderSettings(runtime, "/t/tenant-northstar/settings/language");

    expect(await screen.findByText("Language page")).toBeVisible();
    expect(screen.getByRole("main")).toBeVisible();

    fireEvent.click(
      within(
        await screen.findByRole("navigation", { name: "Settings sections" }),
      ).getByRole("link", { name: "Account" }),
    );

    expect(
      await screen.findByRole("button", { name: "Change password" }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Account" }),
    ).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/settings/account",
    );
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(await screen.findByText("Language page")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/settings/language",
    );
  });

  it("opens Shortcuts from Settings navigation", async () => {
    const runtime = await testRuntime();
    renderSettings(runtime);

    fireEvent.click(
      within(
        await screen.findByRole("navigation", { name: "Settings sections" }),
      ).getByRole("link", { name: "Shortcuts" }),
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Shortcuts",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/settings/shortcuts",
    );
  });

  it("presents Account as the profile card, the password and the API keys", async () => {
    const runtime = await testRuntime();
    renderSettings(runtime);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Account" }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Settings")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const settingsNav = screen.getByRole("complementary", {
      name: "Settings navigation",
    });
    expect(
      within(settingsNav)
        .getAllByRole("link")
        .map((link) => link.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual([
      "Account",
      "My Rules",
      "Shortcuts",
      "Computers",
      "Models",
      "System",
      "Language",
    ]);
    expect(
      await screen.findByRole("button", { name: "Edit display name" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Change cover" })).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Upload profile photo" }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Change password" }),
    ).toBeVisible();
    expect(await screen.findByText("Composio")).toBeVisible();
    expect(screen.queryByLabelText("Bio")).toBeNull();
    expect(screen.queryByLabelText("Organization")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Insights" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Log out" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("jenny@northstar.example")).toBeNull();
  });

  it("submits a valid password change from Account settings", async () => {
    const runtime = await testRuntime();
    const change = vi.fn(() => undefined);
    runtime.server.on("POST", "/v0/account/password", change);
    renderSettings(runtime);

    fireEvent.click(
      await screen.findByRole("button", { name: "Change password" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Change password" });
    const submit = within(dialog).getByRole("button", {
      name: "Change password",
    });
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Current password"), {
      target: { value: "linger-v0" },
    });
    fireEvent.change(within(dialog).getByLabelText("New password"), {
      target: { value: "linger-v1" },
    });
    fireEvent.change(within(dialog).getByLabelText("Confirm new password"), {
      target: { value: "different-password" },
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Passwords do not match.",
    );
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Confirm new password"), {
      target: { value: "linger-v1" },
    });
    fireEvent.click(submit);

    expect(await screen.findByText("Password changed")).toBeVisible();
    // Status banner renders directly beneath the password card, above API keys.
    const status = screen.getByText("Password changed");
    const apiKeysHeading = screen.getByText("API keys");
    expect(
      Boolean(
        status.compareDocumentPosition(apiKeysHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { current_password: "linger-v0", new_password: "linger-v1" },
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Change password" }),
    ).not.toBeInTheDocument();
  });

  it("shows the desktop notification state on the Account page", async () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    const runtime = await testRuntime();
    renderSettings(runtime);

    expect(
      await screen.findByRole("heading", { name: "Desktop notifications" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Allow notifications for this site/u),
    ).toBeVisible();
  });

  it("blocks closing DisconnectAccountDialog while disconnect is pending", async () => {
    const runtime = await testRuntime();
    const existing = (await runtime.client.listExternalConnections())
      .connections[0]!;
    let resolveDisconnect!: (value: typeof existing) => void;
    vi.spyOn(runtime.client, "disconnectExternalConnection").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDisconnect = resolve;
        }),
    );
    const onClose = vi.fn();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <DisconnectAccountDialog
          client={runtime.client}
          connection={existing}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Disconnect account?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeDisabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveDisconnect({ ...existing, status: "disconnecting" });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("wraps mobile Settings section links cleanly so Models and Language are not clipped at 390px width", async () => {
    const runtime = await testRuntime();
    renderSettings(runtime);

    const nav = await screen.findByRole("navigation", {
      name: "Settings sections",
    });
    expect(nav).toHaveClass("flex-wrap");
    expect(nav).not.toHaveClass("overflow-x-auto");

    const links = within(nav).getAllByRole("link");
    expect(
      links.map((link) => link.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual([
      "Account",
      "My Rules",
      "Shortcuts",
      "Computers",
      "Models",
      "System",
      "Language",
    ]);
    for (const link of links) {
      expect(link).toHaveClass("shrink-0");
    }
  });
});

describe("Browser preferences", () => {
  const PREFERENCE_KEYS = [
    "last-room.v1:account-a",
    "linger.room-composer-draft:account-a:tenant-a:room-a",
    "room-mention-snooze.v1:account-a",
    "room-mention-mute.v1:account-a",
    "room-snooze.v1:account-a",
    "room-unread-filter.v1:account-a",
    "desktop-notification-pause.v1:account-a",
    "global-search-recent.v2:tenant-a",
    "library-recent-documents.v1:account-a.tenant-a",
    "meeting-resume.v1:account-a",
    "meeting-playback-speed.v1:account-a",
    "wiki-recent-pages.v1:account-a.tenant-a",
  ];

  it("lists every registered preference and disables Clear when nothing is stored", async () => {
    const runtime = await testRuntime();
    renderSettings(runtime);

    const section = await screen.findByRole("region", {
      name: "This browser",
    });

    expect(
      within(section)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Last opened room",
      "Composer drafts",
      "Room mention snoozes and mutes",
      "Snoozed Rooms",
      "Room list filter",
      "Desktop notification pause",
      "Recent searches",
      "Recently opened documents",
      "Meeting listening positions",
      "Meeting playback speed",
      "Recently opened Wiki pages",
    ]);
    expect(
      within(section).getByRole("button", { name: "Clear" }),
    ).toBeDisabled();
  });

  it("asks before clearing and then removes every stored preference", async () => {
    seedBrowserPreferences();
    const runtime = await testRuntime();
    renderSettings(runtime);

    const section = await screen.findByRole("region", {
      name: "This browser",
    });
    fireEvent.click(within(section).getByRole("button", { name: "Clear" }));

    // The first click only asks; the stored values are still there.
    for (const key of PREFERENCE_KEYS) {
      expect(window.localStorage.getItem(key)).not.toBeNull();
    }
    expect(
      within(section).queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(section).getByRole("button", { name: "Clear preferences" }),
    );

    expect(
      await within(section).findByText("Preferences cleared"),
    ).toBeVisible();
    for (const key of PREFERENCE_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
    expect(
      within(section).getByRole("button", { name: "Clear" }),
    ).toBeDisabled();
  });

  it("reports a failure when the browser keeps the stored values", async () => {
    seedBrowserPreferences();
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(
      () => undefined,
    );
    const runtime = await testRuntime();
    renderSettings(runtime);

    const section = await screen.findByRole("region", {
      name: "This browser",
    });
    fireEvent.click(within(section).getByRole("button", { name: "Clear" }));
    fireEvent.click(
      within(section).getByRole("button", { name: "Clear preferences" }),
    );

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "Preferences could not be cleared",
    );
    expect(
      within(section).getByRole("button", { name: "Clear" }),
    ).toBeEnabled();
  });

  function seedBrowserPreferences() {
    for (const key of PREFERENCE_KEYS) {
      window.localStorage.setItem(key, "{}");
    }
    window.localStorage.setItem("unrelated", "keep");
  }
});

describe("Voice API keys", () => {
  it("shows where each voice key comes from and saves one", async () => {
    const runtime = await testRuntime();
    let saved = false;
    runtime.server
      .on("GET", "/v0/tenants/{tenantId}/voice-media-policy", () => ({
        voice_available: true,
        voice_media_supported: saved,
        live_supported: true,
        soniox_key: saved
          ? { source: "stored", can_save: true }
          : { source: "none", can_save: true },
        xai_key: { source: "environment", can_save: false },
      }))
      .on("PUT", "/v0/voice-provider-keys/{provider}", ({ params }) => {
        expect(params.provider).toBe("soniox");
        saved = true;
        return { source: "stored", can_save: true };
      });
    renderSettings(runtime);

    const addSoniox = await screen.findByRole("button", {
      name: "Add Soniox key",
    });
    expect(
      screen.getByText(/Turns Voice Mode into a live conversation/u),
    ).toHaveTextContent("Set with XAI_API_KEY on the server.");
    expect(screen.getByText("Set by your server")).toBeVisible();
    expect(screen.queryByRole("button", { name: /xAI key/u })).toBeNull();

    fireEvent.click(addSoniox);
    const dialog = await screen.findByRole("dialog", { name: "Soniox key" });
    fireEvent.change(within(dialog).getByLabelText("Soniox API key"), {
      target: { value: "soniox-key" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save key" }));

    expect(await screen.findByText("Soniox key saved")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Soniox key" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Replace Soniox key" }),
    ).toBeVisible();
  });

  it("hides the voice rows where the deployment cannot run voice", async () => {
    const runtime = await testRuntime();
    runtime.server.on(
      "GET",
      "/v0/tenants/{tenantId}/voice-media-policy",
      () => ({ voice_available: false, voice_media_supported: false }),
    );
    renderSettings(runtime);

    expect(await screen.findByText("Composio")).toBeVisible();
    await act(async () => undefined);
    expect(screen.queryByText("Soniox")).toBeNull();
    expect(screen.queryByText("xAI")).toBeNull();
  });

  it("shows an error alert with Retry when Composio key status fails to load", async () => {
    const runtime = await testRuntime();
    let attempts = 0;
    runtime.server.on("GET", "/v0/external-apps", () => {
      attempts += 1;
      if (attempts === 1) {
        return teamHubErrorResponse(503, "SERVICE_UNAVAILABLE");
      }
      return {
        apps: [],
        provider_key: { can_save: true, source: "none" },
      };
    });
    renderSettings(runtime, "/t/tenant-northstar/settings/account");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load Composio key status. Try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("button", { name: "Add key" }),
    ).toBeVisible();
    expect(screen.getByText("Not set")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("links Account settings directly to Settings › Models for BYOK provider keys", async () => {
    const runtime = await testRuntime();
    renderSettings(runtime, "/t/tenant-northstar/settings/account");

    const byokCard = await screen.findByRole("region", {
      name: "Model provider API keys (BYOK)",
    });
    expect(
      within(byokCard).getByRole("link", { name: "Open Models settings" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/settings/models");
  });
});

async function testRuntime() {
  const runtime = createTestTeamHubRuntime();

  return runtime;
}

function renderSettings(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
  initialEntry = "/t/tenant-northstar/settings/account",
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider
          router={createMemoryRouter(
            [
              { element: <p>Signed out</p>, path: "/login" },
              {
                children: [
                  { element: <AccountSettingsPage />, path: "account" },
                  { element: <ShortcutsSettingsPage />, path: "shortcuts" },
                  { element: <p>Language page</p>, path: "language" },
                ],
                element: (
                  <>
                    <SettingsLayout />
                    <LocationProbe />
                    <BackButton />
                  </>
                ),
                path: "/t/:tenantId/settings",
              },
            ],
            { initialEntries: [initialEntry] },
          )}
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );

  return { queryClient, unmount: view.unmount };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  );
}

function BackButton() {
  const navigate = useNavigate();
  return (
    <button onClick={() => void navigate(-1)} type="button">
      Browser back
    </button>
  );
}

function accountProfile(runtime: TestTeamHubRuntime) {
  return teamHubData(
    runtime.client.api.GET("/v0/tenants/{tenantId}/account-profile", {
      params: { path: { tenantId: "tenant-northstar" } },
    }),
  );
}
