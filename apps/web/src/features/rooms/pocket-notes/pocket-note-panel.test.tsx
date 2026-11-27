import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubPocketNote,
  TeamHubPocketNotePage,
} from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import PocketNotePanel from "./pocket-note-panel";

const download = vi.hoisted(() => ({ triggerArtifactDownload: vi.fn() }));
const clipboard = vi.hoisted(() => ({ writeClipboardText: vi.fn() }));

vi.mock("../files/artifact-preview-loader", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../files/artifact-preview-loader")
  >()),
  triggerArtifactDownload: download.triggerArtifactDownload,
}));

vi.mock("@/lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clipboard")>()),
  writeClipboardText: clipboard.writeClipboardText,
}));

beforeEach(() => {
  // JSDOM has no text-range layout; browser coverage exercises the editor.
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  download.triggerArtifactDownload.mockReset();
  clipboard.writeClipboardText.mockReset();
  clipboard.writeClipboardText.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
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
function renderPanel(
  listPocketNotes: (cursor: string | undefined) => unknown,
  putTodayPocketNote?: (text: string) => unknown,
  deletePocketNote?: (date: string) => unknown,
) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on(
    "GET",
    "/v0/tenants/{tenantId}/me/pocket-notes",
    ({ query }) => listPocketNotes(query.get("cursor") ?? undefined),
  );
  if (putTodayPocketNote) {
    runtime.server.on(
      "PUT",
      "/v0/tenants/{tenantId}/me/pocket-notes/today",
      ({ body }) => putTodayPocketNote((body as { text: string }).text),
    );
  }
  if (deletePocketNote) {
    runtime.server.on(
      "DELETE",
      "/v0/tenants/{tenantId}/me/pocket-notes/{noteDate}",
      ({ params }) => deletePocketNote(params.noteDate!),
    );
  }
  const anchor = document.createElement("button");
  const closeRef: RefObject<(() => void) | undefined> = { current: undefined };
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <PocketNotePanel
          anchor={anchor}
          closeRef={closeRef}
          onClose={onClose}
          tenantId="tenant-1"
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { onClose, runtime };
}

async function openAllNotes() {
  fireEvent.click(await screen.findByRole("button", { name: "All notes" }));
}

function pasteText(editor: HTMLElement, text: string) {
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
}

describe("PocketNotePanel previous day", () => {
  it("continues today's page into the newest earlier day", async () => {
    renderPanel(() =>
      page([
        note("2026-10-01", "Today's line"),
        note("2026-09-30", "Yesterday's idea"),
        note("2026-09-01", "Older idea"),
      ]),
    );
    expect(
      await screen.findByRole("textbox", { name: "Today’s note" }),
    ).toHaveTextContent("Today's line");
    expect(screen.getByRole("region", { name: "Sep 30" })).toHaveTextContent(
      "Yesterday's idea",
    );
    expect(screen.queryByText("Older idea")).not.toBeInTheDocument();
  });
});

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

  it("saves one page beside its delete action", async () => {
    renderPanel(async () => page([note("2026-09-30", "Yesterday's idea")]));
    await openAllNotes();
    fireEvent.click(screen.getByRole("button", { name: "Download Sep 30" }));

    expect(download.triggerArtifactDownload).toHaveBeenCalledOnce();
    const [blob, filename] = download.triggerArtifactDownload.mock.calls[0] as [
      Blob,
      string,
    ];
    expect(filename).toBe("pocket-note-2026-09-30.md");
    expect(await blob.text()).toBe("## 2026-09-30\n\nYesterday's idea");
    // The download leaves the delete confirmation closed.
    expect(
      screen.getByRole("button", { name: "Delete Sep 30" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("reports a failed single download and saves nothing", async () => {
    download.triggerArtifactDownload.mockImplementation(() => {
      throw new Error("no object URL");
    });
    renderPanel(async () => page([note("2026-09-30", "Yesterday's idea")]));
    await openAllNotes();
    fireEvent.click(screen.getByRole("button", { name: "Download Sep 30" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t download notes. Try again.",
    );
    expect(download.triggerArtifactDownload).toHaveBeenCalledOnce();
  });

  it("offers no download when there are no pages", async () => {
    renderPanel(async () => page([]));
    await openAllNotes();

    expect(
      screen.queryByRole("button", { name: "Download all" }),
    ).not.toBeInTheDocument();
  });
});

describe("PocketNotePanel search", () => {
  const notes = () => [
    note("2026-10-01", "Shipped the graph preview"),
    note("2026-09-30", "Reviewed the flashback card"),
  ];

  async function openSearch(hasMore = false) {
    renderPanel(async () =>
      hasMore ? page(notes(), "2026-09-30") : page(notes()),
    );
    await openAllNotes();
    return screen.getByRole("searchbox", { name: "Search notes" });
  }

  it("filters the list to notes holding every word and highlights them", async () => {
    const search = await openSearch();
    fireEvent.change(search, { target: { value: "reviewed flashback" } });

    expect(
      screen.queryByText("Shipped the graph preview"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Reviewed the flashback card/ }),
    ).toBeVisible();
    expect(screen.getByText("Reviewed", { selector: "mark" })).toBeVisible();
    expect(screen.getByText("flashback", { selector: "mark" })).toBeVisible();
  });

  it("restores the list when the search is cleared", async () => {
    const search = await openSearch();
    fireEvent.change(search, { target: { value: "flashback" } });
    expect(
      screen.queryByText("Shipped the graph preview"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear note search" }));

    expect(search).toHaveValue("");
    expect(screen.getByText("Shipped the graph preview")).toBeVisible();
    expect(screen.getByText("Reviewed the flashback card")).toBeVisible();
  });

  it("says when nothing matches and still offers earlier notes", async () => {
    const search = await openSearch(true);
    fireEvent.change(search, { target: { value: "nonexistent" } });

    expect(screen.getByText("No notes match “nonexistent”.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Load earlier notes" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.getByText("Shipped the graph preview")).toBeVisible();
    expect(screen.getByText("Reviewed the flashback card")).toBeVisible();
  });
});

describe("PocketNotePanel month groups", () => {
  it("heads each month's cards with its month", async () => {
    renderPanel(async () =>
      page([
        note("2026-10-01", "First note"),
        note("2026-09-30", "Yesterday's idea"),
        note("2026-09-01", "Older idea"),
      ]),
    );
    await openAllNotes();

    const headings = screen.getAllByRole("heading");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "October 2026",
      "September 2026",
    ]);
    const september = headings[1]!.closest("section")!;
    expect(within(september).getByText("Yesterday's idea")).toBeVisible();
    expect(within(september).getByText("Older idea")).toBeVisible();
    expect(within(september).queryByText("First note")).not.toBeInTheDocument();
    expect(headings[0]!.closest(".overflow-y-auto")).not.toBeNull();
  });

  it("groups a search's matches under their own months", async () => {
    renderPanel(async () =>
      page([
        note("2026-10-01", "October idea"),
        note("2026-09-30", "Yesterday's idea"),
        note("2026-09-01", "Older note"),
      ]),
    );
    await openAllNotes();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "idea" },
    });

    const headings = screen.getAllByRole("heading");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "October 2026",
      "September 2026",
    ]);
    const september = headings[1]!.closest("section")!;
    expect(
      within(september).getByRole("button", { name: /Yesterday's idea/ }),
    ).toBeVisible();
    expect(
      within(september).queryByRole("button", { name: /Older note/ }),
    ).not.toBeInTheDocument();
  });

  it("extends the last group with earlier notes from the same month", async () => {
    renderPanel(async (cursor) =>
      cursor
        ? page([
            note("2026-09-01", "Older idea"),
            note("2026-08-15", "August idea"),
          ])
        : page(
            [
              note("2026-10-01", "First note"),
              note("2026-09-30", "Yesterday's idea"),
            ],
            "2026-09-30",
          ),
    );
    await openAllNotes();
    fireEvent.click(screen.getByRole("button", { name: "Load earlier notes" }));

    await screen.findByText("August idea");
    const headings = screen.getAllByRole("heading");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "October 2026",
      "September 2026",
      "August 2026",
    ]);
    expect(
      within(headings[1]!.closest("section")!).getByText("Older idea"),
    ).toBeVisible();
  });

  it("keeps each card's download and delete inside its month group", async () => {
    const deletePocketNote = vi.fn(async () => undefined);
    renderPanel(
      async () =>
        page([
          note("2026-10-01", "First note"),
          note("2026-09-30", "Yesterday's idea"),
        ]),
      undefined,
      deletePocketNote,
    );
    await openAllNotes();

    fireEvent.click(screen.getByRole("button", { name: "Download Sep 30" }));
    expect(download.triggerArtifactDownload).toHaveBeenCalledOnce();
    expect(download.triggerArtifactDownload.mock.calls[0]?.[1]).toBe(
      "pocket-note-2026-09-30.md",
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Sep 30" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deletePocketNote).toHaveBeenCalledWith("2026-09-30"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Yesterday's idea")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("First note")).toBeVisible();
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeVisible();
  });
});

