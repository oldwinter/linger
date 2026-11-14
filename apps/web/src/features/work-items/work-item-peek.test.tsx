import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubWorkItem,
  TeamHubWorkItemComment,
  TeamHubWorkItemTimelineEntry,
} from "@/features/teamhub/teamhub-types";

import { WorkItemsPage } from "./work-items-page";

const WORK_ITEMS_PATH = "/v0/tenants/{tenantId}/work-items";
const COMMENTS_PATH = "/v0/work-items/{workItemId}/comments";
const TIMELINE_PATH = "/v0/work-items/{workItemId}/timeline";
const TRANSITION_PATH = "/v0/work-items/{workItemId}/transitions";

describe("Work Item peek", () => {
  it("renders the Item with its comments, timeline, and allowed transitions", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const agent = runtime.seed.actors.find(
      (actor) => actor.id === "actor-codex",
    )!;
    const item = workItem(human, {
      assignees: [assignment(agent)],
      description: "Email login returns 500.",
      priority: "high",
      title: "Fix login failure",
    });
    seedWorkItems(runtime, [item]);
    runtime.server.on("GET", COMMENTS_PATH, () => ({
      items: [
        comment(item.id, human, "First note", "2026-07-30T10:00:00Z"),
        comment(item.id, agent, "Second note", "2026-07-30T11:00:00Z"),
      ],
      page: { has_more: false },
    }));
    runtime.server.on("GET", TIMELINE_PATH, () => ({
      items: [
        timelineActivity(item.id, human, {
          kind: "created",
          occurred_at: "2026-07-30T09:00:00Z",
        }),
      ],
      page: { has_more: false },
    }));

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    expect(within(dialog).getByText("Issue #42")).toBeVisible();
    expect(within(dialog).getByText("Email login returns 500.")).toBeVisible();
    expect(within(dialog).getByText("Open")).toBeVisible();
    expect(within(dialog).getByText("high")).toBeVisible();
    expect(within(dialog).getAllByText("Codex").length).toBeGreaterThan(0);
    expect(await within(dialog).findByText("Second note")).toBeVisible();
    expect(
      within(dialog).getByText("Jenny Bin created the item"),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Start" })).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Resolve" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("link", { name: "Open full page" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/dashboard/workitem-login");
  });

  it("posts a transition and refreshes the board and the drawer", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    const posted: unknown[] = [];
    runtime.server.on("POST", TRANSITION_PATH, ({ body }) => {
      posted.push(body);
      const updated: TeamHubWorkItem = {
        ...item,
        state: "in_progress",
        updated_at: "2026-07-30T12:00:00Z",
        version: 2,
      };
      runtime.seed.workItems = [updated];
      return updated;
    });

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(posted).toEqual([{ expected_version: 1, state: "in_progress" }]),
    );
    const [transitionRequest] = runtime.server.requestsTo(
      "POST",
      TRANSITION_PATH,
    );
    expect(transitionRequest?.headers.get("Idempotency-Key")).toMatch(/^web:/u);
    expect(await within(dialog).findByText("In progress")).toBeVisible();
    await waitFor(() =>
      expect(
        runtime.server.requestsTo("GET", WORK_ITEMS_PATH).length,
      ).toBeGreaterThan(1),
    );
    const inProgress = await screen.findByRole("region", {
      name: "In progress",
    });
    expect(
      await within(inProgress).findByText("Fix login failure"),
    ).toBeVisible();

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      within(inProgress).getByRole("link", { name: /Fix login failure/ }),
    ).toHaveFocus();
  });

  it("closes on Escape and returns focus to the card", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);

    renderPage(runtime);
    const card = await screen.findByRole("link", { name: /Fix login failure/ });
    card.focus();
    fireEvent.click(card);
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(card).toHaveFocus();
  });

  it("opens from a filtered board and keeps the filter on the full page", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        id: "workitem-human",
        origin_room_id: "room-all",
        title: "Human-owned work",
      }),
      workItem(human, {
        id: "workitem-agent",
        origin_room_id: "room-gtm-launch",
        title: "Agent-owned work",
      }),
    ]);

    renderPage(runtime, "/t/tenant-northstar/dashboard?room=room-all");
    fireEvent.click(
      await screen.findByRole("link", { name: /Human-owned work/ }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Human-owned work",
    });
    expect(screen.queryByText("Agent-owned work")).not.toBeInTheDocument();
    const fullPage = within(dialog).getByRole("link", {
      name: "Open full page",
    });
    expect(fullPage).toHaveAttribute(
      "href",
      "/t/tenant-northstar/dashboard/workitem-human?room=room-all",
    );

    fireEvent.click(fullPage);

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard/workitem-human?room=room-all",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("surfaces a failed transition without closing the drawer", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);
    runtime.server.on("POST", TRANSITION_PATH, () =>
      teamHubErrorResponse(409, "CONFLICT", "Work Item changed elsewhere."),
    );

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Work Item changed elsewhere.",
    );
    expect(within(dialog).getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("posts a comment and refreshes the comments and timeline", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    const comments = [
      comment(item.id, human, "First note", "2026-07-30T10:00:00Z"),
    ];
    const posted: unknown[] = [];
    runtime.server.on("GET", COMMENTS_PATH, () => ({
      items: comments,
      page: { has_more: false },
    }));
    runtime.server.on("GET", TIMELINE_PATH, () => ({
      items: [timelineActivity(item.id, human)],
      page: { has_more: false },
    }));
    runtime.server.on("POST", COMMENTS_PATH, ({ body }) => {
      posted.push(body);
      const created = comment(
        item.id,
        human,
        "Thanks, looking now.",
        "2026-07-30T12:00:00Z",
      );
      comments.push(created);
      return created;
    });

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    expect(await within(dialog).findByText("First note")).toBeVisible();
    const textarea = within(dialog).getByRole("textbox", {
      name: "Add a comment",
    });

    fireEvent.change(textarea, {
      target: { value: "  Thanks, looking now.  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

    expect(
      await within(dialog).findByText("Thanks, looking now."),
    ).toBeVisible();
    expect(posted).toEqual([
      {
        body: "Thanks, looking now.",
        segments: [{ content: "Thanks, looking now.", type: "text" }],
      },
    ]);
    const [request] = runtime.server.requestsTo("POST", COMMENTS_PATH);
    expect(new URL(request!.url).pathname).toBe(
      "/v0/work-items/workitem-login/comments",
    );
    expect(request?.headers.get("Idempotency-Key")).toMatch(/^web:/u);
    expect(textarea).toHaveValue("");
    expect(textarea).toHaveFocus();
    await waitFor(() =>
      expect(
        runtime.server.requestsTo("GET", COMMENTS_PATH).length,
      ).toBeGreaterThan(1),
    );
    await waitFor(() =>
      expect(
        runtime.server.requestsTo("GET", TIMELINE_PATH).length,
      ).toBeGreaterThan(1),
    );
  });

  it("keeps Submit disabled for empty text and while a comment is in flight", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    let finish: () => void = () => undefined;
    runtime.server.on(
      "POST",
      COMMENTS_PATH,
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve(
              comment(
                item.id,
                human,
                "Thanks, looking now.",
                "2026-07-30T12:00:00Z",
              ),
            );
        }),
    );

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    const textarea = await within(dialog).findByRole("textbox", {
      name: "Add a comment",
    });
    const submit = within(dialog).getByRole("button", { name: "Submit" });

    expect(submit).toBeDisabled();
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(submit).toBeDisabled();
    fireEvent.change(textarea, { target: { value: "Thanks, looking now." } });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(textarea).toBeDisabled();

    finish();
    await waitFor(() => expect(textarea).toHaveValue(""));
    expect(textarea).toBeEnabled();
  });

  it("retries a failed comment with its key and shows why it failed", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    let attempts = 0;
    runtime.server.on("POST", COMMENTS_PATH, () => {
      attempts += 1;
      if (attempts === 1) {
        return teamHubErrorResponse(
          503,
          "SERVICE_UNAVAILABLE",
          "TeamHub is unavailable.",
        );
      }
      return comment(
        item.id,
        human,
        "Thanks, looking now.",
        "2026-07-30T12:00:00Z",
      );
    });

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    const textarea = await within(dialog).findByRole("textbox", {
      name: "Add a comment",
    });
    const submit = within(dialog).getByRole("button", { name: "Submit" });

    fireEvent.change(textarea, { target: { value: "Thanks, looking now." } });
    fireEvent.click(submit);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "TeamHub is unavailable.",
    );
    expect(textarea).toHaveValue("Thanks, looking now.");
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() =>
      expect(runtime.server.requestsTo("POST", COMMENTS_PATH)).toHaveLength(2),
    );
    const [failed, retried] = runtime.server.requestsTo("POST", COMMENTS_PATH);
    expect(retried!.headers.get("Idempotency-Key")).toBe(
      failed!.headers.get("Idempotency-Key"),
    );
    await waitFor(() => expect(textarea).toHaveValue(""));

    fireEvent.change(textarea, { target: { value: "Second thought." } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(runtime.server.requestsTo("POST", COMMENTS_PATH)).toHaveLength(3),
    );
    const [, , next] = runtime.server.requestsTo("POST", COMMENTS_PATH);
    expect(next!.headers.get("Idempotency-Key")).not.toBe(
      failed!.headers.get("Idempotency-Key"),
    );
  });
});

