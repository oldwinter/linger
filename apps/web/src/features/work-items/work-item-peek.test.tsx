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
    ).toHaveAttribute("href", "/t/tenant-northstar/work-items/workitem-login");
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

  it.each(["Escape", "backdrop", "Close", "Open full page"])(
    "protects an unsent comment when leaving through %s",
    async (exit) => {
      const runtime = await testRuntime();
      const human = runtime.seed.identity.actors[0]!;
      seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);

      renderPage(runtime);
      const dialog = await openPeek("Fix login failure");
      const textarea = within(dialog).getByRole("textbox", {
        name: "Add a comment",
      });
      fireEvent.change(textarea, {
        target: { value: "Keep these details until I finish checking." },
      });
      textarea.focus();

      if (exit === "Escape") {
        fireEvent(
          dialog,
          new Event("cancel", { bubbles: true, cancelable: true }),
        );
      } else if (exit === "backdrop") {
        fireEvent.click(dialog);
      } else {
        fireEvent.click(
          within(dialog).getByRole(exit === "Close" ? "button" : "link", {
            name: exit,
          }),
        );
      }

      const confirmation = await screen.findByRole("dialog", {
        name: "Discard unsaved work?",
      });
      expect(
        within(confirmation).getByText("Your comment has not been sent."),
      ).toBeVisible();
      expect(
        within(confirmation).getByRole("button", { name: "Continue editing" }),
      ).toHaveFocus();
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/t/tenant-northstar/dashboard",
      );
      fireEvent.click(
        within(confirmation).getByRole("button", { name: "Continue editing" }),
      );

      expect(confirmation).not.toBeInTheDocument();
      expect(textarea).toHaveValue(
        "Keep these details until I finish checking.",
      );
      await waitFor(() => expect(textarea).toHaveFocus());
      expect(runtime.server.requestsTo("POST", COMMENTS_PATH)).toHaveLength(0);
    },
  );

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
      "/t/tenant-northstar/work-items/workitem-human?room=room-all",
    );

    fireEvent.click(fullPage);

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/work-items/workitem-human?room=room-all",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the full page only after discarding both unsaved inputs", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        origin_room_id: "room-all",
        title: "Fix login failure",
      }),
    ]);

    renderPage(runtime, "/t/tenant-northstar/dashboard?room=room-all");
    const dialog = await openPeek("Fix login failure");
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Add a comment" }),
      { target: { value: "Check this in the morning." } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "My revised investigation notes." },
    });
    fireEvent.click(
      within(dialog).getByRole("link", { name: "Open full page" }),
    );

    const confirmation = await screen.findByRole("dialog", {
      name: "Discard unsaved work?",
    });
    expect(confirmation).toHaveTextContent(
      "Your changes and comment have not been saved or sent.",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard?room=room-all",
    );
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Discard and open page",
      }),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/work-items/workitem-login?room=room-all",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(runtime.server.requestsTo("POST", COMMENTS_PATH)).toHaveLength(0);
    expect(runtime.server.requestsTo("PATCH", WORK_ITEM_PATH)).toHaveLength(0);
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
    await waitFor(() => expect(textarea).toHaveFocus());
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
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(textarea).toBeDisabled();

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(
      within(dialog).getByRole("link", { name: "Open full page" }),
    );
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Wait for saving or sending to finish before leaving.",
    );
    expect(
      screen.queryByRole("dialog", { name: "Discard unsaved work?" }),
    ).not.toBeInTheDocument();
    expect(textarea).toHaveValue("Thanks, looking now.");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard",
    );
    await waitFor(() =>
      expect(runtime.server.requestsTo("POST", COMMENTS_PATH)).toHaveLength(1),
    );

    finish();
    await waitFor(() => expect(textarea).toHaveValue(""));
    expect(textarea).toBeEnabled();
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    const confirmation = await screen.findByRole("dialog", {
      name: "Discard unsaved work?",
    });
    fireEvent(
      confirmation,
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    expect(confirmation).not.toBeInTheDocument();
    expect(textarea).toHaveValue("Thanks, looking now.");

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

  it("offers every other Actor and leaves out the assigned ones", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const agent = runtime.seed.actors.find(
      (actor) => actor.id === "actor-codex",
    )!;
    seedWorkItems(runtime, [
      workItem(human, {
        assignees: [assignment(agent)],
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
    const picker = await openAssigneePicker(dialog);

    expect(await within(picker).findByText("Maya Chen")).toBeVisible();
    expect(
      within(picker).getByRole("region", { name: "People" }),
    ).toBeVisible();
    expect(
      within(picker).getByRole("region", { name: "Agents" }),
    ).toBeVisible();
    expect(within(picker).getByText("Lev8 GTM")).toBeVisible();
    expect(within(picker).queryByText("Codex")).toBeNull();
    // Five Actors are short enough to scan without a search field.
    expect(
      within(picker).queryByRole("searchbox", {
        name: "Search people and agents",
      }),
    ).toBeNull();
  });

  it("assigns another Actor and refreshes the peek", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const maya = runtime.seed.actors.find(
      (actor) => actor.id === "actor-maya",
    )!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    runtime.server.on("PUT", ASSIGNMENT_PATH, () => {
      runtime.seed.workItems = [
        { ...item, assignees: [assignment(maya)], version: 2 },
      ];
      return assignment(maya);
    });

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    const picker = await openAssigneePicker(dialog);
    fireEvent.click(
      await within(picker).findByRole("button", { name: "Maya Chen" }),
    );

    await waitFor(() =>
      expect(runtime.server.requestsTo("PUT", ASSIGNMENT_PATH)).toHaveLength(1),
    );
    const [request] = runtime.server.requestsTo("PUT", ASSIGNMENT_PATH);
    expect(new URL(request!.url).pathname).toBe(
      "/v0/work-items/workitem-login/assignments/actor-maya",
    );
    expect(request?.headers.get("Idempotency-Key")).toMatch(/^web:/u);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Assign someone" }),
      ).not.toBeInTheDocument(),
    );
    expect(await within(dialog).findByText("Maya Chen")).toBeVisible();
    await waitFor(() =>
      expect(
        runtime.server.requestsTo("GET", WORK_ITEMS_PATH).length,
      ).toBeGreaterThan(1),
    );
  });

  it("blocks a second choice while the assignment is in flight", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const maya = runtime.seed.actors.find(
      (actor) => actor.id === "actor-maya",
    )!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    let finish: () => void = () => undefined;
    runtime.server.on(
      "PUT",
      ASSIGNMENT_PATH,
      () =>
        new Promise((resolve) => {
          finish = () => {
            runtime.seed.workItems = [
              { ...item, assignees: [assignment(maya)], version: 2 },
            ];
            resolve(assignment(maya));
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
    const picker = await openAssigneePicker(dialog);
    const option = await within(picker).findByRole("button", {
      name: "Maya Chen",
    });

    fireEvent.click(option);
    await waitFor(() => expect(option).toBeDisabled());
    expect(within(picker).getByText("Assigning…")).toBeVisible();
    fireEvent.click(option);
    expect(
      screen.getByRole("dialog", { name: "Assign someone" }),
    ).toBeVisible();

    finish();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Assign someone" }),
      ).not.toBeInTheDocument(),
    );
    expect(runtime.server.requestsTo("PUT", ASSIGNMENT_PATH)).toHaveLength(1);
  });

  it("keeps the picker open with the server's message when the assignment fails", async () => {
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
    const picker = await openAssigneePicker(dialog);
    fireEvent.click(
      await within(picker).findByRole("button", { name: "Maya Chen" }),
    );

    expect(await within(picker).findByRole("alert")).toHaveTextContent(
      "This Actor cannot be assigned right now.",
    );
    expect(
      screen.getByRole("dialog", { name: "Assign someone" }),
    ).toBeVisible();
    const option = within(picker).getByRole("button", { name: "Maya Chen" });
    expect(option).toHaveAttribute("aria-current", "true");
    expect(option).toBeEnabled();
    expect(within(dialog).getByText("Unassigned")).toBeVisible();
  });

  it("retries the same choice with its idempotency key", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const maya = runtime.seed.actors.find(
      (actor) => actor.id === "actor-maya",
    )!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    let attempts = 0;
    runtime.server.on("PUT", ASSIGNMENT_PATH, () => {
      attempts += 1;
      if (attempts === 1) {
        return teamHubErrorResponse(
          503,
          "SERVICE_UNAVAILABLE",
          "TeamHub is unavailable.",
        );
      }
      runtime.seed.workItems = [
        { ...item, assignees: [assignment(maya)], version: 2 },
      ];
      return assignment(maya);
    });

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    const picker = await openAssigneePicker(dialog);
    const option = await within(picker).findByRole("button", {
      name: "Maya Chen",
    });

    fireEvent.click(option);
    expect(await within(picker).findByRole("alert")).toHaveTextContent(
      "TeamHub is unavailable.",
    );

    fireEvent.click(option);
    await waitFor(() =>
      expect(runtime.server.requestsTo("PUT", ASSIGNMENT_PATH)).toHaveLength(2),
    );
    const [failed, retried] = runtime.server.requestsTo("PUT", ASSIGNMENT_PATH);
    expect(retried!.headers.get("Idempotency-Key")).toBe(
      failed!.headers.get("Idempotency-Key"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Assign someone" }),
      ).not.toBeInTheDocument(),
    );
    expect(await within(dialog).findByText("Maya Chen")).toBeVisible();
  });

  it("searches a long Actor list by name", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    runtime.seed.actors.push(
      ...Array.from({ length: 5 }, (_, index) => ({
        created_at: "2026-07-30T00:00:00Z",
        display_name: `Search Actor ${index + 1}`,
        handle: `@search_${index + 1}`,
        id: `actor-search-${index + 1}`,
        kind: "human" as const,
        tenant_id: "tenant-northstar",
      })),
    );
    seedWorkItems(runtime, [workItem(human, { title: "Fix login failure" })]);

    renderPage(runtime);
    fireEvent.click(
      await screen.findByRole("link", { name: /Fix login failure/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Fix login failure",
    });
    const picker = await openAssigneePicker(dialog);
    const search = await within(picker).findByRole("searchbox", {
      name: "Search people and agents",
    });

    fireEvent.change(search, { target: { value: "maya" } });

    expect(await within(picker).findByText("Maya Chen")).toBeVisible();
    expect(within(picker).queryByText("Lev8 GTM")).toBeNull();
    expect(within(picker).queryByText("Search Actor 1")).toBeNull();

    fireEvent.change(search, { target: { value: "search actor 3" } });

    expect(await within(picker).findByText("Search Actor 3")).toBeVisible();
    expect(within(picker).queryByText("Maya Chen")).toBeNull();
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

  it("confirms discarding edits without losing a separate comment", async () => {
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
    const commentInput = within(dialog).getByRole("textbox", {
      name: "Add a comment",
    });
    fireEvent.change(commentInput, {
      target: { value: "Keep my separate comment." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const confirmation = await screen.findByRole("dialog", {
      name: "Discard unsaved work?",
    });
    expect(confirmation).toHaveTextContent("Your changes have not been saved.");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Continue editing" }),
    );
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Draft title");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard edits" }),
    );
    expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(dialog).getByText("Email login returns 500.")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Fix login failure",
    );
    expect(runtime.server.requestsTo("PATCH", WORK_ITEM_PATH)).toHaveLength(0);
    expect(commentInput).toHaveValue("Keep my separate comment.");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Edit" }),
      ).toHaveFocus(),
    );

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
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    const confirmation = await screen.findByRole("dialog", {
      name: "Discard unsaved work?",
    });
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Continue editing" }),
    );
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Fix login redirect",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Work Item changed elsewhere.",
    );
  });

  it("keeps an in-flight edit open and submits it only once", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    let finish: () => void = () => undefined;
    runtime.server.on(
      "PATCH",
      WORK_ITEM_PATH,
      () =>
        new Promise((resolve) => {
          finish = () => {
            const updated = {
              ...item,
              description: "The response never arrives.",
              version: 2,
            };
            runtime.seed.workItems = [updated];
            resolve(updated);
          };
        }),
    );

    renderPage(runtime);
    const dialog = await openPeek("Fix login failure");
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    const description = within(dialog).getByLabelText("Description");
    fireEvent.change(description, {
      target: { value: "The response never arrives." },
    });
    const save = within(dialog).getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(save).toBeDisabled());
    expect(description).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    fireEvent.click(dialog);
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    fireEvent.click(
      within(dialog).getByRole("link", { name: "Open full page" }),
    );
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Wait for saving or sending to finish before leaving.",
    );
    expect(description).toHaveValue("The response never arrives.");
    expect(
      screen.queryByRole("dialog", { name: "Discard unsaved work?" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(runtime.server.requestsTo("PATCH", WORK_ITEM_PATH)).toHaveLength(
        1,
      ),
    );

    finish();
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("button", { name: "Save" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(dialog).getByText("The response never arrives."),
    ).toBeVisible();
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("protects a half-typed edit until the person chooses to discard it", async () => {
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
    const confirmation = await screen.findByRole("dialog", {
      name: "Discard unsaved work?",
    });
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Draft title");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Continue editing" }),
    );
    expect(confirmation).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Draft title");

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard and close" }),
    );
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

  it("counts the hidden comments and events on one control per section", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    seedConversation(runtime, human, {
      [item.id]: { comments: 5, events: 10 },
    });

    renderPage(runtime);
    const dialog = await openPeek("Fix login failure");
    const comments = peekSection(dialog, "Recent comments");
    const timeline = peekSection(dialog, "Timeline");

    expect(
      await within(comments).findByRole("button", {
        name: "Show all 5 comments",
      }),
    ).toBeVisible();
    expect(
      within(timeline).getByRole("button", { name: "Show all 10 events" }),
    ).toBeVisible();
    expect(within(comments).getAllByRole("listitem")).toHaveLength(3);
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(8);
    expect(within(comments).getByText("Note 3")).toBeVisible();
    expect(within(comments).queryByText("Note 2")).not.toBeInTheDocument();
  });

  it("expands to every loaded entry and collapses back", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    seedConversation(runtime, human, {
      [item.id]: { comments: 5, events: 10 },
    });

    renderPage(runtime);
    const dialog = await openPeek("Fix login failure");
    const comments = peekSection(dialog, "Recent comments");
    const timeline = peekSection(dialog, "Timeline");
    const locationBefore = screen.getByTestId("location").textContent;

    fireEvent.click(
      await within(comments).findByRole("button", {
        name: "Show all 5 comments",
      }),
    );
    const allComments = within(comments).getAllByRole("listitem");
    expect(allComments).toHaveLength(5);
    // The expanded list keeps the newest-first reading order.
    expect(allComments[0]).toHaveTextContent("Note 5");
    expect(allComments.at(-1)).toHaveTextContent("Note 1");
    expect(
      within(comments).getByRole("button", { name: "Show fewer" }),
    ).toBeVisible();

    fireEvent.click(
      within(timeline).getByRole("button", { name: "Show all 10 events" }),
    );
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(10);
    expect(
      within(timeline).getByRole("button", { name: "Show fewer" }),
    ).toBeVisible();

    fireEvent.click(
      within(comments).getByRole("button", { name: "Show fewer" }),
    );
    expect(within(comments).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(comments).getByRole("button", { name: "Show all 5 comments" }),
    ).toBeVisible();
    expect(within(comments).getByText("Note 5")).toBeVisible();

    fireEvent.click(
      within(timeline).getByRole("button", { name: "Show fewer" }),
    );
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(8);
    expect(
      within(timeline).getByRole("button", { name: "Show all 10 events" }),
    ).toBeVisible();
    expect(screen.getByTestId("location").textContent).toBe(locationBefore);
  });

  it("shows no control when the peek already shows everything", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    seedConversation(runtime, human, {
      [item.id]: { comments: 3, events: 8 },
    });

    renderPage(runtime);
    const dialog = await openPeek("Fix login failure");
    const comments = peekSection(dialog, "Recent comments");
    const timeline = peekSection(dialog, "Timeline");

    await waitFor(() =>
      expect(within(comments).getAllByRole("listitem")).toHaveLength(3),
    );
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(8);
    expect(
      within(dialog).queryByRole("button", { name: /^Show all/u }),
    ).not.toBeInTheDocument();
  });

  it("expands without asking TeamHub for anything", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    seedConversation(runtime, human, {
      [item.id]: { comments: 5, events: 10 },
    });

    renderPage(runtime);
    const dialog = await openPeek("Fix login failure");
    const comments = peekSection(dialog, "Recent comments");
    const timeline = peekSection(dialog, "Timeline");
    const commentsRequests = runtime.server.requestsTo(
      "GET",
      COMMENTS_PATH,
    ).length;
    const timelineRequests = runtime.server.requestsTo(
      "GET",
      TIMELINE_PATH,
    ).length;

    fireEvent.click(
      await within(comments).findByRole("button", {
        name: "Show all 5 comments",
      }),
    );
    fireEvent.click(
      within(timeline).getByRole("button", { name: "Show all 10 events" }),
    );

    expect(within(comments).getAllByRole("listitem")).toHaveLength(5);
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(10);
    expect(runtime.server.requestsTo("GET", COMMENTS_PATH)).toHaveLength(
      commentsRequests,
    );
    expect(runtime.server.requestsTo("GET", TIMELINE_PATH)).toHaveLength(
      timelineRequests,
    );
  });

  it("starts another Item collapsed after the first was expanded", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const first = workItem(human, { title: "Fix login failure" });
    const second = workItem(human, {
      id: "workitem-settings",
      number: 43,
      title: "Ship settings",
    });
    seedWorkItems(runtime, [first, second]);
    seedConversation(runtime, human, {
      [first.id]: { comments: 5, events: 10 },
      [second.id]: { comments: 5, events: 10 },
    });

    renderPage(runtime);
    const dialog = await openPeek("Fix login failure");
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: "Show all 5 comments",
      }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Show fewer" }),
    ).toBeVisible();

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    const reopened = await openPeek("Ship settings");
    const comments = peekSection(reopened, "Recent comments");
    expect(
      await within(comments).findByRole("button", {
        name: "Show all 5 comments",
      }),
    ).toBeVisible();
    expect(
      within(reopened).queryByRole("button", { name: "Show fewer" }),
    ).not.toBeInTheDocument();
    expect(within(comments).getAllByRole("listitem")).toHaveLength(3);
  });

  it("links to the work Room when present and omits the link otherwise", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        id: "workitem-with-room",
        title: "Work with room",
        work_room_id: "room-login",
      }),
      workItem(human, {
        id: "workitem-without-room",
        number: 43,
        title: "Work without room",
      }),
    ]);

    renderPage(runtime);
    const withoutRoom = await openPeek("Work without room");
    expect(
      within(withoutRoom).queryByRole("link", { name: "Open work Room" }),
    ).not.toBeInTheDocument();
    fireEvent(
      withoutRoom,
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    const withRoom = await openPeek("Work with room");
    const roomLink = within(withRoom).getByRole("link", {
      name: "Open work Room",
    });
    expect(roomLink).toHaveAttribute(
      "href",
      "/t/tenant-northstar/rooms/room-login/chat",
    );
    fireEvent.click(roomLink);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/rooms/room-login/chat",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("unassigns another assignee from its row action", async () => {
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
    const dialog = await openPeek("Fix login failure");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Unassign Codex" }),
    );

    await waitFor(() =>
      expect(runtime.server.requestsTo("DELETE", ASSIGNMENT_PATH)).toHaveLength(
        1,
      ),
    );
    const [request] = runtime.server.requestsTo("DELETE", ASSIGNMENT_PATH);
    expect(new URL(request!.url).pathname).toBe(
      `/v0/work-items/workitem-login/assignments/${agent.id}`,
    );
    await waitFor(() => expect(within(dialog).queryByText("Codex")).toBeNull());
    expect(within(dialog).getByText(human.display_name)).toBeVisible();
  });

  it("closes an open Work Item as not planned into the Closed column", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(human, { title: "Fix login failure" });
    seedWorkItems(runtime, [item]);
    const posted: unknown[] = [];
    runtime.server.on("POST", TRANSITION_PATH, ({ body }) => {
      posted.push(body);
      const updated: TeamHubWorkItem = {
        ...item,
        resolution: "not_planned",
        state: "resolved",
        updated_at: "2026-07-30T12:00:00Z",
        version: 2,
      };
      runtime.seed.workItems = [updated];
      return updated;
    });

    renderPage(runtime);
    const dialog = await openPeek("Fix login failure");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close as not planned" }),
    );

    await waitFor(() =>
      expect(posted).toEqual([
        { expected_version: 1, resolution: "not_planned", state: "resolved" },
      ]),
    );
    expect(
      await within(dialog).findByText("Resolved · Not planned"),
    ).toBeVisible();
    const closed = await screen.findByRole("region", { name: "Closed" });
    expect(await within(closed).findByText("Fix login failure")).toBeVisible();
  });

  it("applies consistent danger and warning priority tokens inside the peek", async () => {
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    seedWorkItems(runtime, [
      workItem(human, {
        id: "workitem-urgent",
        priority: "urgent",
        title: "Urgent outage",
      }),
      workItem(human, {
        id: "workitem-high",
        priority: "high",
        title: "High priority item",
      }),
    ]);
    seedConversation(runtime, human, {});

    renderPage(runtime);

    const urgentDialog = await openPeek("Urgent outage");
    const urgentBadge = within(urgentDialog).getByText("urgent");
    expect(urgentBadge).toHaveAttribute("data-priority", "urgent");
    expect(urgentBadge).toHaveClass(
      "bg-(--app-status-danger-surface)",
      "text-(--app-status-danger-text)",
    );
    fireEvent.click(
      within(urgentDialog).getByRole("button", { name: "Close" }),
    );

    const highDialog = await openPeek("High priority item");
    const highBadge = within(highDialog).getByText("high");
    expect(highBadge).toHaveAttribute("data-priority", "high");
    expect(highBadge).toHaveClass(
      "bg-(--app-status-warning-surface)",
      "text-(--app-status-warning-text)",
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
              <Route
                element={<p>Work item full page</p>}
                path="/t/:tenantId/work-items/:workItemId"
              />
              <Route
                element={<p>Work Room chat</p>}
                path="/t/:tenantId/rooms/:roomId/chat"
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

async function openAssigneePicker(peek: HTMLElement) {
  fireEvent.click(within(peek).getByRole("button", { name: "Assign someone" }));
  return screen.findByRole("dialog", { name: "Assign someone" });
}

async function openPeek(title: string) {
  fireEvent.click(await screen.findByRole("link", { name: new RegExp(title) }));
  return screen.findByRole("dialog", { name: title });
}

function peekSection(peek: HTMLElement, name: string) {
  return within(peek).getByRole("region", { name });
}

/** Answers the peek's comment and timeline reads for each Item by count. */
function seedConversation(
  runtime: TestTeamHubRuntime,
  author: TeamHubWorkItem["created_by"],
  entries: Record<string, { comments: number; events: number }>,
) {
  const countsFor = (workItemId: string) =>
    entries[workItemId] ?? { comments: 0, events: 0 };
  runtime.server.on("GET", COMMENTS_PATH, ({ params }) => {
    const workItemId = params.workItemId ?? "";
    return {
      items: Array.from(
        { length: countsFor(workItemId).comments },
        (_, index) =>
          comment(
            workItemId,
            author,
            `Note ${index + 1}`,
            `2026-07-30T10:${String(index).padStart(2, "0")}:00Z`,
          ),
      ),
      page: { has_more: false },
    };
  });
  runtime.server.on("GET", TIMELINE_PATH, ({ params }) => {
    const workItemId = params.workItemId ?? "";
    return {
      items: Array.from({ length: countsFor(workItemId).events }, (_, index) =>
        timelineActivity(workItemId, author, {
          id: `activity-${index}`,
          kind: "metadata_updated",
          occurred_at: `2026-07-30T09:${String(index).padStart(2, "0")}:00Z`,
        }),
      ),
      page: { has_more: false },
    };
  });
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
