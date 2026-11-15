import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  TeamHubMessage,
  TeamHubMessageCreateInput,
} from "@/features/teamhub/teamhub-types";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { IntroduceInRoom } from "./introduce-in-room-control";
import { introductionMessage } from "./introduce-in-room";

const paragraphs = ["This is Jenny.", "Talk to Jenny like this: plainly."];

function renderControl() {
  const runtime = createTestTeamHubRuntime();
  const posts: { body: TeamHubMessageCreateInput; path: string }[] = [];
  runtime.server.on(
    "POST",
    "/v0/rooms/{roomId}/messages",
    ({ body, params }) => {
      posts.push({
        body: body as TeamHubMessageCreateInput,
        path: `/v0/rooms/${params.roomId}/messages`,
      });
      return Response.json(sent(params.roomId!), { status: 201 });
    },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <IntroduceInRoom paragraphs={paragraphs} tenantId="tenant-northstar" />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return posts;
}

function sent(roomId: string): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    created_at: "2026-11-16T03:00:00Z",
    id: "message-introduction",
    message_kind: "conversation",
    raw_message: "",
    room_id: roomId,
    segments: [],
    tenant_id: "tenant-northstar",
  };
}

describe("IntroduceInRoom", () => {
  it("posts the introduction into the chosen room", async () => {
    const posts = renderControl();
    fireEvent.click(
      screen.getByRole("button", { name: "Introduce you in a Room" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "product-v0" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Introduced in product-v0.",
      ),
    );
    expect(posts).toEqual([
      {
        body: expect.objectContaining({
          raw_message: introductionMessage(paragraphs),
        }),
        path: "/v0/rooms/room-product-v0/messages",
      },
    ]);
  });
});
