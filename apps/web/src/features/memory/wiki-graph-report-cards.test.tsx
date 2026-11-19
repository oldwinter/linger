import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { defineGlobalProperty } from "@/test/global-properties";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { WikiGraphReportCards } from "./wiki-graph-report-cards";
import type { NodeMoment } from "./wiki-graph-model";

afterEach(() => vi.restoreAllMocks());

// No reports exist yet: the lists are cached fresh, so nothing is fetched.
function noReportsWrapper() {
  const queryClient = new QueryClient();
  for (const kind of ["daily", "weekly"]) {
    queryClient.setQueryData(
      ["teamhub", "tenant-northstar", "personal-memory", `${kind}-entries`],
      [],
    );
  }
  const runtime = createTestTeamHubRuntime();
  return function NoReports({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TeamHubRuntimeProvider runtime={runtime}>
          {children}
        </TeamHubRuntimeProvider>
      </QueryClientProvider>
    );
  };
}

it("preserves the requested card on resize and observes each mounted track only once", () => {
  defineGlobalProperty(HTMLElement.prototype, "scrollTo", { value: vi.fn() });
  const observers: {
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.spyOn(globalThis, "ResizeObserver").mockImplementation(
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, ...this });
      }
    },
  );
  const props = {
    tenantId: "tenant-northstar",
    pages: [
      {
        id: "topic",
        title: "Topic",
        category: "Topic",
        body: "",
        description: "",
        tags: [],
        links: [],
        backlinks: [],
        size: 1,
      },
    ],
    moments: new Map<string, NodeMoment[]>([
      ["topic", [{ day: "2026-09-01", strength: "event" }]],
    ]),
    onSelectReport: vi.fn(),
    onPeriodChange: vi.fn(),
  };
  const view = render(<WikiGraphReportCards {...props} granularity="day" />, {
    wrapper: noReportsWrapper(),
  });
  expect(screen.queryByText("Attachment")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Topic" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getAllByRole("button", { name: /Open Daily for/ })[0]!,
  );
  expect(props.onSelectReport).toHaveBeenCalled();
  const track = screen.getByLabelText("Daily cards", { exact: true });
  const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
  scrollTo.mockClear();
  track.style.paddingLeft = "24px";
  let width = 800;
  Object.defineProperty(track, "clientWidth", { get: () => width });
  const card = screen.getAllByRole("article").at(-1)!.parentElement!;
  Object.defineProperty(card, "offsetLeft", { get: () => width + 24 });
  const observer = observers[0]!;
  expect(observer.observe).toHaveBeenCalledWith(track);

  const nextPeriodChange = vi.fn();
  view.rerender(
    <WikiGraphReportCards
      {...props}
      granularity="day"
      onPeriodChange={nextPeriodChange}
    />,
  );
  expect(observers).toHaveLength(1);
  expect(observer.disconnect).not.toHaveBeenCalled();
  act(() => observer.callback([], {} as ResizeObserver));
  expect(scrollTo).toHaveBeenLastCalledWith({
    left: 800,
    behavior: "instant",
  });
  width = 600;
  act(() => observer.callback([], {} as ResizeObserver));
  expect(scrollTo).toHaveBeenLastCalledWith({
    left: 600,
    behavior: "instant",
  });
  fireEvent(track, new Event("scrollend", { bubbles: true }));
  expect(nextPeriodChange).not.toHaveBeenCalled();

  view.rerender(
    <WikiGraphReportCards {...props} pages={[]} granularity="day" />,
  );
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Daily cards", { exact: true })).toBeNull();
  view.rerender(<WikiGraphReportCards {...props} granularity="week" />);
  expect(screen.queryByText("Attachment")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Topic" }),
  ).not.toBeInTheDocument();
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  expect(observers).toHaveLength(2);
  expect(observers[1]!.observe).toHaveBeenCalledWith(
    screen.getByLabelText("Weekly cards", { exact: true }),
  );
  view.unmount();
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  expect(observers[1]!.disconnect).toHaveBeenCalledTimes(1);
});
