import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import type { TestRouteRequest } from "@/test/teamhub-test-server";
import type { TeamHubRoomBackgroundTask } from "@/features/teamhub/teamhub-types";
import {
  BackgroundTasksIndicator,
  BackgroundTasksPill,
  runningFor,
} from "./background-tasks-indicator";

const now = Date.parse("2026-10-28T14:31:00Z");

const tasks: TeamHubRoomBackgroundTask[] = [
  {
    id: "task-1",
    title: "Summarize last week's competitor table",
    requirement: "Find last week's competitor table and write the conclusions.",
    created_at: "2026-10-28T14:05:00Z",
  },
  {
    id: "task-2",
    title: "Draft the launch email to Lena",
    requirement: "Use the November 6 launch date from the recording.",
    created_at: "2026-10-28T14:27:00Z",
  },
];

describe("BackgroundTasksPill", () => {
  it("counts running Tasks and opens a short list of what each one does", () => {
    render(<BackgroundTasksPill now={now} tasks={tasks} />);
    const pill = screen.getByRole("button", {
      name: "2 tasks running in the background",
    });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("region", { name: "Background tasks" }),
    ).toBeNull();

    fireEvent.click(pill);
    const list = screen.getByRole("region", { name: "Background tasks" });
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(
      within(list).getByText("Summarize last week's competitor table"),
    ).toBeVisible();
    expect(
      within(list).getByText(
        "Use the November 6 launch date from the recording.",
      ),
    ).toBeVisible();
    expect(within(list).getByText("26 min")).toBeVisible();
    expect(within(list).getByText("4 min")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("region", { name: "Background tasks" }),
    ).toBeNull();
    fireEvent.click(pill);
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole("region", { name: "Background tasks" }),
    ).toBeNull();
  });

  it("says one task in the singular", () => {
    render(<BackgroundTasksPill now={now} tasks={tasks.slice(0, 1)} />);
    expect(
      screen.getByRole("button", { name: "1 task running in the background" }),
    ).toBeVisible();
  });

  it("refreshes relative timestamps on a 30s interval without recreating it on unrelated rerenders", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    try {
      const start = Date.parse("2026-10-28T14:31:00Z");
      vi.setSystemTime(start);
      const active: TeamHubRoomBackgroundTask[] = [
        {
          id: "task-live",
          title: "Check release notes",
          requirement: "Verify every section",
          created_at: "2026-10-28T14:30:40Z",
        },
      ];
      const view = render(
        <BackgroundTasksPill onOpen={vi.fn()} tasks={active} />,
      );
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

      fireEvent.click(
        screen.getByRole("button", {
          name: "1 task running in the background",
        }),
      );
      expect(screen.getByText("just now")).toBeVisible();

      view.rerender(
        <BackgroundTasksPill onOpen={vi.fn()} tasks={[...active]} />,
      );
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText("1 min")).toBeVisible();

      view.rerender(<BackgroundTasksPill onOpen={vi.fn()} tasks={[]} />);
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

      view.unmount();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      // Restore timer spies first so afterEach does not write fake timers back.
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});

describe("BackgroundTasksIndicator", () => {
  function renderIndicator(items: TeamHubRoomBackgroundTask[]) {
    const { client, server } = createTestTeamHubRuntime();
    let current = items;
    const list = vi.fn(() => ({ items: current }));
    const cancel = vi.fn(({ params }: TestRouteRequest) => {
      current = current.filter((task) => task.id !== params.taskId);
      return { task_id: params.taskId, status: "canceled" };
    });
    server.on("GET", "/v0/rooms/{roomId}/background-tasks", list);
    server.on(
      "POST",
      "/v0/rooms/{roomId}/background-tasks/{taskId}/cancel",
      cancel,
    );
    const view = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <BackgroundTasksIndicator
          client={client}
          roomId="room-1"
          tenantId="tenant-1"
        />
      </QueryClientProvider>,
    );
    return { cancel, list, ...view };
  }

  it("shows nothing when no background Task runs", async () => {
    const { container, list } = renderIndicator([]);
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ params: { roomId: "room-1" } }),
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the pill in normal flow above the composer while Tasks run", async () => {
    renderIndicator(tasks);
    const pill = await screen.findByRole("button", {
      name: "2 tasks running in the background",
    });
    expect(pill).toBeVisible();
    const container = screen.getByTestId("background-tasks-indicator");
    expect(container).not.toHaveClass("h-0");
    expect(pill.parentElement).not.toHaveClass("absolute");
  });

  it("cancels one Task and drops it from the list", async () => {
    const { cancel } = renderIndicator(tasks);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "2 tasks running in the background",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Cancel Draft the launch email to Lena",
      }),
    );
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { roomId: "room-1", taskId: "task-2" },
        }),
      ),
    );
    expect(
      await screen.findByRole("button", {
        name: "1 task running in the background",
      }),
    ).toBeVisible();
  });

  it("prevents default when Escape closes the task list", async () => {
    renderIndicator(tasks);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "2 tasks running in the background",
      }),
    );
    expect(
      screen.getByRole("region", { name: "Background tasks" }),
    ).toBeVisible();

    const escape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Background tasks" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("runningFor", () => {
  it("uses the coarsest unit that fits", () => {
    expect(runningFor("2026-10-28T14:30:30Z", now)).toBe("just now");
    expect(runningFor("2026-10-28T12:00:00Z", now)).toBe("2 h");
    expect(runningFor("2026-10-25T14:31:00Z", now)).toBe("3 d");
  });
});
