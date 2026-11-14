import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "@/lib/clipboard";
import { createHttpTeamHubClient } from "@/features/teamhub/teamhub-client";
import {
  TeamHubRuntimeProvider,
  type TeamHubRuntime,
} from "@/features/teamhub/teamhub-runtime";
import { TeamHubTestServer } from "@/test/teamhub-test-server";

import { AgentRowMenu, RoomHeaderMenu } from "./room-nav-actions";

vi.mock("@/lib/clipboard", () => ({ writeClipboardText: vi.fn() }));

const copy = vi.mocked(writeClipboardText);

describe("Copy Room link", () => {
  beforeEach(() => {
    copy.mockReset();
    copy.mockResolvedValue(undefined);
  });

  it("copies a Room's chat URL from its row menu", async () => {
    renderAgentRowMenu("room-direct");

    await openCopyRoomLink("Codex");

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(copy).toHaveBeenCalledWith("/t/tenant-a/rooms/room-direct/chat");
  });

  it("copies the same Room URL from the Room header menu", async () => {
    render(
      <RoomHeaderMenu name="Launch" roomId="room-direct" tenantId="tenant-a" />,
    );

    await openCopyRoomLink("Launch");

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(copy).toHaveBeenCalledWith("/t/tenant-a/rooms/room-direct/chat");
  });

  it("copies a thread Room's own URL", async () => {
    render(
      <RoomHeaderMenu
        name="Launch Thread"
        roomId="room-thread-7"
        tenantId="tenant-a"
      />,
    );

    await openCopyRoomLink("Launch Thread");

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(copy).toHaveBeenCalledWith("/t/tenant-a/rooms/room-thread-7/chat");
  });

  it("reports a refused clipboard write instead of Copied", async () => {
    copy.mockRejectedValue(new Error("Clipboard is unavailable"));
    render(
      <RoomHeaderMenu name="Launch" roomId="room-direct" tenantId="tenant-a" />,
    );

    await openCopyRoomLink("Launch");

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("reports a refused clipboard write from the row menu too", async () => {
    copy.mockRejectedValue(new Error("Clipboard is unavailable"));
    renderAgentRowMenu("room-direct");

    await openCopyRoomLink("Codex");

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByText("Copied")).toBeNull();
  });
});

function renderAgentRowMenu(roomId: string) {
  const server = new TeamHubTestServer().allowUnhandledRoutes();
  const runtime = {
    client: createHttpTeamHubClient({
      fetchRequest: server.fetch,
      onAuthenticationRequired: () => undefined,
    }),
    events: {},
    runStatuses: {},
  } as unknown as TeamHubRuntime;
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <AgentRowMenu
          agentId={undefined}
          name="Codex"
          onTogglePin={() => undefined}
          pinned={false}
          roomId={roomId}
          tenantId="tenant-a"
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

async function openCopyRoomLink(name: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `More actions for ${name}` }),
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Copy Room link" }),
  );
}
