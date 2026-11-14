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
const ARCHIVE_PATH = "/v0/work-items/{workItemId}/archive";
const UNARCHIVE_PATH = "/v0/work-items/{workItemId}/unarchive";
const ASSIGNMENT_PATH = "/v0/work-items/{workItemId}/assignments/{actorId}";
const WORK_ITEM_PATH = "/v0/work-items/{workItemId}";

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

  it("assigns the Item to the current Actor from the peek", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    runtime.server.on("PUT", ASSIGNMENT_PATH, () => {
      runtime.seed.workItems = [
        { ...item, assignees: [assignment(human)], version: 2 },
      ];
      return assignment(human);
    });

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    expect(within(dialog).getByText("Unassigned")).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Unassign me" }),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Assign to me" }),
    );

    await waitFor(() =>
      expect(runtime.server.requestsTo("PUT", ASSIGNMENT_PATH)).toHaveLength(1),
    );
    const [request] = runtime.server.requestsTo("PUT", ASSIGNMENT_PATH);
    expect(new URL(request!.url).pathname).toBe(
      `/v0/work-items/workitem-login/assignments/${human.id}`,
    );
    expect(request?.headers.get("Idempotency-Key")).toMatch(/^web:/u);
    expect(await within(dialog).findByText(human.display_name)).toBeVisible();
    expect(within(dialog).queryByText("Unassigned")).toBeNull();
    expect(
      await within(dialog).findByRole("button", { name: "Unassign me" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        runtime.server.requestsTo("GET", WORK_ITEMS_PATH).length,
      ).toBeGreaterThan(1),
    );
  });

  it("unassigns only the current Actor", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const agent = runtime.seed.actors.find(
      (actor) => actor.id === "actor-codex",
    )!;
    const item = workItem(human, {
      assignees: [assignment(human), assignment(agent)],
      title: "Fix login failure",
    });
    seedWorkItems(runtime, [item]);
    runtime.server.on("DELETE", ASSIGNMENT_PATH, ({ params }) => {
      runtime.seed.workItems = [
        {
          ...item,
          assignees: item.assignees.filter(
            ({ actor }) => actor.id !== params.actorId,
          ),
          version: 2,
        },
      ];
      return undefined;
    });

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    expect(within(dialog).getByText(human.display_name)).toBeVisible();
    expect(within(dialog).getByText("Codex")).toBeVisible();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Unassign me" }),
    );

    await waitFor(() =>
      expect(runtime.server.requestsTo("DELETE", ASSIGNMENT_PATH)).toHaveLength(
        1,
      ),
    );
    const [request] = runtime.server.requestsTo("DELETE", ASSIGNMENT_PATH);
    expect(new URL(request!.url).pathname).toBe(
      `/v0/work-items/workitem-login/assignments/${human.id}`,
    );
    await waitFor(() =>
      expect(within(dialog).queryByText(human.display_name)).toBeNull(),
    );
    expect(within(dialog).getByText("Codex")).toBeVisible();
    expect(
      await within(dialog).findByRole("button", { name: "Assign to me" }),
    ).toBeVisible();
  });

  it("blocks a second assignment click while the request is in flight", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);
    let finish: () => void = () => undefined;
    runtime.server.on(
      "PUT",
      ASSIGNMENT_PATH,
      () =>
        new Promise((resolve) => {
          finish = () => resolve(assignment(human));
        }),
    );

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    const control = within(dialog).getByRole("button", {
      name: "Assign to me",
    });

    fireEvent.click(control);
    await waitFor(() => expect(control).toBeDisabled());
    expect(control).toHaveAttribute("aria-busy", "true");
    fireEvent.click(control);

    finish();
    await waitFor(() => expect(control).toBeEnabled());
    expect(runtime.server.requestsTo("PUT", ASSIGNMENT_PATH)).toHaveLength(1);
  });

  it("shows the server's message when an assignment fails", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);
    runtime.server.on("PUT", ASSIGNMENT_PATH, () =>
      teamHubErrorResponse(
        409,
        "CONFLICT",
        "This Actor cannot be assigned right now.",
      ),
    );

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Assign to me" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This Actor cannot be assigned right now.",
    );
    expect(within(dialog).getByText("Unassigned")).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Assign to me" }),
    ).toBeEnabled();
  });

  it("archives the Item and says the Archived filter shows it", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [
      item,
      workItem(human, {
        id: "workitem-other",
        number: 43,
        title: "Other work",
      }),
    ]);
    const posted: unknown[] = [];
    runtime.server.on("POST", ARCHIVE_PATH, ({ body }) => {
      posted.push(body);
      const archivedItem: TeamHubWorkItem = {
        ...item,
        archived_at: "2026-07-30T12:00:00Z",
        updated_at: "2026-07-30T12:00:00Z",
        version: 2,
      };
      runtime.seed.workItems = runtime.seed.workItems.map((candidate) =>
        candidate.id === item.id ? archivedItem : candidate,
      );
      return archivedItem;
    });

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(posted).toEqual([{ expected_version: 1 }]));
    const [request] = runtime.server.requestsTo("POST", ARCHIVE_PATH);
    expect(new URL(request!.url).pathname).toBe(
      "/v0/work-items/workitem-login/archive",
    );
    expect(request?.headers.get("Idempotency-Key")).toMatch(/^web:/u);
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Archived. The board hides it until the Archived filter is on.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Unarchive" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Archive" }),
    ).toBeNull();
    await waitFor(() =>
      expect(
        runtime.server.requestsTo("GET", WORK_ITEMS_PATH).length,
      ).toBeGreaterThan(1),
    );

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: /Fix login failure/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    ).toBeVisible();
  });

  it("archives without pointing at a filter that is already on", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    runtime.server.on("POST", ARCHIVE_PATH, () => {
      const archivedItem: TeamHubWorkItem = {
        ...item,
        archived_at: "2026-07-30T12:00:00Z",
        updated_at: "2026-07-30T12:00:00Z",
        version: 2,
      };
      runtime.seed.workItems = [archivedItem];
      return archivedItem;
    });

    renderPage(runtime, "/t/tenant-northstar/dashboard?archived=true");
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    const status = await within(dialog).findByRole("status");
    expect(status.textContent).toBe("Archived.");
  });

  it("unarchives the Item and returns it to the board", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, {
      archived_at: "2026-07-30T09:00:00Z",
      title: "Fix login failure",
    });
    seedWorkItems(runtime, [item]);
    const posted: unknown[] = [];
    runtime.server.on("POST", UNARCHIVE_PATH, ({ body }) => {
      posted.push(body);
      const updated: TeamHubWorkItem = {
        ...item,
        updated_at: "2026-07-30T12:00:00Z",
        version: 2,
      };
      delete updated.archived_at;
      runtime.seed.workItems = [updated];
      return updated;
    });

    renderPage(runtime, "/t/tenant-northstar/dashboard?archived=true");
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unarchive" }));

    await waitFor(() => expect(posted).toEqual([{ expected_version: 1 }]));
    const [request] = runtime.server.requestsTo("POST", UNARCHIVE_PATH);
    expect(new URL(request!.url).pathname).toBe(
      "/v0/work-items/workitem-login/unarchive",
    );
    expect(request?.headers.get("Idempotency-Key")).toMatch(/^web:/u);
    expect(runtime.server.requestsTo("POST", ARCHIVE_PATH)).toHaveLength(0);
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Unarchived.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Archive" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Unarchive" }),
    ).toBeNull();

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    ).toBeVisible();
  });

  it("blocks a second archive click while the request is in flight", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    let finish: () => void = () => undefined;
    runtime.server.on(
      "POST",
      ARCHIVE_PATH,
      () =>
        new Promise((resolve) => {
          finish = () => {
            const archivedItem: TeamHubWorkItem = {
              ...item,
              archived_at: "2026-07-30T12:00:00Z",
              updated_at: "2026-07-30T12:00:00Z",
              version: 2,
            };
            runtime.seed.workItems = [archivedItem];
            resolve(archivedItem);
          };
        }),
    );

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    const control = within(dialog).getByRole("button", { name: "Archive" });

    fireEvent.click(control);
    await waitFor(() => expect(control).toBeDisabled());
    expect(control).toHaveAttribute("aria-busy", "true");
    fireEvent.click(control);

    finish();
    await waitFor(() => expect(control).toBeEnabled());
    expect(runtime.server.requestsTo("POST", ARCHIVE_PATH)).toHaveLength(1);
  });

  it("shows the server's message when archiving fails and keeps the Item", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);
    runtime.server.on("POST", ARCHIVE_PATH, () =>
      teamHubErrorResponse(409, "CONFLICT", "Work Item changed elsewhere."),
    );

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Work Item changed elsewhere.",
    );
    expect(
      screen.getByRole("dialog", { name: "Fix login failure" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Archive" }),
    ).toBeEnabled();
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(within(dialog).getByText("Open")).toBeVisible();
  });

  it("saves only the fields the person changed under the item's revision", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, {
      description: "Email login returns 500.",
      priority: "high",
      title: "Fix login failure",
      version: 4,
    });
    seedWorkItems(runtime, [item]);
    const posted: unknown[] = [];
    runtime.server.on("PATCH", WORK_ITEM_PATH, ({ body }) => {
      posted.push(body);
      const updated: TeamHubWorkItem = {
        ...item,
        description: "Email login loops.",
        title: "Fix login redirect",
        updated_at: "2026-07-30T12:00:00Z",
        version: 5,
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "  Fix login redirect  " },
    });
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "Email login loops." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(posted).toEqual([
        {
          description: "Email login loops.",
          expected_version: 4,
          title: "Fix login redirect",
        },
      ]),
    );
    const [request] = runtime.server.requestsTo("PATCH", WORK_ITEM_PATH);
    expect(new URL(request!.url).pathname).toBe(
      "/v0/work-items/workitem-login",
    );
    expect(request?.headers.get("Idempotency-Key")).toMatch(/^web:/u);

    const updatedDialog = await screen.findByRole("dialog", {
      name: "Fix login redirect",
    });
    expect(within(updatedDialog).getByText("Email login loops.")).toBeVisible();
    expect(within(updatedDialog).getByText("high")).toBeVisible();
    expect(
      within(updatedDialog).queryByRole("button", { name: "Save" }),
    ).toBeNull();
    await waitFor(() =>
      expect(
        runtime.server.requestsTo("GET", WORK_ITEMS_PATH).length,
      ).toBeGreaterThan(1),
    );
    expect(
      await screen.findByRole("link", { name: /Fix login redirect/ }),
    ).toBeVisible();
  });

  it("changes the priority alone and leaves the other fields out", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, {
      priority: "high",
      title: "Fix login failure",
    });
    seedWorkItems(runtime, [item]);
    const posted: unknown[] = [];
    runtime.server.on("PATCH", WORK_ITEM_PATH, ({ body }) => {
      posted.push(body);
      const updated: TeamHubWorkItem = {
        ...item,
        priority: "urgent",
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Priority" }));
    fireEvent.click(await screen.findByRole("option", { name: "Urgent" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(posted).toEqual([{ expected_version: 1, priority: "urgent" }]),
    );
    expect(await within(dialog).findByText("urgent")).toBeVisible();
    expect(within(dialog).getByText("Fix login failure")).toBeVisible();
  });

  it("does not save an empty or over-long title", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    const title = within(dialog).getByLabelText("Title");
    const save = within(dialog).getByRole("button", { name: "Save" });

    fireEvent.change(title, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(runtime.server.requestsTo("PATCH", WORK_ITEM_PATH)).toHaveLength(0);

    fireEvent.change(title, { target: { value: "t".repeat(241) } });
    expect(save).toBeDisabled();
    expect(
      within(dialog).getByText("A title can be at most 240 characters long."),
    ).toBeVisible();
    expect(runtime.server.requestsTo("PATCH", WORK_ITEM_PATH)).toHaveLength(0);
  });

  it("cancels back to the saved values without a request", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        description: "Email login returns 500.",
        title: "Fix login failure",
      }),
    ]);

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "Draft title" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(dialog).getByText("Email login returns 500.")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Fix login failure",
    );
    expect(runtime.server.requestsTo("PATCH", WORK_ITEM_PATH)).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Fix login failure",
    );
  });

  it("keeps the input and the server's message when a save is rejected", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);
    runtime.server.on("PATCH", WORK_ITEM_PATH, () =>
      teamHubErrorResponse(409, "CONFLICT", "Work Item changed elsewhere."),
    );

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "Fix login redirect" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Work Item changed elsewhere.",
    );
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Fix login redirect",
    );
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Fix login failure",
    );
    expect(
      screen.getByRole("link", { name: /Fix login failure/ }),
    ).toBeVisible();
  });

  it("discards a half-typed edit when the peek closes", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "Draft title" },
    });

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(runtime.server.requestsTo("PATCH", WORK_ITEM_PATH)).toHaveLength(0);

    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const reopened = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    fireEvent.click(within(reopened).getByRole("button", { name: "Edit" }));
    expect(within(reopened).getByLabelText("Title")).toHaveValue(
      "Fix login failure",
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
