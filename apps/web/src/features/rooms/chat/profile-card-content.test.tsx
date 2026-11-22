import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as renderUi, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MemoryRouter } from "react-router";
import { MessageCard } from "./message-card";
import { anotherMeQueryKey } from "@/features/rooms/room-queries";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";

import { profilePreview, useProfileCardContent } from "./profile-card-content";

const emptyModule = { overview: "", points: [] };
function profileDocument(backgroundOverview: string) {
  return {
    name: "Jenny",
    background: { overview: backgroundOverview, points: [], timeline: [] },
    communication_style: emptyModule,
    working_style: emptyModule,
    preferences: emptyModule,
    writing_style: emptyModule,
  };
}

let runtime: TestTeamHubRuntime;
// The fixtures carry only the fields the card reads.
let getPersonalProfile: Mock<(...args: unknown[]) => Promise<unknown>>;
let listExternalApps: Mock<(...args: unknown[]) => Promise<unknown>>;
beforeEach(() => {
  runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/another-me", () => ({
    room_id: "room-1",
    agent_actor_id: "agent-1",
  }));
  getPersonalProfile = vi.spyOn(
    runtime.client,
    "getPersonalProfile",
  ) as unknown as typeof getPersonalProfile;
  listExternalApps = vi.spyOn(runtime.client, "listExternalApps");
});

const render = (ui: ReactElement) =>
  renderUi(ui, {
    wrapper: ({ children }) => (
      <TeamHubRuntimeProvider runtime={runtime}>
        {children}
      </TeamHubRuntimeProvider>
    ),
  });

function CardDetails({ roomId = "room-1" }: { roomId?: string }) {
  const content = useProfileCardContent({
    children: "Original summary",
    tenantId: "tenant-1",
    roomId,
    authorId: "agent-1",
  });
  return (
    <div>
      {content.body}
      {content.sources}
    </div>
  );
}

function renderDetails() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CardDetails />
    </QueryClientProvider>,
  );
}

describe("Profile card content", () => {
  it.each([
    ["room-1", "agent-1", true],
    ["shared-room", "agent-1", false],
    ["room-1", "other-agent", false],
  ])(
    "only enhances the owner's delivery in room %s by %s",
    async (roomId, authorId, enhanced) => {
      getPersonalProfile.mockClear().mockResolvedValue({ current: null });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <MessageCard
              title="Jenny"
              files={[]}
              profile={{
                actorId: "human-1",
                wikiPath: "/wiki",
                tenantId: "tenant-1",
                roomId,
                authorId,
                subtitle: "Role",
              }}
              profileChildren={<p>Enhanced summary</p>}
            >
              <p>Role — Original summary</p>
            </MessageCard>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      if (enhanced) {
        expect(
          await screen.findByRole("link", { name: "Open" }),
        ).toHaveAttribute("href", "/wiki");
        expect(screen.getByText("Role")).toBeVisible();
        expect(screen.getByText("Enhanced summary")).toBeVisible();
      } else {
        await vi.waitFor(() =>
          expect(
            client.getQueryState(anotherMeQueryKey("tenant-1"))?.status,
          ).toBe("success"),
        );
        expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
        expect(screen.queryByRole("img", { name: "Jenny avatar" })).toBeNull();
        expect(getPersonalProfile).not.toHaveBeenCalled();
        expect(screen.getByText("Role — Original summary")).toBeVisible();
        expect(screen.queryByText("Enhanced summary")).toBeNull();
      }
    },
  );

  it("takes the first long enough overview, then point text, from the fields", () => {
    const detailed =
      "This is a sufficiently detailed profile paragraph about a person's work.";
    expect(
      profilePreview({
        ...profileDocument(detailed),
        preferences: {
          overview: "Other long enough details that come later.",
          points: [],
        },
      }),
    ).toBe(detailed);
    expect(
      profilePreview({
        ...profileDocument("Short note"),
        writing_style: {
          overview: "Writes in a deliberately compact, plain style.",
          points: [],
        },
      }),
    ).toBe("Writes in a deliberately compact, plain style.");
    const nonAscii = "\u9879\u76ee".repeat(25);
    expect(
      profilePreview({
        ...profileDocument(""),
        working_style: {
          overview: "",
          points: [{ title: "Focus", text: nonAscii, items: [] }],
        },
      }),
    ).toBe(nonAscii);
    expect(profilePreview(profileDocument("x".repeat(300)))).toBe(
      `${"x".repeat(280)}…`,
    );
    expect(profilePreview(profileDocument("Short note"))).toBeUndefined();
  });

  it("shows the published excerpt", async () => {
    getPersonalProfile.mockResolvedValue({
      current: {
        profile: profileDocument(
          "A sufficiently detailed paragraph drawn directly from the published profile.",
        ),
      },
    });
    renderDetails();
    expect(
      await screen.findByText(/drawn directly from the published profile/),
    ).toBeVisible();
  });

  it("shows all recorded apps and excludes other available apps without reading the summary", async () => {
    getPersonalProfile.mockResolvedValue({
      current: {
        profile: profileDocument(
          "A sufficiently detailed description of the subject's work.",
        ),
        source_apps: ["gmail", "github"],
      },
    });
    listExternalApps.mockResolvedValue({
      apps: [
        { key: "gmail", display_name: "Gmail" },
        { key: "github", display_name: "GitHub" },
        { key: "outlook", display_name: "Outlook" },
      ],
    });
    renderDetails();
    expect(
      await screen.findByRole("img", { name: "Gmail icon" }),
    ).toBeVisible();
    expect(screen.getByRole("img", { name: "GitHub icon" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Outlook icon" })).toBeNull();
  });

  it("keeps the original summary if the Profile is unavailable", async () => {
    getPersonalProfile.mockRejectedValue(new Error("unavailable"));
    renderDetails();
    expect(await screen.findByText("Original summary")).toBeVisible();
    expect(screen.queryByRole("list", { name: /Profile sources/ })).toBeNull();
  });

  it("does not infer sources for a Profile whose source record is unknown", async () => {
    listExternalApps.mockClear();
    getPersonalProfile.mockResolvedValue({
      current: {
        profile: profileDocument(
          "A long enough description mentioning Gmail but with no source record.",
        ),
      },
    });
    renderDetails();
    expect(await screen.findByText(/mentioning Gmail/)).toBeVisible();
    expect(screen.queryByRole("list", { name: "Profile sources" })).toBeNull();
    expect(listExternalApps).not.toHaveBeenCalled();
  });

  it("does not show cached personal Profile data in a different room", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["teamhub", "personal-profile", "tenant-1"], {
      current: {
        profile: profileDocument(
          "Private profile content that must not appear in another room.",
        ),
      },
    });
    render(
      <QueryClientProvider client={client}>
        <CardDetails roomId="shared-room" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Original summary")).toBeVisible();
    expect(screen.queryByText(/Private profile content/)).toBeNull();
  });
});
