import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { getTranslation } from "@/i18n/language";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { cardNoticeLines, settledCardNotice } from "./card-notice";
import { DecisionCard, type DecisionMessageCard } from "./decision-card";

const card: DecisionMessageCard = {
  card_type: "personal_notice",
  intent: "decision_requested",
  version: 1,
  decision_id: "search-1",
  kind: "search_key",
  status: "pending",
  title: "Please add a Tavily API key so I can search the web.",
  search_key: { backend: "tavily", origin: "requested", reason: "missing" },
  decision_owner: { id: "alice", display_name: "Alice", kind: "human" },
  requester: { id: "writer", display_name: "Writer", kind: "agent" },
};

function setup(next: DecisionMessageCard = card, actorId = "alice") {
  const runtime = createTestTeamHubRuntime();
  const saved: { backend: string; body: unknown }[] = [];
  runtime.server.on(
    "PUT",
    "/v0/web-search/backends/{backend}/key",
    ({ body, params }) => {
      saved.push({ backend: params.backend!, body });
      return runtime.seed.webSearch.backends.find(
        (backend) => backend.id === params.backend,
      );
    },
  );
  const decision = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <DecisionCard
          card={next}
          currentActorId={actorId}
          messageId="message-1"
          onDecision={decision}
          roomId="room-1"
          tenantId="tenant_one"
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { decision, runtime, saved };
}

async function findBox() {
  return screen.findByRole("region", { name: "Web search key requested" });
}