describe("PocketNotePanel jump to today", () => {
  const notes = () => [
    note("2026-10-01", "First note"),
    note("2026-09-30", "Yesterday's idea"),
  ];

  function box(top: number, bottom: number): DOMRect {
    return {
      bottom,
      height: bottom - top,
      left: 0,
      right: 320,
      top,
      width: 320,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  }

  /**
   * jsdom has no layout, so each test states where the list and today's card
   * sit and then lets the scroll listener read them.
   */
  function placeList({
    card,
    container,
  }: {
    card: [number, number];
    container: [number, number];
  }) {
    const list = document.querySelector<HTMLElement>(
      "[data-pocket-notes-scroll]",
    );
    const todayCard = document.querySelector<HTMLElement>(
      "[data-pocket-note-today]",
    );
    if (!list || !todayCard) throw new Error("The All-notes list is not open");
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(box(...container));
    vi.spyOn(todayCard, "getBoundingClientRect").mockReturnValue(box(...card));
    fireEvent.scroll(list);
    return { list, todayCard };
  }

  const jumpButton = () =>
    screen.queryByRole("button", { name: "Jump to today" });

  it("offers the jump while today's card is out of view and drops it back in view", async () => {
    renderPanel(async () => page(notes()));
    await openAllNotes();
    expect(jumpButton()).not.toBeInTheDocument();

    placeList({ card: [600, 718], container: [100, 540] });
    expect(jumpButton()).toBeVisible();

    placeList({ card: [120, 238], container: [100, 540] });
    expect(jumpButton()).not.toBeInTheDocument();
  });

  it("offers no jump when today has no note", async () => {
    renderPanel(async () => page([note("2026-09-30", "Yesterday's idea")]));
    await openAllNotes();

    placeList({ card: [600, 718], container: [100, 540] });

    expect(jumpButton()).not.toBeInTheDocument();
  });

  it("hides the jump while a search leaves today out", async () => {
    renderPanel(async () => page(notes()));
    await openAllNotes();
    placeList({ card: [600, 718], container: [100, 540] });
    expect(jumpButton()).toBeVisible();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "yesterday" },
    });

    expect(jumpButton()).not.toBeInTheDocument();
  });

  it("scrolls today's card into view, marks it, and writes nothing", async () => {
    const { runtime } = renderPanel(async () => page(notes()));
    await openAllNotes();
    const { todayCard } = placeList({
      card: [600, 718],
      container: [100, 540],
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(todayCard, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const before = runtime.server.requests.length;

    fireEvent.click(screen.getByRole("button", { name: "Jump to today" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(todayCard).toHaveClass("pocket-note-today-marked");
    expect(jumpButton()).not.toBeInTheDocument();
    expect(runtime.server.requests).toHaveLength(before);
    await waitFor(() =>
      expect(todayCard).not.toHaveClass("pocket-note-today-marked"),
    );
  });

  it("keeps a search that shows today after the jump", async () => {
    renderPanel(async () => page(notes()));
    await openAllNotes();
    const search = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(search, { target: { value: "first" } });
    placeList({ card: [600, 718], container: [100, 540] });

    fireEvent.click(screen.getByRole("button", { name: "Jump to today" }));

    expect(search).toHaveValue("first");
    expect(screen.getByRole("button", { name: /First note/ })).toBeVisible();
    expect(screen.queryByText("Yesterday's idea")).not.toBeInTheDocument();
  });

  it("cancels confirmation and clears search on Escape before closing", async () => {
    const { onClose } = renderPanel(async () =>
      page([note("2026-09-30", "Yesterday's idea")]),
    );
    await openAllNotes();
    const search = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(search, { target: { value: "Yesterday" } });

    fireEvent.click(screen.getByRole("button", { name: /^Delete / }));
    expect(screen.getByRole("alertdialog")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("PocketNotePanel copy", () => {
  it("copies today's note as a pasted block", async () => {
    renderPanel(async () =>
      page([note("2026-10-01", "Shipped the graph preview")]),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Copy note" }));

    await waitFor(() =>
      expect(clipboard.writeClipboardText).toHaveBeenCalledWith(
        "Shipped the graph preview\n",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  });

  it("copies the text being edited", async () => {
    renderPanel(
      async () => page([]),
      (text) => note("2026-10-01", text),
    );
    const editor = await screen.findByRole("textbox", {
      name: "Today’s note",
    });
    pasteText(editor, "Buy milk");

    fireEvent.click(screen.getByRole("button", { name: "Copy note" }));

    await waitFor(() =>
      expect(clipboard.writeClipboardText).toHaveBeenCalledWith("Buy milk\n"),
    );
  });

  it("closes trailing whitespace with one newline", async () => {
    renderPanel(async () => page([note("2026-10-01", "Plan\n\n\n")]));

    fireEvent.click(await screen.findByRole("button", { name: "Copy note" }));

    await waitFor(() =>
      expect(clipboard.writeClipboardText).toHaveBeenCalledWith("Plan\n"),
    );
  });

  it("keeps Copy off while the page is empty", async () => {
    renderPanel(async () => page([]));

    expect(
      await screen.findByRole("button", { name: "Copy note" }),
    ).toBeDisabled();
  });

  it("reports a refused copy", async () => {
    clipboard.writeClipboardText.mockRejectedValue(new Error("denied"));
    renderPanel(async () =>
      page([note("2026-10-01", "Shipped the graph preview")]),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Copy note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
  });
});

describe("PocketNotePanel persistence and recovery", () => {
  it("stays open when clicking a room link inside navigation and clamps to the viewport", async () => {
    const { onClose } = renderPanel(async () =>
      page([note("2026-10-01", "Keep open while switching rooms")]),
    );
    const dialog = await screen.findByRole("dialog", { name: "Pocket notes" });
    expect(dialog).toHaveClass("max-w-[calc(100vw-24px)]");
    expect(dialog).toHaveClass("max-h-[calc(100dvh-24px)]");

    const nav = document.createElement("aside");
    nav.className = "app-secondary-navigation";
    const roomLink = document.createElement("a");
    roomLink.textContent = "Design";
    nav.append(roomLink);
    document.body.append(nav);
    try {
      fireEvent.pointerDown(roomLink);
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.pointerDown(document.body);
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      nav.remove();
    }
  });

  it("surfaces a load error alert with Retry and Close, and recovers on retry", async () => {
    let fail = true;
    const listNotes = vi.fn(() => {
      if (fail) {
        fail = false;
        return teamHubErrorResponse(503, "POCKET_NOTES_UNAVAILABLE");
      }
      return page([note("2026-10-01", "Recovered note")]);
    });
    renderPanel(listNotes);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load notes");
    expect(
      screen.getByRole("button", { name: "Close notes" }),
    ).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("textbox", { name: "Today’s note" }),
    ).toHaveTextContent("Recovered note");
    expect(listNotes).toHaveBeenCalledTimes(2);
  });
});

interface ViewportCase {
  expectedHeight: number;
  expectedLeft: number;
  expectedTop: number;
  expectedWidth: number;
  height: number;
  name: string;
  visualHeight?: number;
  visualWidth?: number;
  width: number;
}

function setViewportSize(
  width: number,
  height: number,
  visualViewport?: { height: number; width: number },
) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport
      ? {
          addEventListener: vi.fn(),
          height: visualViewport.height,
          removeEventListener: vi.fn(),
          width: visualViewport.width,
        }
      : undefined,
  });
}

describe("PocketNotePanel responsive viewports", () => {
  const viewportCases: ViewportCase[] = [
    {
      expectedHeight: 440,
      expectedLeft: 12,
      expectedTop: 12,
      expectedWidth: 296,
      height: 568,
      name: "320x568 narrow mobile",
      width: 320,
    },
    {
      expectedHeight: 440,
      expectedLeft: 12,
      expectedTop: 12,
      expectedWidth: 336,
      height: 640,
      name: "360x640 mobile width",
      width: 360,
    },
    {
      expectedHeight: 296,
      expectedLeft: 104,
      expectedTop: 12,
      expectedWidth: 360,
      height: 320,
      name: "568x320 narrow landscape",
      width: 568,
    },
    {
      expectedHeight: 351,
      expectedLeft: 12,
      expectedTop: 12,
      expectedWidth: 360,
      height: 375,
      name: "667x375 landscape",
      width: 667,
    },
    {
      expectedHeight: 376,
      expectedLeft: 12,
      expectedTop: 12,
      expectedWidth: 360,
      height: 400,
      name: "200% zoom CSS viewport (640x400)",
      width: 640,
    },
    {
      expectedHeight: 376,
      expectedLeft: 12,
      expectedTop: 12,
      expectedWidth: 360,
      height: 800,
      name: "200% visualViewport zoom (1280x800 -> 640x400)",
      visualHeight: 400,
      visualWidth: 640,
      width: 1280,
    },
    {
      expectedHeight: 296,
      expectedLeft: 12,
      expectedTop: 12,
      expectedWidth: 216,
      height: 320,
      name: "sub-264px zoomed viewport (240x320)",
      width: 240,
    },
  ];

  it.each(viewportCases)(
    "clamps panel bounds inside the viewport at $name",
    async ({
      expectedHeight,
      expectedLeft,
      expectedTop,
      expectedWidth,
      height,
      visualHeight,
      visualWidth,
      width,
    }) => {
      const originalWidth = window.innerWidth;
      const originalHeight = window.innerHeight;
      const originalVisualViewport = window.visualViewport;
      setViewportSize(
        width,
        height,
        visualWidth !== undefined && visualHeight !== undefined
          ? { height: visualHeight, width: visualWidth }
          : undefined,
      );
      try {
        renderPanel(async () =>
          page([
            note("2026-10-01", "Narrow viewport content"),
            note("2026-09-30", "Yesterday's note"),
          ]),
        );

        const dialog = await screen.findByRole("dialog", {
          name: "Pocket notes",
        });
        await screen.findByRole("textbox", { name: "Today’s note" });

        const effectiveWidth = visualWidth ?? width;
        const effectiveHeight = visualHeight ?? height;
        const left = Number.parseFloat(dialog.style.left);
        const top = Number.parseFloat(dialog.style.top);
        const panelW = Number.parseFloat(dialog.style.width);
        const panelH = Number.parseFloat(dialog.style.height);

        expect(left).toBe(expectedLeft);
        expect(top).toBe(expectedTop);
        expect(panelW).toBe(expectedWidth);
        expect(panelH).toBe(expectedHeight);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(left + panelW).toBeLessThanOrEqual(effectiveWidth);
        expect(top + panelH).toBeLessThanOrEqual(effectiveHeight);
        expect(
          screen.getByRole("button", { name: "Close notes" }),
        ).toBeVisible();
      } finally {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: originalWidth,
        });
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: originalHeight,
        });
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: originalVisualViewport,
        });
      }
    },
  );

  it("uses a single-column card grid below full panel width and clips delete confirmation inside the card", async () => {
    renderPanel(async () =>
      page([
        note("2026-10-01", "Today's line"),
        note("2026-09-30", "Yesterday's idea"),
      ]),
    );
    await openAllNotes();

    const list = screen.getByRole("region", { name: "September 2026" });
    expect(within(list).getByRole("list")).toHaveClass(
      "grid-cols-1",
      "min-[384px]:grid-cols-2",
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Sep 30" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete Sep 30?" });
    expect(confirm).toHaveClass("overflow-hidden");
    expect(
      within(confirm).getByRole("button", { name: "Cancel" }),
    ).toBeVisible();
    expect(
      within(confirm).getByRole("button", { name: "Delete" }),
    ).toBeVisible();
  });

  it("preserves unsaved draft and Retry without remounting or duplicate PUTs across live resizes", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    const originalVisualViewport = window.visualViewport;
    setViewportSize(1280, 800);
    let failing = true;
    const putTodayPocketNote = vi.fn((text: string) => {
      if (failing) {
        return teamHubErrorResponse(503, "POCKET_NOTE_UNAVAILABLE");
      }
      return note("2026-10-01", text);
    });
    try {
      renderPanel(async () => page([]), putTodayPocketNote);
      const editor = await screen.findByRole("textbox", {
        name: "Today’s note",
      });
      const dialog = screen.getByRole("dialog", { name: "Pocket notes" });

      vi.useFakeTimers();
      pasteText(editor, "Draft kept across narrow resizes");

      // Resize across mobile, landscape, and 200% zoom before autosave fires.
      for (const [width, height] of [
        [320, 568],
        [360, 640],
        [568, 320],
        [640, 400],
      ] as const) {
        setViewportSize(width, height);
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
      }

      expect(screen.getByRole("textbox", { name: "Today’s note" })).toBe(
        editor,
      );
      expect(editor).toHaveTextContent("Draft kept across narrow resizes");
      expect(putTodayPocketNote).not.toHaveBeenCalled();

      // Advance past the autosave delay once: only one PUT fires, then fails.
      await act(() => vi.advanceTimersByTimeAsync(801));
      vi.useRealTimers();

      await screen.findByRole("button", { name: "Retry saving note" });
      expect(putTodayPocketNote).toHaveBeenCalledTimes(1);

      // Resize while failed save and Retry are active: zero extra PUTs.
      setViewportSize(320, 568);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(dialog.style.width).toBe("296px");
      expect(dialog.style.height).toBe("440px");

      setViewportSize(568, 320);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(dialog.style.width).toBe("360px");
      expect(dialog.style.height).toBe("296px");

      setViewportSize(1280, 800);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      expect(screen.getByRole("textbox", { name: "Today’s note" })).toBe(
        editor,
      );
      expect(editor).toHaveTextContent("Draft kept across narrow resizes");
      expect(putTodayPocketNote).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Close notes" })).toBeVisible();

      failing = false;
      fireEvent.click(
        screen.getByRole("button", { name: "Retry saving note" }),
      );
      await waitFor(() => expect(putTodayPocketNote).toHaveBeenCalledTimes(2));
      expect(putTodayPocketNote).toHaveBeenLastCalledWith(
        "Draft kept across narrow resizes",
      );
      expect(await screen.findByText("Saved")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: originalVisualViewport,
      });
    }
  });
});
