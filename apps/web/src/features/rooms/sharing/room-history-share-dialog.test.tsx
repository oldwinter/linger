import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineGlobalProperty } from "@/test/global-properties";

import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import { RoomHistoryShareDialog } from "./room-history-share-dialog";

const share = {
  id: "share_1",
  room_name: "Room",
  created_at: "2026-09-22T06:30:03.000Z",
  message_count: 2,
  snapshot_room_seq: 4,
};

const secondShare = {
  id: "share_2",
  room_name: "Room",
  created_at: "2026-09-23T08:15:00.000Z",
  message_count: 5,
  snapshot_room_seq: 9,
};

function renderDialog(roomHistory: Partial<TeamHubClient["roomHistory"]>) {
  const client = {
    roomHistory: {
      list: vi.fn().mockResolvedValue({ items: [share] }),
      create: vi.fn(),
      link: vi.fn(),
      revoke: vi.fn(),
      ...roomHistory,
    },
  } as unknown as TeamHubClient;
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={{ client } as never}>
        <RoomHistoryShareDialog onClose={vi.fn()} roomId="room_1" />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("Room history share dialog", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));
    defineGlobalProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the created token when opening its own snapshot", async () => {
    // TeamHub stores one token per snapshot, so issuing another would silently
    // invalidate the link the author has already copied.
    const client = renderDialog({
      create: vi
        .fn()
        .mockResolvedValue({ ...share, token: "room_share_first" }),
    });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    const conversationLink = await screen.findByLabelText(
      "Copy conversation link",
    );
    expect(conversationLink).toBeVisible();

    fireEvent.click(
      await screen.findByRole("button", { name: /Open shared link/ }),
    );
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining("room_share_first"),
        "_blank",
        "noopener,noreferrer",
      ),
    );
    expect(client.roomHistory.link).not.toHaveBeenCalled();
  });

  it("issues a link only for a snapshot this session has no token for", async () => {
    const client = renderDialog({
      link: vi.fn().mockResolvedValue({ ...share, token: "room_share_issued" }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Open shared link/ }),
    );
    await waitFor(() =>
      expect(client.roomHistory.link).toHaveBeenCalledWith("room_1", "share_1"),
    );
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining("room_share_issued"),
        "_blank",
        "noopener,noreferrer",
      ),
    );
  });

  it("does not show the raw shared address in a snapshot row", async () => {
    renderDialog({
      link: vi.fn().mockResolvedValue({ ...share, token: "room_share_issued" }),
    });
    await screen.findByRole("button", { name: /Open shared link/ });
    expect(
      screen.queryByDisplayValue(/shared-room-history/),
    ).not.toBeInTheDocument();
  });

  it("requires confirmation before revoking, styles Revoke as danger, and shows a per-row loading spinner", async () => {
    let resolveRevoke!: () => void;
    const revoke = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        }),
    );
    renderDialog({
      list: vi.fn().mockResolvedValue({ items: [share, secondShare] }),
      revoke,
    });

    const revokeButtons = await screen.findAllByRole("button", {
      name: "Revoke",
    });
    expect(revokeButtons).toHaveLength(2);
    expect(revokeButtons[0]).toHaveClass("text-destructive");

    // Clicking Revoke asks for confirmation rather than revoking immediately.
    fireEvent.click(revokeButtons[0]!);
    expect(revoke).not.toHaveBeenCalled();
    expect(
      screen.getByText("Revoking permanently disables this shared link."),
    ).toBeVisible();

    // Cancel aborts confirmation cleanly.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByText("Revoking permanently disables this shared link."),
    ).not.toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();

    // Confirming calls revoke and puts only the target row into loading state.
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
    const confirmButton = screen.getByRole("button", {
      name: "Confirm revoke",
    });
    expect(confirmButton).toHaveClass("text-destructive");
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith("room_1", "share_1"),
    );
    const rows = screen.getAllByRole("listitem");
    expect(
      within(rows[0]!).getByRole("button", { name: "Confirm revoke" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      within(rows[1]!).getByRole("button", { name: "Revoke" }),
    ).not.toHaveAttribute("aria-busy");

    await act(async () => {
      resolveRevoke();
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Revoking permanently disables this shared link."),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows a Retry action when loading shared snapshots fails", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ items: [share] });
    renderDialog({ list });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Shared snapshots could not be loaded.");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("button", { name: /Open shared link/ }),
    ).toBeVisible();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("uses shared writeClipboardText fallback and shows Copied status feedback", async () => {
    defineGlobalProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("Clipboard denied")),
      },
    });
    const execCommand = vi.fn(() => true);
    defineGlobalProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    renderDialog({
      create: vi
        .fn()
        .mockResolvedValue({ ...share, token: "room_share_fallback" }),
    });

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Copied"),
    );
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
