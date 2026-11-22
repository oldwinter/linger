import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import {
  calendarMonths,
  formatMeetingDay,
  formatMeetingWhen,
} from "./meetings-calendar";
import { MeetingsPanel } from "./meetings-panel";

const words = zhCN.meetings;
const entry = {
  id: "meeting_000000000000000000000001",
  kind: "meeting",
  title: "Meeting 09-05-00",
  path: "Meetings/2026/10/01/Meeting 09-05-00",
  content: "",
  summary: "",
  updated_at: "2026-10-01T08:00:00Z",
  meeting: {
    capture_id: "capture_1",
    started_at: "2026-10-01T08:00:00Z",
    recording_document_id: "audio",
    recording_version_id: "audio_v1",
    recording_filename: "morning.m4a",
    transcript_document_id: "transcript",
    transcript_version_id: "transcript_v1",
    summary_ready: true,
  },
} satisfies TeamHubMemoryEntry;

function chinese(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("zh-CN", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 9, 1)));
}

function renderPanel() {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/memory", () => ({
    items: [entry],
  }));
  const router = createMemoryRouter(
    [
      {
        element: <MeetingsPanel tenantId="tenant-1" />,
        path: "/t/:tenantId/library",
      },
    ],
    { initialEntries: ["/t/tenant-1/library?tab=meetings&meetings=all"] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

describe("Meetings in the language on screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 16:00 local time on 2026-10-01.
    vi.setSystemTime(new Date(2026, 9, 1, 16));
  });
  afterEach(() => {
    vi.useRealTimers();
    resetLanguageForTest();
  });

  it("keeps the English dates and writes them the Chinese way after a switch", async () => {
    expect(formatMeetingDay("2026-10-01")).toBe("Thu, Oct 1");
    expect(formatMeetingWhen("2026-10-01", "09:05:00")).toBe("Oct 1, 09:05");
    await setLanguage("zh-CN");
    const day = chinese({ day: "numeric", month: "short" });
    expect(formatMeetingDay("2026-10-01")).toBe(
      chinese({ day: "numeric", month: "short", weekday: "short" }),
    );
    expect(formatMeetingWhen("2026-10-01", "09:05:00")).toBe(
      words.whenFormat.replace("{day}", day).replace("{time}", "09:05"),
    );
    expect(calendarMonths("2026-10-01", new Map()).at(-1)!.label).toBe(
      chinese({ month: "short" }),
    );
  });

  it("names the range, the day and each meeting again when the language changes", async () => {
    await setLanguage("zh-CN");
    renderPanel();
    const when = words.whenFormat
      .replace("{day}", chinese({ day: "numeric", month: "short" }))
      .replace("{time}", "09:05");
    const name = words.meetingNamed.replace("{when}", when);
    expect(await screen.findByRole("link", { name })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: words.rangeAll })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("button", {
        name: words.deleteNamed.replace("{name}", name),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: words.calendar }),
    ).toHaveTextContent(chinese({ month: "short" }));

    await act(() => setLanguage("en"));
    expect(
      screen.getByRole("link", { name: "Meeting Oct 1, 09:05" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Meeting calendar" }),
    ).toHaveTextContent("Oct");
    expect(
      screen.getByRole("button", { name: /^Thu, Oct 1 · Today/ }),
    ).toBeInTheDocument();
  });
});