async function testRuntime() {
  return createTestTeamHubRuntime();
}

function renderPage(
  runtime: TestTeamHubRuntime,
  initialEntry = "/t/tenant-northstar/dashboard",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Suspense fallback={<p>Loading...</p>}>
            <Routes>
              <Route
                element={<WorkItemsPage />}
                path="/t/:tenantId/dashboard"
              />
              <Route
                element={<WorkItemsPage />}
                path="/t/:tenantId/dashboard/:workItemId"
              />
            </Routes>
            <LocationProbe />
          </Suspense>
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
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

function assignment(
  actor: TeamHubWorkItem["created_by"],
): TeamHubWorkItem["assignees"][number] {
  return {
    actor,
    assigned_at: "2026-07-30T00:00:00Z",
    assigned_by: actor,
  };
}

function comment(
  workItemId: string,
  author: TeamHubWorkItemComment["author"],
  body: string,
  createdAt: string,
): TeamHubWorkItemComment {
  return {
    author,
    body,
    created_at: createdAt,
    id: `comment-${body.replaceAll(" ", "-").toLowerCase()}`,
    segments: [{ type: "text", content: body }],
    tenant_id: "tenant-northstar",
    updated_at: createdAt,
    version: 1,
    work_item_id: workItemId,
  };
}

function timelineActivity(
  workItemId: string,
  actor: TeamHubWorkItem["created_by"],
  override: Partial<
    Extract<TeamHubWorkItemTimelineEntry, { type: "activity" }>["activity"]
  > = {},
): TeamHubWorkItemTimelineEntry {
  return {
    activity: {
      actor,
      details: {},
      id: `activity-${override.kind ?? "created"}`,
      kind: "created",
      occurred_at: "2026-07-30T09:00:00Z",
      work_item_id: workItemId,
      ...override,
    },
    type: "activity",
  };
}

function seedWorkItems(runtime: TestTeamHubRuntime, items: TeamHubWorkItem[]) {
  runtime.seed.workItems = items;
}
