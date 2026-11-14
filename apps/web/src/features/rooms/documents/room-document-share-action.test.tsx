import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubDocument,
  TeamHubMessage,
  TeamHubMessageCreateInput,
} from "@/features/teamhub/teamhub-types";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";

import { RoomDocumentShareAction } from "./room-document-share-action";

const MESSAGES_PATH = "/v0/rooms/{roomId}/messages";
const EXPECTED_BODY = [
  "# Product brief",
  `${window.location.origin}/t/tenant-northstar/documents/document-brief`,
].join("\n\n");

describe("Send a Document to a Room", () => {
  it("sends the Document's title and link to the chosen Room", async () => {
    const runtime = await testRuntime();
    const posts = capturePosts(runtime);
    renderAction(runtime);

    fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "product-v0" }),
    );

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/v0/rooms/room-product-v0/messages");
    expect(posts[0]!.body.raw_message).toBe(EXPECTED_BODY);
    expect(posts[0]!.idempotencyKey).toBe(
      "document-share:document-brief:2026-07-23T08:00:00Z:room-product-v0",
    );
  });

  it("keeps the picker open on a refusal and reuses the key when retried", async () => {
    const runtime = await testRuntime();
    const keys = refuseFirstPost(runtime);
    renderAction(runtime);

    fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "product-v0" }),
    );

    expect(
      await screen.findByText("You are not allowed to post in this Room."),
    ).toBeVisible();
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(
      "document-share:document-brief:2026-07-23T08:00:00Z:room-product-v0",
    );
  });

  it("gives another Room its own idempotency key", async () => {
    const runtime = await testRuntime();
    const keys = refuseFirstPost(runtime);
    renderAction(runtime);

    fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "all" }));
    expect(
      await screen.findByText("You are not allowed to post in this Room."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(
      "document-share:document-brief:2026-07-23T08:00:00Z:room-product-v0",
    );
  });

  it("disables the Room choices while the message is being sent", async () => {
    const runtime = await testRuntime();
    let answer: ((response: Response) => void) | undefined;
    runtime.server.on(
      "POST",
      MESSAGES_PATH,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    renderAction(runtime);

    fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "product-v0" }),
    );

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
});

async function testRuntime() {
  return createTestTeamHubRuntime();
}

function renderAction(runtime: TestTeamHubRuntime) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RoomDocumentShareAction
          document={document()}
          tenantId="tenant-northstar"
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function document(): TeamHubDocument {
  return {
    can_edit_native_content: true,
    capabilities: {
      comment: true,
      delete: true,
      duplicate: true,
      export: true,
      manage: true,
      read: true,
      use_as_context: true,
      write: true,
    },
    created_at: "2026-07-23T08:00:00Z",
    creator: actor(),
    current_version: null,
    draft_capability: "write",
    format: "blocknote",
    from: [],
    id: "document-brief",
    owner: actor(),
    representation_format: "markdown",
    status: "active",
    tenant_id: "tenant-northstar",
    title: "Product brief.md",
    updated_at: "2026-07-23T08:00:00Z",
  };
}

function actor(): TeamHubDocument["owner"] {
  return {
    display_name: "Jenny Bin",
    id: "actor-jenny",
    kind: "human",
    tenant_id: "tenant-northstar",
  };
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
    author: actor(),
    created_at: "2026-07-23T12:00:00Z",
    id: "message-document-1",
    message_kind: "conversation",
    raw_message: "",
    room_id: roomId,
    segments: [],
    tenant_id: "tenant-northstar",
  };
}
