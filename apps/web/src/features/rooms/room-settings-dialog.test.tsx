import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptRoomUpdates,
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import type { TestRouteHandler } from "@/test/teamhub-test-server";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { writeClipboardText } from "@/lib/clipboard";

import { roomQueryKey } from "./room-queries";
import { RoomSettingsDialog } from "./room-settings-dialog";

vi.mock("@/lib/clipboard", () => ({ writeClipboardText: vi.fn() }));

const copy = vi.mocked(writeClipboardText);

describe("Room settings", () => {
  beforeEach(() => {
    copy.mockReset();
    copy.mockResolvedValue(undefined);
  });

  it("opens deletion through a separate owner-controlled action", async () => {
    const runtime = createTestTeamHubRuntime();
    acceptRoomUpdates(runtime);

    const room = await getRoom(runtime, "room-all");
    const onDelete = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            onClose={vi.fn()}
            onDelete={onDelete}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Room" }));

    expect(onDelete).toHaveBeenCalledOnce();
    expect(
      screen.getByText("Deleting this Room revokes access for every member."),
    ).toBeVisible();
  });

  it("keeps Save disabled until something changes and shows progress while saving", async () => {
    const runtime = createTestTeamHubRuntime();
    acceptRoomUpdates(runtime);

    const room = await getRoom(runtime, "room-all");
    let release = () => {};
    runtime.server.on(
      "PATCH",
      "/v0/rooms/{roomId}",
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ...room, name: "Renamed" });
        }),
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            embedded
            onClose={vi.fn()}
            onDelete={vi.fn()}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: "Renamed" },
    });
    expect(save).toBeEnabled();

    // Editing back to the stored value leaves nothing to commit.
    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: room.name },
    });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveAttribute("aria-busy", "true");
    release();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeInTheDocument(),
    );
  });

  it("updates Room metadata through TeamHub and closes after success", async () => {
    const runtime = createTestTeamHubRuntime();
    acceptRoomUpdates(runtime);

    const room = await getRoom(runtime, "room-all");
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            onClose={onClose}
            onDelete={vi.fn()}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: "team-updates" },
    });
    fireEvent.change(screen.getByLabelText("Room description"), {
      target: { value: "Human and Agent release updates." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await expect(getRoom(runtime, "room-all")).resolves.toMatchObject({
      description: "Human and Agent release updates.",
      name: "team-updates",
    });
  });

  it("retries the same update after an unknown outcome", async () => {
    const runtime = createTestTeamHubRuntime();
    acceptRoomUpdates(runtime);

    const room = await getRoom(runtime, "room-all");
    const updateRoom = vi.fn<TestRouteHandler>(() => {
      throw new Error("Connection closed before confirmation.");
    });
    runtime.server.on("PATCH", "/v0/rooms/{roomId}", updateRoom);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            onClose={vi.fn()}
            onDelete={vi.fn()}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: "release-room" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(
      /did not confirm whether these Room changes were committed/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateRoom).toHaveBeenCalledTimes(2));
    expect(updateRoom.mock.calls[1]![0].params).toEqual(
      updateRoom.mock.calls[0]![0].params,
    );
    expect(updateRoom.mock.calls[1]![0].body).toEqual(
      updateRoom.mock.calls[0]![0].body,
    );
  });

  it("rejects an update response outside the selected Room scope", async () => {
    const runtime = createTestTeamHubRuntime();
    acceptRoomUpdates(runtime);

    const room = await getRoom(runtime, "room-all");
    const queryClient = new QueryClient();
    const onClose = vi.fn();
    queryClient.setQueryData(roomQueryKey("tenant-northstar", room.id), room);
    runtime.server.on("PATCH", "/v0/rooms/{roomId}", () => ({
      ...room,
      name: "Injected Room",
      tenant_id: "tenant-other",
    }));

    render(
      <QueryClientProvider client={queryClient}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            onClose={onClose}
            onDelete={vi.fn()}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: "Expected Room" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(roomQueryKey("tenant-northstar", room.id)),
    ).toEqual(room);
  });

  it("shows the Room's ID and copies exactly it", async () => {
    const runtime = createTestTeamHubRuntime();
    const room = await getRoom(runtime, "room-all");

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            onClose={vi.fn()}
            onDelete={vi.fn()}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Room ID")).toBeVisible();
    expect(screen.getByText(room.id)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Copy Room ID" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(copy).toHaveBeenCalledWith(room.id);
  });

  it("reports a refused clipboard write instead of Copied", async () => {
    copy.mockRejectedValue(new Error("Clipboard is unavailable"));
    const runtime = createTestTeamHubRuntime();
    const room = await getRoom(runtime, "room-all");

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            onClose={vi.fn()}
            onDelete={vi.fn()}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Room ID" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("leaves the form untouched when the ID is copied", async () => {
    const runtime = createTestTeamHubRuntime();
    acceptRoomUpdates(runtime);
    const room = await getRoom(runtime, "room-all");
    const updateRoom = vi.fn<TestRouteHandler>(() => ({
      ...room,
      name: "Renamed",
    }));
    runtime.server.on("PATCH", "/v0/rooms/{roomId}", updateRoom);
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <RoomSettingsDialog
            embedded
            onClose={onClose}
            onDelete={vi.fn()}
            room={room}
            tenantId="tenant-northstar"
          />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy Room ID" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(screen.getByLabelText("Room name")).toHaveValue("Renamed");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(updateRoom).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

function getRoom(runtime: TestTeamHubRuntime, roomId: string) {
  return teamHubData(
    runtime.client.api.GET("/v0/rooms/{roomId}", {
      params: { path: { roomId } },
    }),
  );
}
