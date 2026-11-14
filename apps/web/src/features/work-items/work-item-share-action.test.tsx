import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMessage,
  TeamHubMessageCreateInput,
  TeamHubWorkItem,
} from "@/features/teamhub/teamhub-types";

import { WorkItemsPage } from "./work-items-page";

const MESSAGES_PATH = "/v0/rooms/{roomId}/messages";
const EXPECTED_MARKDOWN = [
  "# Fix login failure",
  "Open · High · Assigned to Codex",
  "Email login returns 500.",
  `${window.location.origin}/t/tenant-northstar/dashboard/workitem-login`,
].join("\n\n");

describe("Send a Work Item to a Room", () => {
  it("sends the Item's Markdown to the chosen Room", async () => {
    const runtime = await testRuntime();
    seedWorkItems(runtime, [itemWithAssignee(runtime)]);
    const posts = capturePosts(runtime);
    renderPage(runtime);

    const dialog = await openPeek();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send to Room" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "product-v0" }),
    );

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/v0/rooms/room-product-v0/messages");
    expect(posts[0]!.body.raw_message).toBe(EXPECTED_MARKDOWN);
    expect(posts[0]!.idempotencyKey).toBe(
      "work-item-share:workitem-login:1:room-product-v0",
    );
  });

  it("keeps the picker open on a refusal and reuses the key when retried", async () => {
    const runtime = await testRuntime();
    seedWorkItems(runtime, [itemWithAssignee(runtime)]);
    const keys = refuseFirstPost(runtime);
    renderPage(runtime);

    const dialog = await openPeek();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send to Room" }),
    );
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
    expect(keys[0]).toBe("work-item-share:workitem-login:1:room-product-v0");
  });

  it("gives another Room its own idempotency key", async () => {
    const runtime = await testRuntime();
    seedWorkItems(runtime, [itemWithAssignee(runtime)]);
    const keys = refuseFirstPost(runtime);
    renderPage(runtime);

    const dialog = await openPeek();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send to Room" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "all" }));
    expect(
      await screen.findByText("You are not allowed to post in this Room."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(await screen.findByText("Sent to product-v0.")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe("work-item-share:workitem-login:1:room-product-v0");
  });

  it("disables the Room choices while the message is being sent", async () => {
    const runtime = await testRuntime();
    seedWorkItems(runtime, [itemWithAssignee(runtime)]);
    let answer: ((response: Response) => void) | undefined;
    runtime.server.on(
      "POST",
      MESSAGES_PATH,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    renderPage(runtime);

    const dialog = await openPeek();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send to Room" }),
    );
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

function itemWithAssignee(runtime: TestTeamHubRuntime): TeamHubWorkItem {
  const human = runtime.seed.identity.actors[0]!;
  const codex = runtime.seed.actors.find(
    (actor) => actor.id === "actor-codex",
  )!;
  return workItem(human, {
    assignees: [
      { actor: codex, assigned_at: "2026-07-30T00:00:00Z", assigned_by: human },
    ],
  });
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
    created_at: "2026-07-30T12:00:00Z",
    id: "message-work-item-1",
    message_kind: "conversation",
    raw_message: "",
    room_id: roomId,
    segments: [],
    tenant_id: "tenant-northstar",
  };
}

async function openPeek() {
  fireEvent.click(
    await screen.findByRole("link", { name: /Fix login failure/ }),
  );
  return screen.findByRole("dialog", { name: "Fix login failure" });
}

function seedWorkItems(runtime: TestTeamHubRuntime, items: TeamHubWorkItem[]) {
  runtime.seed.workItems = items;
}

function renderPage(runtime: TestTeamHubRuntime) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={["/t/tenant-northstar/dashboard"]}>
          <Suspense fallback={<p>Loading...</p>}>
            <Routes>
              <Route
                element={<WorkItemsPage />}
                path="/t/:tenantId/dashboard"
              />
            </Routes>
          </Suspense>
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function workItem(
  actor: TeamHubWorkItem["created_by"],
  override: Partial<TeamHubWorkItem> = {},
): TeamHubWorkItem {
  return {
    assignees: [],
    created_at: "2026-07-30T00:00:00Z",
    created_by: actor,
    description: "Email login returns 500.",
    explicit_access_grants: [],
    id: "workitem-login",
    kind: "issue",
    number: 42,
    priority: "high",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    title: "Fix login failure",
    updated_at: "2026-07-30T00:00:00Z",
    updated_by: actor,
    version: 1,
    ...override,
  };
}
