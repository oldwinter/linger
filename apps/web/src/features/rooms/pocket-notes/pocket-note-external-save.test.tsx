import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { PocketNoteLauncher } from "./pocket-note-launcher";
import { storeTodayPocketNote } from "./pocket-note-queries";

const tenantId = "tenant-1";
const today = "2026-10-01";
const savedFromMenu = "Morning\n\n> Alice\n>\n> Hello";

function renderLauncher(storedText: string) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", "/v0/tenants/{tenantId}/me/pocket-notes", () => ({
    items: [
      { date: today, text: storedText, updated_at: "2026-10-01T09:00:00Z" },
    ],
    page: { has_more: false },
    today,
  }));
  runtime.server.on(
    "PUT",
    "/v0/tenants/{tenantId}/me/pocket-notes/today",
    ({ body }) => {
      const { text } = body as { text: string };
      return { date: today, text, updated_at: "2026-10-01T10:00:00Z" };
    },
  );
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <PocketNoteLauncher tenantId={tenantId} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { queryClient };
}

/** The editor keeps one paragraph per Markdown line, empty lines included. */
function editorLines(editor: HTMLElement) {
  return [...editor.querySelectorAll("p")].map((line) => line.textContent);
}

async function openToday() {
  fireEvent.click(screen.getByRole("button", { name: "Pocket Notes" }));
  return screen.findByRole("textbox", { name: "Today’s note" });
}

describe("A save from the Message menu while the notepad is open", () => {
  // JSDOM has no text-range layout; browser coverage exercises caret scrolling.
  beforeEach(() => {
    Object.defineProperties(Range.prototype, {
      getClientRects: { configurable: true, value: () => [] },
      getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
    });
  });

  // Keep real lazy-module preparation outside the interaction wait budget.
  beforeAll(async () => {
    await import("./pocket-note-panel");
  }, 30_000);

  it("shows the appended block when nothing is unsaved", async () => {
    const { queryClient } = renderLauncher("Morning");
    const editor = await openToday();
    expect(editorLines(editor)).toEqual(["Morning"]);

    act(() => {
      storeTodayPocketNote(queryClient, tenantId, {
        date: today,
        text: savedFromMenu,
        updated_at: "2026-10-01T10:00:00Z",
      });
    });

    await waitFor(() =>
      expect(editorLines(editor)).toEqual([
        "Morning",
        "",
        "> Alice",
        ">",
        "> Hello",
      ]),
    );
  });

  it("keeps an unsaved draft and adds only the appended block", async () => {
    const { queryClient } = renderLauncher("");
    const editor = await openToday();

    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "Draft line" : ""),
      },
    });
    act(() => {
      storeTodayPocketNote(queryClient, tenantId, {
        date: today,
        text: "> Alice\n>\n> Hello",
        updated_at: "2026-10-01T10:00:00Z",
      });
    });

    await waitFor(() =>
      expect(editorLines(editor)).toEqual([
        "Draft line",
        "",
        "> Alice",
        ">",
        "> Hello",
      ]),
    );
  });
});
