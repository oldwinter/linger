import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, it, expect, vi, type Mock } from "vitest";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { SharedRoomHistoryPage } from "./shared-room-history-page";
let runtime: TestTeamHubRuntime;
// The fixtures carry only the fields the page reads.
let read: Mock<(...args: unknown[]) => Promise<unknown>>;
beforeEach(() => {
  runtime = createTestTeamHubRuntime();
  read = vi.spyOn(runtime.client.roomHistory, "read") as unknown as typeof read;
});
const token = `room_share_${"a".repeat(43)}`;
const message = {
  id: "message_1",
  position: 1,
  author: {
    id: "actor_1",
    tenant_id: "tenant_1",
    kind: "human",
    display_name: "Alice",
  },
  body: "**Snapshot** [Document](/t/tenant_1/documents/secret) [Website](https://example.com)",
  segments: [],
  created_at: "2026-09-21T00:00:00Z",
  attachments: [
    {
      id: "file_1",
      filename: "Private file.pdf",
      media_type: "application/pdf",
      size_bytes: 100,
    },
  ],
  card: { title: "Approval", description: "Details", status: "pending" },
};
function open() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={[`/shared-room-history#${token}`]}>
          <SharedRoomHistoryPage />
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}
describe("shared Room history", () => {
  it("renders frozen Markdown and attachments without Room actions or internal links, and pages history", async () => {
    read
      .mockResolvedValueOnce({
        share: {
          room_name: "Snapshot Room",
          message_count: 2,
          created_at: message.created_at,
        },
        items: [message],
        next_after: 1,
      })
      .mockResolvedValueOnce({
        share: {
          room_name: "Snapshot Room",
          message_count: 2,
          created_at: message.created_at,
        },
        items: [
          {
            ...message,
            id: "message_2",
            body: "Later in snapshot",
            attachments: [],
            card: undefined,
          },
        ],
        next_after: 0,
      });
    open();
    expect(await screen.findByText("Snapshot")).toHaveProperty(
      "tagName",
      "STRONG",
    );
    expect(screen.queryByRole("link", { name: "Document" })).toBeNull();
    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute(
      "rel",
      "noreferrer",
    );
    expect(screen.getByText("Private file.pdf")).toBeVisible();
    expect(screen.getByText("pending")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /approve|send|discuss/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more messages" }));
    expect(await screen.findByText("Later in snapshot")).toBeVisible();
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(token, 1, expect.any(AbortSignal)),
    );
  });
  it("shows a friendly unavailable state without revealing private errors", async () => {
    read.mockRejectedValue(new Error("secret database error"));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "unavailable or has been revoked",
    );
    expect(screen.queryByText("secret database error")).toBeNull();
  });

  it("watches the snapshot from the first message and can stop", async () => {
    read.mockResolvedValueOnce({
      share: {
        room_name: "Snapshot Room",
        message_count: 2,
        created_at: message.created_at,
      },
      items: [
        message,
        {
          ...message,
          id: "message_2",
          author: { ...message.author, display_name: "Blake" },
          body: "Later in snapshot",
          created_at: "2026-09-21T00:04:00Z",
          attachments: [],
          card: undefined,
        },
      ],
      next_after: 0,
    });
    open();
    fireEvent.click(
      await screen.findByRole("button", { name: "Watch it happen" }),
    );
    expect(
      screen.getByRole("article", { current: "step" }),
    ).toHaveAccessibleName("Message from Alice");
    expect(screen.getByRole("status")).toHaveTextContent("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    expect(screen.queryByRole("article", { current: "step" })).toBeNull();
  });
});
