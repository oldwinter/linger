import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubPocketNote,
  TeamHubPocketNotePage,
} from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import PocketNotePanel from "./pocket-note-panel";

const download = vi.hoisted(() => ({ triggerArtifactDownload: vi.fn() }));

vi.mock("../files/artifact-preview-loader", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../files/artifact-preview-loader")
  >()),
  triggerArtifactDownload: download.triggerArtifactDownload,
}));

beforeEach(() => {
  // JSDOM has no text-range layout; browser coverage exercises the editor.
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  download.triggerArtifactDownload.mockReset();
});

function note(date: string, text: string): TeamHubPocketNote {
  return { date, text, updated_at: `${date}T10:00:00Z` };
}

function page(
  items: TeamHubPocketNote[],
  next?: string,
): TeamHubPocketNotePage {
  return {
    items,
    page: next ? { has_more: true, next_cursor: next } : { has_more: false },
    today: "2026-10-01",
  };
}

/** Renders the panel on its today page, with the list it will open. */
function renderPanel(listPocketNotes: (cursor: string | undefined) => unknown) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on(
    "GET",
    "/v0/tenants/{tenantId}/me/pocket-notes",
    ({ query }) => listPocketNotes(query.get("cursor") ?? undefined),
  );
  const anchorRef: RefObject<HTMLButtonElement | null> = {
    current: document.createElement("button"),
  };
  const closeRef: RefObject<(() => void) | undefined> = { current: undefined };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <PocketNotePanel
          anchorRef={anchorRef}
          closeRef={closeRef}
          onClose={() => undefined}
          tenantId="tenant-1"
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

async function openAllNotes() {
  fireEvent.click(await screen.findByRole("button", { name: "All notes" }));
}

describe("PocketNotePanel download", () => {
  it("saves every page as one Markdown file", async () => {
    const listPocketNotes = vi.fn(async (cursor: string | undefined) =>
      cursor
        ? page([note("2026-09-01", "Older idea")])
        : page(
            [
              note("2026-10-01", "First note"),
              note("2026-09-30", "Yesterday's idea"),
            ],
            "2026-09-30",
          ),
    );
    renderPanel(listPocketNotes);
    await openAllNotes();
    fireEvent.click(screen.getByRole("button", { name: "Download all" }));

    await waitFor(() =>
      expect(download.triggerArtifactDownload).toHaveBeenCalledOnce(),
    );
    const [blob, filename] = download.triggerArtifactDownload.mock.calls[0] as [
      Blob,
      string,
    ];
    expect(filename).toBe("pocket-notes.md");
    expect(await blob.text()).toBe(
      [
        "# Pocket Notes",
        "## 2026-10-01",
        "First note",
        "## 2026-09-30",
        "Yesterday's idea",
        "## 2026-09-01",
        "Older idea",
      ].join("\n\n"),
    );
    expect(listPocketNotes.mock.calls).toEqual([[undefined], ["2026-09-30"]]);
  });

  it("waits for the remaining pages before saving", async () => {
    let finish!: (page: TeamHubPocketNotePage) => void;
    const listPocketNotes = vi.fn((cursor: string | undefined) =>
      cursor
        ? new Promise<TeamHubPocketNotePage>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(
            page([note("2026-09-30", "Yesterday's idea")], "2026-09-30"),
          ),
    );
    renderPanel(listPocketNotes);
    await openAllNotes();
    fireEvent.click(screen.getByRole("button", { name: "Download all" }));

    await waitFor(() =>
      expect(listPocketNotes).toHaveBeenLastCalledWith("2026-09-30"),
    );
    expect(screen.getByRole("button", { name: "Download all" })).toBeDisabled();
    expect(download.triggerArtifactDownload).not.toHaveBeenCalled();

    finish(page([note("2026-09-01", "Older idea")]));
    await waitFor(() =>
      expect(download.triggerArtifactDownload).toHaveBeenCalledOnce(),
    );
    expect(screen.getByRole("button", { name: "Download all" })).toBeEnabled();
  });

  it("reports a failed page load and saves nothing", async () => {
    const listPocketNotes = vi.fn((cursor: string | undefined) =>
      cursor
        ? teamHubErrorResponse(503, "POCKET_NOTES_UNAVAILABLE")
        : page([note("2026-09-30", "Yesterday's idea")], "2026-09-30"),
    );
    renderPanel(listPocketNotes);
    await openAllNotes();
    fireEvent.click(screen.getByRole("button", { name: "Download all" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t download notes. Try again.",
    );
    expect(download.triggerArtifactDownload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Download all" })).toBeEnabled();
  });

  it("offers no download when there are no pages", async () => {
    renderPanel(async () => page([]));
    await openAllNotes();

    expect(
      screen.queryByRole("button", { name: "Download all" }),
    ).not.toBeInTheDocument();
  });
});
