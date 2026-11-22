import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineGlobalProperty } from "@/test/global-properties";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubWorkItem,
  TeamHubWorkItemComment,
} from "@/features/teamhub/teamhub-types";

import { WorkItemsPage } from "./work-items-page";

const COMMENTS_PATH = "/v0/work-items/{workItemId}/comments";
const TIMELINE_PATH = "/v0/work-items/{workItemId}/timeline";

const COPY_COMMENTS = "Copy comments";

describe("Copy Work Item comments as Markdown", () => {
  it("copies every comment, not only the three the short view shows", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const maya = runtime.seed.actors.find(
      (actor) => actor.id === "actor-maya",
    )!;
    const item = workItem(runtime);
    seedWorkItems(runtime, [item]);
    seedComments(runtime, item.id, [
      comment(item.id, human, "Reproduced on staging.", "2026-11-14T09:12:00"),
      comment(
        item.id,
        maya,
        "Token refresh was the cause.",
        "2026-11-14T10:30:00",
      ),
      comment(item.id, human, "Patched the refresh.", "2026-11-14T11:05:00"),
      comment(item.id, maya, "Verified on staging.", "2026-11-14T12:40:00"),
      comment(
        item.id,
        human,
        "Shipping with the next release.",
        "2026-11-14T13:15:00",
      ),
    ]);

    const dialog = await openPeek(runtime, "Fix login failure");
    expect(
      await within(dialog).findByText("Shipping with the next release."),
    ).toBeVisible();
    expect(
      within(dialog).queryByText("Reproduced on staging."),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: COPY_COMMENTS }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "# Fix login failure",
          "**Jenny Bin** · 2026-11-14 13:15",
          "Shipping with the next release.",
          "**Maya Chen** · 2026-11-14 12:40",
          "Verified on staging.",
          "**Jenny Bin** · 2026-11-14 11:05",
          "Patched the refresh.",
          "**Maya Chen** · 2026-11-14 10:30",
          "Token refresh was the cause.",
          "**Jenny Bin** · 2026-11-14 09:12",
          "Reproduced on staging.",
        ].join("\n\n"),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(dialog).toBeVisible();
  });

  it("disables the action until the comments arrive", async () => {
    stubClipboard(() => Promise.resolve());
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(runtime);
    seedWorkItems(runtime, [item]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runtime.server.on("GET", COMMENTS_PATH, async () => {
      await gate;
      return {
        items: [comment(item.id, human, "Late note.", "2026-11-14T09:12:00")],
        page: { has_more: false },
      };
    });

    const dialog = await openPeek(runtime, "Fix login failure");
    const copyButton = within(dialog).getByRole("button", {
      name: COPY_COMMENTS,
    });
    expect(copyButton).toBeDisabled();

    release();
    await waitFor(() => expect(copyButton).toBeEnabled());
  });

  it("disables the action when the Item has no comments", async () => {
    stubClipboard(() => Promise.resolve());
    const runtime = await testRuntime();
    const item = workItem(runtime);
    seedWorkItems(runtime, [item]);
    seedComments(runtime, item.id, []);

    const dialog = await openPeek(runtime, "Fix login failure");
    expect(await within(dialog).findByText("No comments yet.")).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: COPY_COMMENTS }),
    ).toBeDisabled();
  });

  it("says the copy failed instead of claiming success", async () => {
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    defineGlobalProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    const runtime = await testRuntime();
    const human = runtime.seed.identity.actors[0]!;
    const item = workItem(runtime);
    seedWorkItems(runtime, [item]);
    seedComments(runtime, item.id, [
      comment(item.id, human, "Reproduced on staging.", "2026-11-14T09:12:00"),
    ]);

    const dialog = await openPeek(runtime, "Fix login failure");
    await within(dialog).findByText("Reproduced on staging.");
    fireEvent.click(
      within(dialog).getByRole("button", { name: COPY_COMMENTS }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
  });
});

async function testRuntime() {
  return createTestTeamHubRuntime();
}

async function openPeek(runtime: TestTeamHubRuntime, title: string) {
  renderPage(runtime);
  fireEvent.click(await screen.findByRole("link", { name: new RegExp(title) }));
  return screen.findByRole("dialog", { name: title });
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

function stubClipboard(writeText: () => Promise<void>) {
  const write = vi.fn(writeText);
  Object.assign(navigator, { clipboard: { writeText: write } });
  return write;
}

function seedComments(
  runtime: TestTeamHubRuntime,
  workItemId: string,
  comments: TeamHubWorkItemComment[],
) {
  runtime.server.on("GET", COMMENTS_PATH, () => ({
    items: comments.filter((comment) => comment.work_item_id === workItemId),
    page: { has_more: false },
  }));
  runtime.server.on("GET", TIMELINE_PATH, () => ({
    items: [],
    page: { has_more: false },
  }));
}

function workItem(
  runtime: TestTeamHubRuntime,
  override: Partial<TeamHubWorkItem> = {},
): TeamHubWorkItem {
  const actor = runtime.seed.identity.actors[0]!;
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

function seedWorkItems(runtime: TestTeamHubRuntime, items: TeamHubWorkItem[]) {
  runtime.seed.workItems = items;
}