describe("Web search key card", () => {
  it("saves the requested backend's key from the card without answering it", async () => {
    const { decision, runtime, saved } = setup();
    const box = await findBox();
    expect(box).toHaveTextContent(
      "Please add a Tavily API key so I can search the web.",
    );
    expect(within(box).getByText("Requested")).toBeVisible();
    expect(
      await within(box).findByText(
        "The real-time search engine for AI agents.",
      ),
    ).toBeVisible();
    expect(
      within(box).getByRole("link", { name: /app\.tavily\.com\/home/ }),
    ).toHaveAttribute("href", "https://app.tavily.com/home");

    const field = within(box).getByLabelText("Tavily API key");
    fireEvent.change(field, { target: { value: " tvly-secret " } });
    fireEvent.click(within(box).getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(saved).toEqual([
        {
          backend: "tavily",
          body: { api_key: "tvly-secret", decision_id: "search-1" },
        },
      ]),
    );
    await waitFor(() => expect(field).toHaveValue(""));
    expect(decision).not.toHaveBeenCalled();
    // The card reads only static backend text; it never asks for quota.
    const reads = runtime.server.requestsTo("GET", "/v0/web-search/backends");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads)
      expect(new URL(read.url).searchParams.get("include_quota")).toBe("false");
  });

  it("opens every other backend with its own field and saves one of them", async () => {
    const { saved } = setup({
      ...card,
      search_key: { backend: "tavily", origin: "suggested", reason: "missing" },
    });
    const box = await findBox();
    expect(within(box).getByText("Suggested")).toBeVisible();
    const toggle = await within(box).findByRole("button", {
      name: "Other providers (4)",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(box).queryByLabelText("Brave Search API key")).toBeNull();

    fireEvent.click(toggle);
    expect(
      within(box).getByRole("button", { name: "Hide other providers" }),
    ).toHaveAttribute("aria-expanded", "true");
    const others = within(box).getByRole("list", { name: "Other providers" });
    // Each backend in the list owns its field and Save button.
    expect(
      within(others)
        .getAllByRole("listitem")
        .map((item) => within(item).getByRole("button", { name: "Save key" })),
    ).toHaveLength(4);
    const you = within(others).getByText("You.com").closest("li")!;
    expect(you).toHaveTextContent("Free, limited");
    expect(within(others).queryByText("DuckDuckGo")).toBeNull();
    expect(within(others).queryByText("Tavily")).toBeNull();

    const brave = within(others).getByText("Brave Search").closest("li")!;
    fireEvent.change(within(brave).getByLabelText("Brave Search API key"), {
      target: { value: "brave-key" },
    });
    fireEvent.click(within(brave).getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(saved).toEqual([
        {
          backend: "brave",
          body: { api_key: "brave-key", decision_id: "search-1" },
        },
      ]),
    );
  });

  it("shows a rejected key under the row it was saved from", async () => {
    const { runtime } = setup();
    runtime.server.on("PUT", "/v0/web-search/backends/{backend}/key", () =>
      teamHubErrorResponse(400, "WEB_SEARCH_KEY_REJECTED"),
    );
    const box = await findBox();
    fireEvent.click(
      await within(box).findByRole("button", { name: "Other providers (4)" }),
    );
    const brave = within(box).getByText("Brave Search").closest("li")!;
    fireEvent.change(within(brave).getByLabelText("Brave Search API key"), {
      target: { value: "bad" },
    });
    fireEvent.click(within(brave).getByRole("button", { name: "Save key" }));

    expect(await within(brave).findByRole("alert")).toHaveTextContent(
      "Brave Search rejected this key. Check it at api-dashboard.search.brave.com and paste it again.",
    );
    expect(within(box).getAllByRole("alert")).toHaveLength(1);
  });

  it.each([
    ["rejected", "Tavily no longer accepts the saved key. Paste a new one."],
    [
      "free_limit",
      "The free Tavily searches are used up. Add a key to keep searching.",
    ],
  ] as const)("explains a %s key request", async (reason, text) => {
    setup({
      ...card,
      search_key: { backend: "tavily", origin: "requested", reason },
    });
    expect(await findBox()).toHaveTextContent(text);
  });

  it("declines with a deny decision", async () => {
    const { decision } = setup();
    fireEvent.click(
      within(await findBox()).getByRole("button", { name: "Not now" }),
    );
    await waitFor(() =>
      expect(decision).toHaveBeenCalledWith({
        decision: "deny",
        expectedVersion: 1,
        messageId: "message-1",
        requestId: "search-1",
      }),
    );
  });

  it("shows other members the backend without a field or buttons", async () => {
    setup(card, "bob");
    const box = await findBox();
    expect(box).toHaveTextContent("Tavily");
    expect(within(box).queryByRole("button")).toBeNull();
    expect(within(box).queryByLabelText("Tavily API key")).toBeNull();
  });

  it.each([
    [
      { decision: "configured", backend: "brave" },
      "answered",
      "Brave Search key added instead of Tavily. Your Agent continues with Brave Search.",
    ],
    [
      { decision: "configured", backend: "tavily" },
      "answered",
      "Tavily key added. Your Agent is continuing.",
    ],
    [{ decision: "deny" }, "denied", "No key added"],
  ] as const)(
    "puts a backend-aware result in place of the fields: %#",
    async (answer, status, text) => {
      setup({
        ...card,
        answer,
        decided_at: "2026-11-20T10:00:00Z",
        decided_by: card.decision_owner,
        status,
      });
      const box = await findBox();
      expect(within(box).getByText(text)).toBeVisible();
      expect(within(box).queryByRole("button")).toBeNull();
      expect(box.querySelector("input")).toBeNull();
    },
  );
});

describe("Web search key notice", () => {
  const settled = (answer: DecisionMessageCard["answer"]) => ({
    ...card,
    answer,
    decided_at: "2026-11-20T10:00:00Z",
    decided_by: card.decision_owner,
    status: "answered" as const,
  });

  /** The system line a settled card becomes, as the reader sees it. */
  function noticeText(next: DecisionMessageCard, viewerId: string) {
    const notice = settledCardNotice(next, viewerId);
    return (
      notice &&
      cardNoticeLines(notice, getTranslation())
        .map((line) => line.parts.map((part) => part.text).join(""))
        .join("\n")
    );
  }

  it("names the backend whose key was saved", () => {
    expect(
      noticeText(
        settled({ backend: "tavily", decision: "configured" }),
        "alice",
      ),
    ).toBe("You added a Tavily key");
    expect(
      noticeText(settled({ backend: "brave", decision: "configured" }), "bob"),
    ).toBe("Alice added a Brave Search key instead of Tavily");
  });

  it("keeps a waiting key request a card", () => {
    expect(settledCardNotice(card, "alice")).toBeNull();
  });
});
