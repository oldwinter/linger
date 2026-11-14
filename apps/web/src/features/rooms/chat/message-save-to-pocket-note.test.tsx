import {
  type InfiniteData,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMessage,
  TeamHubPocketNotePage,
} from "@/features/teamhub/teamhub-types";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { pocketNotesQueryKey } from "../pocket-notes/pocket-note-queries";
import { MessageTimeline } from "./message-timeline";

const tenantId = "tenant-1";
const today = "2026-10-01";
const listPath = "/v0/tenants/{tenantId}/me/pocket-notes" as const;
const todayPath = "/v0/tenants/{tenantId}/me/pocket-notes/today" as const;

interface TimelineOptions {
  /** Text the Pocket Notes list already holds when the action runs. */
  cachedToday?: string;
  /** Text the list returns when the action has to read it first. */
  storedToday?: string;
  /** Fails the save the way TeamHub refuses one. */
  refuseSave?: boolean;
  /** Holds the save open, so a second click arrives while it runs. */
  saveGate?: Promise<void>;
}

function renderTimeline(options: TimelineOptions = {}) {
  const runtime = createTestTeamHubRuntime();
  runtime.server.on("GET", listPath, () =>
    page(options.storedToday ?? "Existing note"),
  );
  runtime.server.on("PUT", todayPath, async ({ body }) => {
    if (options.refuseSave) {
      return teamHubErrorResponse(500, "POCKET_NOTE_UNAVAILABLE");
    }
    await options.saveGate;
    const { text } = body as { text: string };
    return { date: today, text, updated_at: "2026-10-01T10:00:00Z" };
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (options.cachedToday !== undefined) {
    queryClient.setQueryData(pocketNotesQueryKey(tenantId), {
      pageParams: [undefined],
      pages: [page(options.cachedToday)],
    });
  }
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter>
          <MessageTimeline
            canLoadOlder={false}
            currentActorId="human-1"
            loadingOlder={false}
            messages={[message()]}
            onCancel={() => undefined}
            onCardDecision={() => undefined}
            onCloseLinkedSource={() => undefined}
            onOpenArtifact={() => undefined}
            onOpenMessageFile={() => Promise.resolve()}
            onOpenProfile={() => undefined}
            onOpenThread={() => undefined}
            onRetry={() => undefined}
            pendingMessages={[]}
            presentations={{}}
            tenantId={tenantId}
          />
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { queryClient, runtime };
}

function page(text: string): TeamHubPocketNotePage {
  return {
    items: text
      ? [{ date: today, text, updated_at: "2026-10-01T09:00:00Z" }]
      : [],
    page: { has_more: false },
    today,
  };
}

function message(): TeamHubMessage {
  const content = "A message worth saving.";
  return {
    attachments: [],
    author: {
      display_name: "Alice",
      id: "human-1",
      kind: "human",
      tenant_id: tenantId,
    },
    created_at: "2026-11-15T08:00:00Z",
    id: "message-alpha",
    message_kind: "conversation",
    raw_message: content,
    room_id: "room-all",
    segments: [{ content, type: "text" }],
    tenant_id: tenantId,
  };
}

function chooseSave() {
  fireEvent.click(screen.getByRole("button", { name: "More message actions" }));
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Save to Pocket Note" }),
  );
}

function todayText(queryClient: QueryClient) {
  const data = queryClient.getQueryData<
    InfiniteData<TeamHubPocketNotePage, string | undefined>
  >(pocketNotesQueryKey(tenantId));
  return data?.pages[0]?.items[0]?.text;
}

describe("Save to Pocket Note", () => {
  it("appends the quoted Message to today's page and updates the notes list", async () => {
    const { queryClient, runtime } = renderTimeline();

    chooseSave();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved to Pocket Note",
    );
    const [request] = runtime.server.requestsTo("PUT", todayPath);
    const body = (await request!.json()) as { text: string };
    const expected =
      /^Existing note\n\n> Alice, \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n>\n> A message worth saving\.$/;
    expect(body.text).toMatch(expected);
    expect(todayText(queryClient)).toBe(body.text);
  });

  it("reads the page from the cached list when the notepad is loaded", async () => {
    const { queryClient, runtime } = renderTimeline({ cachedToday: "Cached" });

    chooseSave();

    await waitFor(() =>
      expect(runtime.server.requestsTo("PUT", todayPath)).toHaveLength(1),
    );
    expect(todayText(queryClient)).toMatch(/^Cached\n\n> Alice, /);
    expect(runtime.server.requestsTo("GET", listPath)).toHaveLength(0);
  });

  it("reads the list once when the notepad has never loaded", async () => {
    const { runtime } = renderTimeline({ storedToday: "Read first" });

    chooseSave();

    await waitFor(() =>
      expect(runtime.server.requestsTo("PUT", todayPath)).toHaveLength(1),
    );
    expect(runtime.server.requestsTo("GET", listPath)).toHaveLength(1);
  });

  it("reports a refused save and leaves the page as it was", async () => {
    const { queryClient } = renderTimeline({ refuseSave: true });

    chooseSave();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t save to Pocket Note",
    );
    expect(todayText(queryClient)).toBe("Existing note");
  });

  it("appends once when the save is clicked twice", async () => {
    let release: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { runtime } = renderTimeline({ saveGate });

    chooseSave();
    fireEvent.click(
      screen.getByRole("button", { name: "More message actions" }),
    );
    const item = screen.getByRole("menuitem", {
      name: "Save to Pocket Note",
    });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    release();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saved to Pocket Note",
      ),
    );
    expect(runtime.server.requestsTo("PUT", todayPath)).toHaveLength(1);
  });
});
