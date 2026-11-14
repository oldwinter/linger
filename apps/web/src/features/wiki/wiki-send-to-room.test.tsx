// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  TeamHubArtifactContent,
  TeamHubMessage,
  TeamHubMessageCreateInput,
} from "@/features/teamhub/teamhub-types";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { WikiSendToRoom } from "./wiki-send-to-room";

const MESSAGES_PATH = "/v0/rooms/{roomId}/messages";
const updatedAt = "2026-11-15T09:00:00Z";
const markdown = "# Casey example\n\nThe page opens here.";
const expectedText = [
  "# Casey example",
  "Casey example The page opens here.",
  `${window.location.origin}/t/tenant-northstar/documents/document-wiki`,
].join("\n\n");

function content(text: string): TeamHubArtifactContent {
  return {
    blob: new Blob([text]),
    mediaType: "text/markdown",
    sha256: "0".repeat(64),
  };
}

function renderSend(runtime: TestTeamHubRuntime) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <WikiSendToRoom
          documentId="document-wiki"
          tenantId="tenant-northstar"
          title="Casey example"
          updatedAt={updatedAt}
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function capturePosts(runtime: TestTeamHubRuntime) {
  const posts: {
    body: TeamHubMessageCreateInput;
    idempotencyKey: string | null;
    path: string;
  }[] = [];
  runtime.server.on("POST", MESSAGES_PATH, ({ body, params, request }) => {
    posts.push({
      body: body as TeamHubMessageCreateInput,
      idempotencyKey: request.headers.get("Idempotency-Key"),
      path: new URL(request.url).pathname,
    });
    return Response.json(sentMessage(params.roomId!), { status: 201 });
  });
  return posts;
}

/** Refuses the first post, so a retry and a second Room can be compared. */
function refuseFirstPost(runtime: TestTeamHubRuntime) {
  const keys: (string | null)[] = [];
  runtime.server.on("POST", MESSAGES_PATH, ({ params, request }) => {
    keys.push(request.headers.get("Idempotency-Key"));
    return keys.length === 1
      ? teamHubErrorResponse(
          403,
          "FORBIDDEN",
          "You are not allowed to post in this Room.",
        )
      : Response.json(sentMessage(params.roomId!), { status: 201 });
  });
  return keys;
}

function sentMessage(roomId: string): TeamHubMessage {
  return {
    attachments: [],
    author: {
      display_name: "Jenny Bin",
      id: "actor-jenny",
      kind: "human",
      tenant_id: "tenant-northstar",
    },
    created_at: "2026-11-15T12:00:00Z",
    id: "message-wiki-page-1",
    message_kind: "conversation",
    raw_message: "",
    room_id: roomId,
    segments: [],
    tenant_id: "tenant-northstar",
  };
}

async function chooseRoom(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

describe("WikiSendToRoom", () => {
  it("sends the page's title, excerpt, and link to the chosen Room", async () => {
    const runtime = createTestTeamHubRuntime();
    const download = vi
      .spyOn(runtime.client, "downloadLatestDocument")
      .mockResolvedValue(content(markdown));
    const posts = capturePosts(runtime);
    renderSend(runtime);

    expect(download).not.toHaveBeenCalled();

    await chooseRoom("product-v0");

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/v0/rooms/room-product-v0/messages");
    expect(posts[0]!.body.raw_message).toBe(expectedText);
    expect(posts[0]!.idempotencyKey).toBe(
      `wiki-page-share:document-wiki:${updatedAt}:room-product-v0`,
    );
    expect(download).toHaveBeenCalledWith("document-wiki");
  });

  it("keeps the picker open on a refusal and reuses the key when retried", async () => {
    const runtime = createTestTeamHubRuntime();
    vi.spyOn(runtime.client, "downloadLatestDocument").mockResolvedValue(
      content(markdown),
    );
    const keys = refuseFirstPost(runtime);
    renderSend(runtime);

    await chooseRoom("product-v0");
    expect(
      await screen.findByText("You are not allowed to post in this Room."),
    ).toBeVisible();
    expect(screen.getByRole("menu")).toBeVisible();

    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(
      `wiki-page-share:document-wiki:${updatedAt}:room-product-v0`,
    );
  });

  it("gives another Room its own idempotency key", async () => {
    const runtime = createTestTeamHubRuntime();
    vi.spyOn(runtime.client, "downloadLatestDocument").mockResolvedValue(
      content(markdown),
    );
    const keys = refuseFirstPost(runtime);
    renderSend(runtime);

    await chooseRoom("all");
    expect(
      await screen.findByText("You are not allowed to post in this Room."),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(
      `wiki-page-share:document-wiki:${updatedAt}:room-product-v0`,
    );
  });

  it("disables the Room choices while the Message is in flight", async () => {
    const runtime = createTestTeamHubRuntime();
    vi.spyOn(runtime.client, "downloadLatestDocument").mockResolvedValue(
      content(markdown),
    );
    let answer: ((response: Response) => void) | undefined;
    runtime.server.on(
      "POST",
      MESSAGES_PATH,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    renderSend(runtime);

    await chooseRoom("product-v0");

    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "product-v0" }),
      ).toBeDisabled(),
    );
    act(() =>
      answer!(Response.json(sentMessage("room-product-v0"), { status: 201 })),
    );
    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
  });

  it("reports a page whose content cannot be obtained and posts nothing", async () => {
    const runtime = createTestTeamHubRuntime();
    vi.spyOn(runtime.client, "downloadLatestDocument").mockRejectedValueOnce(
      new Error("The page could not be read."),
    );
    const posts = capturePosts(runtime);
    renderSend(runtime);

    await chooseRoom("product-v0");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not send",
    );
    expect(posts).toHaveLength(0);
  });
});
