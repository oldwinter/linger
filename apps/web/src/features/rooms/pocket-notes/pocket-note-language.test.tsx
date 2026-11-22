// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubPocketNotePage } from "@/features/teamhub/teamhub-types";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { closePocketNote } from "./pocket-note-hold";
import { PocketNoteHost } from "./pocket-note-host";
import { PocketNoteLauncher } from "./pocket-note-launcher";

const words = zhCN.pocketNotes;
const page: TeamHubPocketNotePage = {
  items: [
    {
      date: "2026-09-30",
      text: "Yesterday's idea",
      updated_at: "2026-09-30T10:00:00Z",
    },
  ],
  page: { has_more: false },
  today: "2026-10-01",
};

function chineseDay(month: number, day: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, month - 1, day)));
}

function renderLauncher() {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on(
    "GET",
    "/v0/tenants/{tenantId}/me/pocket-notes",
    () => page,
  );
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <TeamHubRuntimeProvider runtime={runtime}>
          <PocketNoteLauncher tenantId="tenant-1" />
          <PocketNoteHost />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Pocket Notes in the language on screen", () => {
  beforeAll(async () => {
    await import("./pocket-note-panel");
  }, 30_000);
  beforeEach(() => {
    closePocketNote();
    // JSDOM has no text-range layout.
    Object.defineProperties(Range.prototype, {
      getClientRects: { configurable: true, value: () => [] },
      getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
    });
  });
  afterEach(() => {
    closePocketNote();
    resetLanguageForTest();
  });

  it("names today's page and renames it in place when the language changes", async () => {
    await setLanguage("zh-CN");
    renderLauncher();
    fireEvent.click(
      screen.getByRole("button", { name: zhCN.roomList.pocketNotes }),
    );
    const editor = await screen.findByRole("textbox", {
      name: words.todayNote,
    });
    expect(editor).toHaveAttribute("data-placeholder", words.placeholder);
    expect(
      screen.getByText(words.todayTitle.replace("{date}", chineseDay(10, 1))),
    ).toBeInTheDocument();

    await act(() => setLanguage("en"));
    expect(screen.getByRole("textbox", { name: "Today’s note" })).toBe(editor);
    expect(screen.getByText("Today · Oct 1")).toBeInTheDocument();
  });

  it("counts the pages and dates the earlier ones", async () => {
    await setLanguage("zh-CN");
    renderLauncher();
    fireEvent.click(
      screen.getByRole("button", { name: zhCN.roomList.pocketNotes }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: words.allNotes }),
    );
    expect(
      screen.getByText(words.pageCount.other.replace("{count}", "1")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: words.deletePage.replace("{page}", chineseDay(9, 30)),
      }),
    ).toBeInTheDocument();
  });
});
