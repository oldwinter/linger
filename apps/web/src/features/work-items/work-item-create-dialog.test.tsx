import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";

import { WorkItemCreateAction } from "./work-item-create-dialog";
import {
  tenantWorkItemsDashboardQueryPrefix,
  tenantWorkItemTargetQueryKey,
} from "./work-item-queries";

const WORK_ITEMS_PATH = "/v0/tenants/{tenantId}/work-items";

const rooms = [
  { id: "room-design", kind: "room" as const, name: "Design" },
  { id: "room-release", kind: "room" as const, name: "Release" },
  { id: "room-thread", kind: "thread" as const, name: "Release thread" },
];

describe("Work Item creation", () => {
  it("requires a title and posts the trimmed dialog values", async () => {
    const runtime = createTestTeamHubRuntime();
    const create = vi.fn<TestRouteHandler>(() => createdWorkItem({}));
    runtime.server.on("POST", WORK_ITEMS_PATH, create);
    renderAction(runtime);

    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    const dialog = screen.getByRole("dialog", { name: "New issue" });
    const submit = screen.getByRole("button", { name: "Create issue" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "   " },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "t".repeat(241) },
    });
    expect(
      within(dialog).getByText("A title can be at most 240 characters long."),
    ).toBeVisible();
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "  Login is broken  " },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  Steps to reproduce  " },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Issue priority" }));
    fireEvent.click(await screen.findByRole("option", { name: "High" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Origin Room" }));
    await screen.findByRole("option", { name: "#Design" });
    expect(
      screen.queryByRole("option", { name: "#Release thread" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "#Design" }));
    fireEvent.click(submit);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].body).toEqual({
      description: "Steps to reproduce",
      kind: "issue",
      origin_room_id: "room-design",
      priority: "high",
      title: "Login is broken",
    });
    expect(
      create.mock.calls[0]![0].request.headers.get("Idempotency-Key"),
    ).toMatch(/^web:/u);
  });

  it("sends no origin Room when none is chosen", async () => {
    const runtime = createTestTeamHubRuntime();
    const create = vi.fn<TestRouteHandler>(() => createdWorkItem({}));
    runtime.server.on("POST", WORK_ITEMS_PATH, create);
    renderAction(runtime);

    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Login is broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].body).toEqual({
      description: "",
      kind: "issue",
      priority: "medium",
      title: "Login is broken",
    });
  });

  it("replays one idempotency key for the same content and starts a new key otherwise", async () => {
    const runtime = createTestTeamHubRuntime();
    const create = vi.fn<TestRouteHandler>(() => {
      throw new Error("Connection closed before confirmation.");
    });
    runtime.server.on("POST", WORK_ITEMS_PATH, create);
    renderAction(runtime);

    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Login is broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    await screen.findByText(/did not confirm whether the issue was created/u);

    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Login is broken again" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and close" }));
    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Login is broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(4));

    const keys = create.mock.calls.map(([request]) =>
      request.request.headers.get("Idempotency-Key"),
    );
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[1]);
  });

  it.each(["Escape", "Close"])(
    "keeps entered issue details when %s is dismissed without discarding",
    async (action) => {
      const runtime = createTestTeamHubRuntime();
      renderAction(runtime);
      fireEvent.click(screen.getByRole("button", { name: "New issue" }));
      const dialog = screen.getByRole("dialog", { name: "New issue" });
      const description = screen.getByLabelText("Description");
      fireEvent.change(screen.getByLabelText("Title"), {
        target: { value: "Review keyboard navigation" },
      });
      fireEvent.change(description, {
        target: { value: "Keep the reproduction details and expected focus." },
      });
      fireEvent.click(screen.getByRole("combobox", { name: "Issue priority" }));
      fireEvent.click(await screen.findByRole("option", { name: "High" }));
      fireEvent.click(screen.getByRole("combobox", { name: "Origin Room" }));
      fireEvent.click(await screen.findByRole("option", { name: "#Design" }));
      description.focus();

      if (action === "Escape") {
        fireEvent(dialog, new Event("cancel", { cancelable: true }));
      } else {
        fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      }
      const confirmation = screen.getByRole("dialog", {
        name: "Discard new issue details?",
      });
      expect(confirmation).toBeVisible();
      expect(
        within(confirmation).getByRole("button", { name: "Continue editing" }),
      ).toHaveFocus();
      fireEvent(confirmation, new Event("cancel", { cancelable: true }));

      expect(
        screen.queryByRole("dialog", { name: "Discard new issue details?" }),
      ).toBeNull();
      expect(screen.getByLabelText("Title")).toHaveValue(
        "Review keyboard navigation",
      );
      expect(description).toHaveValue(
        "Keep the reproduction details and expected focus.",
      );
      expect(
        screen.getByRole("combobox", { name: "Issue priority" }),
      ).toHaveTextContent("High");
      expect(
        screen.getByRole("combobox", { name: "Origin Room" }),
      ).toHaveTextContent("#Design");
      await waitFor(() => expect(description).toHaveFocus());
    },
  );

  it("closes an untouched issue immediately and clears a draft only after discard", () => {
    const runtime = createTestTeamHubRuntime();
    renderAction(runtime);
    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    fireEvent(
      screen.getByRole("dialog", { name: "New issue" }),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Details written before choosing a title." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("guards immediate repeat submit and close, then retains the failed draft for the same retry", async () => {
    const runtime = createTestTeamHubRuntime();
    let release = () => {};
    const create = vi.fn<TestRouteHandler>(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              teamHubErrorResponse(
                503,
                "SERVICE_UNAVAILABLE",
                "The service is temporarily unavailable.",
              ),
            );
        }),
    );
    runtime.server.on("POST", WORK_ITEMS_PATH, create);
    renderAction(runtime);
    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    const dialog = screen.getByRole("dialog", { name: "New issue" });
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, {
      target: { value: "Review keyboard navigation" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The draft must stay available after this request." },
    });

    act(() => {
      fireEvent.submit(title.closest("form")!);
      fireEvent.submit(title.closest("form")!);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    });
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(dialog).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(
      screen.getByText("Wait for issue creation to finish before closing."),
    ).toHaveAttribute("role", "status");
    expect(
      screen.queryByRole("dialog", { name: "Discard new issue details?" }),
    ).toBeNull();

    release();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The service is temporarily unavailable.",
    );
    expect(title).toBeEnabled();
    expect(title).toHaveValue("Review keyboard navigation");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "The draft must stay available after this request.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
    create.mockImplementation(() => createdWorkItem({}));
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/t/tenant-northstar/dashboard/workitem-created",
      ),
    );
    expect(create).toHaveBeenCalledTimes(2);
    const [first, retry] = create.mock.calls.map(([request]) => request);
    expect(retry!.body).toEqual(first!.body);
    expect(retry!.request.headers.get("Idempotency-Key")).toBe(
      first!.request.headers.get("Idempotency-Key"),
    );
  });

  it("opens the created issue and refreshes the board and its target", async () => {
    const runtime = createTestTeamHubRuntime();
    const create = vi.fn<TestRouteHandler>(() =>
      createdWorkItem({ id: "workitem-created", title: "Login is broken" }),
    );
    runtime.server.on("POST", WORK_ITEMS_PATH, create);
    const queryClient = renderAction(runtime);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Login is broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/t/tenant-northstar/dashboard/workitem-created",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: tenantWorkItemsDashboardQueryPrefix("tenant-northstar"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: tenantWorkItemTargetQueryKey(
        "tenant-northstar",
        "workitem-created",
      ),
    });
  });

  it("keeps the dialog and the entered values when TeamHub refuses the issue", async () => {
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("POST", WORK_ITEMS_PATH, () =>
      teamHubErrorResponse(
        409,
        "WORK_ITEM_CONFLICT",
        "An open issue with this title already exists.",
      ),
    );
    renderAction(runtime);

    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Login is broken" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Steps to reproduce" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));

    expect(
      await screen.findByText("An open issue with this title already exists."),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByRole("dialog", { name: "New issue" })).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Login is broken");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Steps to reproduce",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-northstar/dashboard",
    );
  });
});

function renderAction(runtime: TestTeamHubRuntime) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={["/t/tenant-northstar/dashboard"]}>
          <Routes>
            <Route
              element={
                <WorkItemCreateAction
                  rooms={rooms}
                  tenantId="tenant-northstar"
                />
              }
              path="/t/:tenantId/dashboard"
            />
            <Route
              element={<p>Opened issue</p>}
              path="/t/:tenantId/dashboard/:workItemId"
            />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function createdWorkItem(override: Partial<TeamHubWorkItem>): TeamHubWorkItem {
  const actor: TeamHubWorkItem["created_by"] = {
    display_name: "Jenny Bin",
    id: "actor-jenny",
    kind: "human",
    tenant_id: "tenant-northstar",
  };
  return {
    assignees: [],
    created_at: "2026-08-01T00:00:00Z",
    created_by: actor,
    description: "",
    explicit_access_grants: [],
    id: "workitem-created",
    kind: "issue",
    number: 43,
    priority: "medium",
    referenced_actors: [],
    state: "open",
    tenant_id: "tenant-northstar",
    title: "Login is broken",
    updated_at: "2026-08-01T00:00:00Z",
    updated_by: actor,
    version: 1,
    ...override,
  };
}
