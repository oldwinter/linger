import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMemoryEntry,
  TeamHubMessage,
  TeamHubMessageCreateInput,
  TeamHubRoomListItem,
} from "@/features/teamhub/teamhub-types";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { WikiGraphDailyPanel } from "./wiki-graph-daily-panel";

const day = "2026-09-01";
const reportContent = [
  "---",
  'description: "Shipped the release."',
  "---",
  "",
  "# Daily 2026-09-01",
  "",
  "## Daily Work",
  "",
  "- Finalized the **release** scope [[source:s1]].",
  "",
  "## Sources",
  "",
  "- [Session](../daily/session-a.md)",
].join("\n");
const sharedText = [
  "# Daily report for 2026-09-01",
  "",
  "## Daily Work",
  "",
  "- Finalized the release scope.",
].join("\n");

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("WikiGraphDailyPanel report sharing", () => {
  it("copies the report as Markdown without frontmatter, markers, or sources", async () => {
    const runtime = serveReport();
    const writeText = stubClipboard(() => Promise.resolve());
    renderPanel(runtime);

    fireEvent.click(await screen.findByRole("button", { name: "Copy report" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sharedText));
    expect(await screen.findByText("Copied")).toBeVisible();
  });

  it("says when the clipboard refuses instead of claiming success", async () => {
    const runtime = serveReport();
    stubClipboard(() => Promise.reject(new Error("Not allowed")));
    renderPanel(runtime);

    fireEvent.click(await screen.findByRole("button", { name: "Copy report" }));

    expect(
      await screen.findByText(
        "Copy failed. Select the report text and copy it yourself.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("sends the report to the chosen Room and links to the message", async () => {
    const runtime = serveReport();
    const roomList = mockRoomList(runtime);
    const posts: {
      body: TeamHubMessageCreateInput;
      idempotencyKey: string | null;
    }[] = [];
    runtime.server.on(
      "POST",
      "/v0/rooms/{roomId}/messages",
      ({ body, params, request }) => {
        posts.push({
          body: body as TeamHubMessageCreateInput,
          idempotencyKey: request.headers.get("Idempotency-Key"),
        });
        return Response.json(sentMessage(params.roomId!, posts.length), {
          status: 201,
        });
      },
    );
    renderPanel(runtime);

    fireEvent.click(
      await screen.findByRole("button", { name: "Send to Room" }),
    );
    expect(await screen.findByRole("menuitem", { name: "all" })).toBeVisible();
    expect(roomList).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.raw_message).toBe(sharedText);
    expect(posts[0]!.idempotencyKey).toBe(
      "report-share:report-2026-09-01:2026-09-01T06:00:00Z:room-product-v0",
    );
    expect(screen.getByRole("link", { name: "Open message" })).toHaveAttribute(
      "href",
      "/t/tenant-northstar/rooms/room-product-v0/chat?message=message-report-1",
    );
  });

  it("shows a refused post in plain words", async () => {
    const runtime = serveReport();
    mockRoomList(runtime);
    runtime.server.on("POST", "/v0/rooms/{roomId}/messages", () =>
      teamHubErrorResponse(
        403,
        "FORBIDDEN",
        "You are not allowed to post in this Room.",
      ),
    );
    renderPanel(runtime);

    fireEvent.click(
      await screen.findByRole("button", { name: "Send to Room" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "all" }));

    expect(
      await screen.findByText("You are not allowed to post in this Room."),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open message" })).toBeNull();
  });
});

function serveReport() {
  const runtime = createTestTeamHubRuntime();
  const report: TeamHubMemoryEntry = {
    content: reportContent,
    date: day,
    id: "report-2026-09-01",
    kind: "daily",
    path: "timeline/daily/2026-09-01.md",
    summary: "",
    title: "Daily 2026-09-01",
    updated_at: "2026-09-01T06:00:00Z",
  };
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => ({
    items: [{ ...report, content: "" }],
  }));
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory/{entryId}", () =>
    Response.json(report),
  );
  return runtime;
}

function mockRoomList(runtime: TestTeamHubRuntime) {
  const handler = vi.fn(() => ({
    items: [room("room-all", "all"), room("room-product-v0", "product-v0")],
    page: { has_more: false },
  }));
  runtime.server.on("GET", "/v0/tenants/{tenantId}/rooms", handler);
  return handler;
}

function room(id: string, name: string): TeamHubRoomListItem {
  return {
    created_at: "2026-07-23T08:00:00Z",
    created_by: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    description: "",
    id,
    kind: "room",
    latest_room_seq: 0,
    name,
    read_through_room_seq: 0,
    tenant_id: "tenant-northstar",
    unread_mention_count: 0,
    unread_message_count: 0,
    updated_at: "2026-07-23T08:00:00Z",
  };
}

function sentMessage(roomId: string, index: number): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    created_at: "2026-09-01T06:00:00Z",
    id: `message-report-${index}`,
    message_kind: "conversation",
    raw_message: sharedText,
    room_id: roomId,
    segments: [],
    tenant_id: "tenant-northstar",
  };
}

function stubClipboard(writeText: () => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: spy },
  });
  return spy;
}

function renderPanel(runtime: TestTeamHubRuntime) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter
          initialEntries={["/t/tenant-northstar/library/wiki/graph"]}
        >
          <WikiGraphDailyPanel
            day={day}
            onClose={() => undefined}
            tenantId="tenant-northstar"
          />
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}
