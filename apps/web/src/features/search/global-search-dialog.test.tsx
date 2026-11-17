import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/app/query-client";
import {
  voiceClose,
  voiceOpenResult,
  voiceSearchResults,
} from "@/features/rooms/chat/voice-mode/voice-ui-bridge";
import {
  acceptDirectRooms,
  createTestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import {
  teamHubErrorResponse,
  type TestRouteRequest,
} from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubDocument,
  TeamHubMessage,
  TeamHubMessageSearchHit,
} from "@/features/teamhub/teamhub-types";

import { GlobalSearchDialog } from "./global-search-dialog";
import {
  readGlobalSearchStore,
  type GlobalSearchStore,
} from "./global-search-recent";
import type { SearchRoomScope } from "./room-search-scope";
import { isGlobalSearchShortcut } from "./search-shortcut";

const TENANT = "tenant-northstar";
const INPUT_NAME = "Search messages, docs, people, agents and rooms";
const STORAGE_KEY = `global-search-recent.v2:${TENANT}`;

/** Result rows and scope cards live in the listbox. */
const results = () => within(screen.getByRole("listbox"));

describe("Global search dialog", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createTestStorage(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens as a centred dialog with one field, four scope cards and no filters", async () => {
    await renderDialog();
    expect(screen.getByRole("dialog", { name: "Search" })).toHaveAttribute(
      "data-size",
      "md",
    );
    expect(screen.getByRole("combobox", { name: INPUT_NAME })).toHaveAttribute(
      "placeholder",
      "Search messages, docs, members and rooms",
    );
    expect(screen.getByRole("button", { name: "Esc" })).toBeVisible();
    expect(screen.getByRole("listbox")).toHaveClass("workspace-scrollbar");
    // Types are scopes the person steps into, not tabs or filter selects.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: /Filter search/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Filter search results by kind" }),
    ).toBeNull();
    expect(screen.getByText("Search in")).toBeVisible();
    expect(
      results()
        .getAllByRole("option")
        .map((card) => card.textContent),
    ).toEqual([
      "MessagesChats in your Rooms",
      "MembersAgents you can message",
      "DocsDocs and notes",
      "RoomsRooms you can join",
    ]);
  });

  it("searches only the Room it opened on until the chip is cleared", async () => {
    const harness = await renderDialog({
      room: { id: "room-all", name: "All hands" },
    });
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    expect(screen.getByText("This Room")).toBeVisible();
    expect(input).toHaveAttribute("placeholder", "Search messages");
    expect(
      screen.queryByRole("button", { name: "Remove Messages scope" }),
    ).toBeNull();

    fireEvent.change(input, { target: { value: "deploy" } });
    await waitFor(() =>
      expect(searchRequests(harness.searchMessages)).toContainEqual({
        params: { tenantId: TENANT },
        query: { limit: "20", q: "deploy", room_id: "room-all" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(harness.searchDocuments).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove This Room scope" }),
    );
    expect(screen.queryByText("This Room")).toBeNull();
    expect(input).toHaveFocus();
    await waitFor(() =>
      expect(searchRequests(harness.searchMessages)).toContainEqual({
        params: { tenantId: TENANT },
        query: { limit: "20", q: "deploy" },
        signal: expect.any(AbortSignal),
      }),
    );
    await waitFor(() => expect(harness.searchDocuments).toHaveBeenCalled());
  });

  it.each<SearchRoomScope>([
    { id: "room-all", name: "All hands" },
    {
      id: "room-thread-1",
      label: "Thread · Rollout plan",
      name: "Rollout plan",
    },
  ])(
    "clears the $name scope with empty Backspace and keeps other editing keys native",
    async (room) => {
      const harness = await renderDialog({ room });
      const input = screen.getByRole("combobox", { name: INPUT_NAME });
      const removeScope = () =>
        screen.queryByRole("button", {
          name: `Remove ${room.label ?? "This Room"} scope`,
        });
      expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
      expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(
        true,
      );
      expect(
        fireEvent.keyDown(input, { key: "Backspace", isComposing: true }),
      ).toBe(true);
      expect(fireEvent.keyDown(input, { key: "Backspace", keyCode: 229 })).toBe(
        true,
      );
      expect(removeScope()).toBeVisible();

      fireEvent.change(input, { target: { value: "deploy" } });
      expect(fireEvent.keyDown(input, { key: "Backspace" })).toBe(true);
      expect(removeScope()).toBeVisible();
      fireEvent.change(input, { target: { value: "" } });
      expect(fireEvent.keyDown(input, { key: "Backspace" })).toBe(false);
      expect(removeScope()).toBeNull();
      expect(input).toHaveFocus();

      fireEvent.change(input, { target: { value: "deploy" } });
      await waitFor(() =>
        expect(searchRequests(harness.searchMessages)).toContainEqual({
          params: { tenantId: TENANT },
          query: { limit: "20", q: "deploy" },
          signal: expect.any(AbortSignal),
        }),
      );
      await waitFor(() => expect(harness.searchDocuments).toHaveBeenCalled());
    },
  );

  it("names a Thread in the scope chip and widens to global search when cleared", async () => {
    const harness = await renderDialog({
      room: {
        id: "room-thread-1",
        label: "Thread · Rollout plan",
        name: "Rollout plan",
      },
    });
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    expect(screen.getByText("Thread · Rollout plan")).toBeVisible();
    expect(input).toHaveAttribute("placeholder", "Search messages");

    fireEvent.change(input, { target: { value: "rollout" } });
    await waitFor(() =>
      expect(searchRequests(harness.searchMessages)).toContainEqual({
        params: { tenantId: TENANT },
        query: { limit: "20", q: "rollout", room_id: "room-thread-1" },
        signal: expect.any(AbortSignal),
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Thread · Rollout plan scope",
      }),
    );
    // Removing the chip widens the same search instead of closing it.
    expect(screen.queryByText("Thread · Rollout plan")).toBeNull();
    expect(input).toHaveFocus();
    await waitFor(() =>
      expect(searchRequests(harness.searchMessages)).toContainEqual({
        params: { tenantId: TENANT },
        query: { limit: "20", q: "rollout" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  it("searches messages and docs after the debounce without a preview pane", async () => {
    const harness = await renderDialog();
    const { message, document } = await harness.samples();
    harness.searchMessages.mockReturnValue({
      items: [
        messageHit(message, "Deploy to test after the freeze", {
          id: "room-all",
          kind: "room",
          name: "All hands",
        }),
      ],
      page: { has_more: false },
    });
    harness.searchDocuments.mockReturnValue({
      items: [
        {
          ...document,
          representation_format: "markdown",
          search_match: {
            body_index_status: "ready",
            body_snippet: "…run the deploy after the freeze…",
          },
        },
        {
          ...document,
          format: "pdf",
          id: "document-deploy-scan",
          representation_format: "pdf",
          search_match: {
            body_index_status: "ready",
            body_snippet: "…scanned deploy steps…",
          },
          title: "Deploy runbook scan.pdf",
        },
      ],
      page: { has_more: false },
    });

    fireEvent.change(screen.getByRole("combobox", { name: INPUT_NAME }), {
      target: { value: "deploy" },
    });

    await waitFor(() =>
      expect(searchRequests(harness.searchMessages)).toContainEqual({
        params: { tenantId: TENANT },
        query: { limit: "20", q: "deploy" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(searchRequests(harness.searchDocuments)).toContainEqual({
      params: {},
      query: { limit: "20", q: "deploy", tenant_id: TENANT },
      signal: expect.any(AbortSignal),
    });
    const messageRow = await results().findByRole("option", {
      name: /Deploy to test after the freeze/,
    });
    expect(within(messageRow).getByText("in #All hands")).toBeVisible();
    expect(messageRow.querySelector("mark")).toHaveTextContent("Deploy");
    // Messages lead, the first row is active, and group labels carry no counts.
    const rows = results().getAllByRole("option");
    expect(rows[0]).toBe(messageRow);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(results().getByText("Messages")).toHaveTextContent(/^Messages$/);
    expect(results().getByText("Docs")).toHaveTextContent(/^Docs$/);

    expect(screen.queryByRole("complementary", { name: "Preview" })).toBeNull();
    expect(
      results().getByRole("option", { name: /product-v0-brief/ }),
    ).toBeVisible();
    expect(
      results().getByRole("option", { name: /Deploy runbook scan/ }),
    ).toBeVisible();

    // A query that stayed on screen with results joins Recent searches.
    await waitFor(() =>
      expect(readGlobalSearchStore(TENANT).queries).toEqual(["deploy"]),
    );
  });

  it("shows three hits per group and steps into a type with See all", async () => {
    const harness = await renderDialog();
    const { message, document } = await harness.samples();
    const hit = messageHit(message, "Count regression message", {
      id: "room-all",
      kind: "room",
      name: "All hands",
    });
    harness.searchMessages.mockReturnValue({
      items: Array.from({ length: 20 }, (_, index) => ({
        ...hit,
        message: { ...hit.message, id: `count-message-${index}` },
      })),
      page: { has_more: true },
    });
    harness.searchDocuments.mockReturnValue({
      items: Array.from({ length: 20 }, (_, index) => ({
        ...document,
        id: `count-document-${index}`,
      })),
      page: { has_more: true },
    });
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "count-regression" } });
    const messageRows = () =>
      results().queryAllByRole("option", { name: /Count regression message/ });
    await waitFor(() => expect(messageRows()).toHaveLength(3));
    fireEvent.click(
      screen.getByRole("button", { name: /See all in Messages/ }),
    );
    expect(
      screen.getByRole("button", { name: "Remove Messages scope" }),
    ).toBeVisible();
    expect(input).toHaveAttribute("placeholder", "Search messages");
    expect(messageRows()).toHaveLength(20);
    expect(results().queryByText("Docs")).toBeNull();
    // Scoping reuses the page already fetched.
    expect(harness.searchMessages).toHaveBeenCalledTimes(1);
    expect(harness.searchDocuments).toHaveBeenCalledTimes(1);

    // Backspace leaves the scope only once the field is empty.
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(
      screen.getByRole("button", { name: "Remove Messages scope" }),
    ).toBeVisible();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(
      screen.queryByRole("button", { name: "Remove Messages scope" }),
    ).toBeNull();
    expect(input).toHaveAttribute(
      "placeholder",
      "Search messages, docs, members and rooms",
    );
  });

  it("filters loaded results by kind with counted chips and keeps arrow keys", async () => {
    const harness = await renderDialog();
    const { message, document } = await harness.samples();
    harness.searchMessages.mockReturnValue({
      items: [
        messageHit(message, "Deploy to test after the freeze", {
          id: "room-all",
          kind: "room",
          name: "All hands",
        }),
      ],
      page: { has_more: false },
    });
    harness.searchDocuments.mockReturnValue({
      items: Array.from({ length: 4 }, (_, index) => ({
        ...document,
        id: `kind-document-${index}`,
        title: `Kind doc ${index}.md`,
      })),
      page: { has_more: false },
    });
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "zqx" } });

    const chips = await screen.findByRole("group", {
      name: "Filter search results by kind",
    });
    const chip = (name: string) => within(chips).getByRole("button", { name });
    await waitFor(() => expect(chip("Docs 4")).toBeEnabled());
    expect(chip("All 5")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Messages 1")).toHaveAttribute("aria-pressed", "false");
    // Empty kinds stay visible and cannot be chosen.
    expect(chip("Members 0")).toBeDisabled();
    expect(chip("Rooms 0")).toBeDisabled();
    await waitFor(() =>
      expect(
        results().queryAllByRole("option", { name: /Kind doc/ }),
      ).toHaveLength(3),
    );

    fireEvent.click(chip("Docs 4"));
    expect(chip("Docs 4")).toHaveAttribute("aria-pressed", "true");
    expect(chip("All 5")).toHaveAttribute("aria-pressed", "false");
    expect(input).toHaveFocus();
    // The chosen kind shows every loaded row and no other kind's row.
    expect(
      results().queryAllByRole("option", { name: /Kind doc/ }),
    ).toHaveLength(4);
    expect(
      results().queryByRole("option", { name: /Deploy to test/ }),
    ).toBeNull();
    // Filtering reuses the rows already fetched.
    expect(harness.searchMessages).toHaveBeenCalledTimes(1);
    expect(harness.searchDocuments).toHaveBeenCalledTimes(1);

    // Arrow keys walk the filtered rows only.
    const docs = results().getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", docs[0]!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", docs[1]!.id);
  });

  it("falls back to All when the chosen kind loses its results", async () => {
    const harness = await renderDialog();
    const { message, document } = await harness.samples();
    harness.searchMessages.mockReturnValue({
      items: [
        messageHit(message, "Deploy to test after the freeze", {
          id: "room-all",
          kind: "room",
          name: "All hands",
        }),
      ],
      page: { has_more: false },
    });
    harness.searchDocuments.mockReturnValue({
      items: [
        { ...document, id: "fallback-document", title: "Fallback doc.md" },
      ],
      page: { has_more: false },
    });
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "zqx" } });

    const chips = await screen.findByRole("group", {
      name: "Filter search results by kind",
    });
    const chip = (name: string) => within(chips).getByRole("button", { name });
    await waitFor(() => expect(chip("Docs 1")).toBeEnabled());
    fireEvent.click(chip("Docs 1"));
    await results().findByRole("option", { name: /Fallback doc/ });

    harness.searchDocuments.mockReturnValue(emptySearchPage);
    fireEvent.change(input, { target: { value: "zqx freeze" } });
    await waitFor(() =>
      expect(chip("All 1")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(chip("Docs 0")).toBeDisabled();
    // The dialog shows the remaining kinds instead of an empty list.
    expect(
      await results().findByRole("option", { name: /Deploy to test/ }),
    ).toBeVisible();
  });

  it("starts on All and composes kind chips with the Room scope chip", async () => {
    const harness = await renderDialog({
      room: { id: "room-all", name: "All hands" },
    });
    const { message } = await harness.samples();
    harness.searchMessages.mockReturnValue({
      items: [
        messageHit(message, "Deploy to test after the freeze", {
          id: "room-all",
          kind: "room",
          name: "All hands",
        }),
        messageHit(
          { ...message, id: "message-second" },
          "Deploy the second service",
          { id: "room-all", kind: "room", name: "All hands" },
        ),
      ],
      page: { has_more: false },
    });
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "deploy" } });

    const chips = await screen.findByRole("group", {
      name: "Filter search results by kind",
    });
    await waitFor(() =>
      expect(
        within(chips).getByRole("button", { name: "Messages 2" }),
      ).toBeEnabled(),
    );
    expect(screen.getByText("This Room")).toBeVisible();
    expect(
      within(chips).getByRole("button", { name: "All 2" }),
    ).toHaveAttribute("aria-pressed", "true");
    // A Room-scoped search produces Messages alone.
    expect(within(chips).queryByRole("button", { name: /^Docs / })).toBeNull();
    expect(harness.searchDocuments).not.toHaveBeenCalled();
  });

  it("offers the kind chips for the type scope in effect", async () => {
    await renderDialog();
    fireEvent.click(results().getByRole("option", { name: /^Members/ }));

    const chips = await screen.findByRole("group", {
      name: "Filter search results by kind",
    });
    await waitFor(() =>
      expect(
        within(chips).getByRole("button", { name: /^Members \d+$/ }),
      ).toBeEnabled(),
    );
    expect(
      within(chips).getByRole("button", { name: /^All \d+$/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(chips).queryByRole("button", { name: /^Docs / })).toBeNull();
  });

  it("returns to All when the dialog closes and opens again", async () => {
    const harness = await renderDialog({ closable: true });
    const { message, document } = await harness.samples();
    harness.searchMessages.mockReturnValue({
      items: [
        messageHit(message, "Deploy to test after the freeze", {
          id: "room-all",
          kind: "room",
          name: "All hands",
        }),
      ],
      page: { has_more: false },
    });
    harness.searchDocuments.mockReturnValue({
      items: [{ ...document, id: "reset-document", title: "Reset doc.md" }],
      page: { has_more: false },
    });
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "zqx" } });

    let chips = await screen.findByRole("group", {
      name: "Filter search results by kind",
    });
    await waitFor(() =>
      expect(
        within(chips).getByRole("button", { name: "Docs 1" }),
      ).toBeEnabled(),
    );
    fireEvent.click(within(chips).getByRole("button", { name: "Docs 1" }));
    expect(
      within(chips).getByRole("button", { name: "Docs 1" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(harness.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reopen search" }));
    const reopened = await screen.findByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(reopened, { target: { value: "zqx" } });

    chips = await screen.findByRole("group", {
      name: "Filter search results by kind",
    });
    await waitFor(() =>
      expect(
        within(chips).getByRole("button", { name: /^All / }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(
      within(chips).getByRole("button", { name: /^Docs / }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("opens a message hit with the keyword highlight and records the open", async () => {
    const harness = await renderDialog();
    const { message } = await harness.samples();
    harness.searchMessages.mockReturnValue({
      items: [
        messageHit(message, "Freeze the release at four", {
          id: "room-all",
          kind: "room",
          name: "All hands",
        }),
      ],
      page: { has_more: false },
    });
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "Freeze " } });
    const row = await results().findByRole("option", {
      name: /Freeze the release/,
    });
    await waitFor(() =>
      expect(input).toHaveAttribute("aria-activedescendant", row.id),
    );

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(harness.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/t/${TENANT}/rooms/room-all/chat?message=${message.id}&highlight=Freeze`,
      ),
    );
    expect(harness.onClose).toHaveBeenCalledTimes(1);
    const store = readGlobalSearchStore(TENANT);
    expect(store.queries).toEqual(["Freeze"]);
  });

  it("opens a thread hit through the parent Room thread parameter without a highlight", async () => {
    const harness = await renderDialog();
    const { message } = await harness.samples();
    harness.searchMessages.mockReturnValue({
      items: [
        messageHit(
          { ...message, id: "message-thread-reply" },
          "Thread reply about rollout",
          {
            id: "room-thread-1",
            kind: "thread",
            name: "Rollout thread",
            parent_room_id: "room-all",
            root_message_id: "message-root-1",
          },
        ),
      ],
      page: { has_more: false },
    });
    fireEvent.change(screen.getByRole("combobox", { name: INPUT_NAME }), {
      target: { value: "rollout" },
    });
    // The line opens a few characters before the match.
    const row = await results().findByRole("option", {
      name: /reply about rollout/,
    });
    expect(within(row).getByText(/thread$/)).toBeVisible();
    fireEvent.click(row);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/t/${TENANT}/rooms/room-all/chat?thread=message-root-1`,
      ),
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent("highlight");
  });

  it("opens an Agent from Members into its Direct Room and lists that Room nowhere else", async () => {
    const harness = await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "codex" } });
    // Agents live in Members, next to Humans, with their agent tile and tag;
    // the Direct Room with Codex is reached through this row, not a Rooms row.
    const agentRow = await results().findByRole("option", { name: /Codex/ });
    expect(
      within(agentRow).getByRole("img", { name: "Codex avatar" }),
    ).toBeVisible();
    expect(within(agentRow).getByText("Agent")).toBeVisible();
    expect(
      results().queryByRole("option", { name: /Direct message/ }),
    ).toBeNull();
    expect(results().queryByText("Rooms")).toBeNull();

    fireEvent.click(agentRow);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/t/${TENANT}/rooms/room-dm-codex/chat`,
      ),
    );
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  it("offers its visible results to Voice Mode and opens and closes like a click", async () => {
    const harness = await renderDialog();
    // Scope cards and recent queries are not results Voice Mode can open.
    expect(voiceSearchResults()).toEqual([]);
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "codex" } });
    await results().findByRole("option", { name: /Codex/ });
    const codex = voiceSearchResults().find(
      (result) => result.name === "Codex",
    );
    expect(codex).toBeDefined();
    expect(voiceClose()).toBe(true);
    expect(harness.onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await voiceOpenResult(codex!.id)).toBe(true);
    });
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/t/${TENANT}/rooms/room-dm-codex/chat`,
      ),
    );
    expect(harness.onClose).toHaveBeenCalledTimes(2);
  });

  it("creates the Direct Room for an Agent that has none before opening it", async () => {
    const harness = await renderDialog();
    acceptDirectRooms(harness.runtime);
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "lev8" } });
    fireEvent.click(await results().findByRole("option", { name: /Lev8 GTM/ }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        new RegExp(`/t/${TENANT}/rooms/room-dm-[^/]+/chat`),
      ),
    );
    const [opened] = harness.runtime.server.requestsTo(
      "POST",
      "/v0/tenants/{tenantId}/direct-rooms",
    );
    expect(new URL(opened!.url).pathname).toBe(
      `/v0/tenants/${TENANT}/direct-rooms`,
    );
    expect(await opened!.json()).toEqual({ peer_actor_id: "actor-lev8" });
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  it("lists no Humans in Members and draws group Rooms as member mosaics", async () => {
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "j" } });
    // Only Agents are Members; Jenny herself has no row.
    await results().findByRole("option", { name: /Jenny's Delegate/ });
    expect(
      results().queryByRole("option", { name: /Jenny Bin/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "all" } });
    const groupRow = await results().findByRole("option", { name: /^#all/ });
    // A group Room draws the sidebar's member mosaic instead of a chat glyph.
    expect(
      groupRow.querySelectorAll(".room-avatar .room-avatar-tile [aria-label]")
        .length,
    ).toBeGreaterThan(0);
    expect(
      within(groupRow).getByText("General collaboration for the whole team."),
    ).toBeVisible();
  });

  it("matches cached members locally and searches the backend from two characters", async () => {
    const harness = await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "j" } });
    const person = await results().findByRole("option", {
      name: /Jenny's Delegate/,
    });
    expect(person).toBeVisible();
    expect(harness.searchMessages).not.toHaveBeenCalled();
    expect(harness.searchDocuments).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "je" } });
    await waitFor(() =>
      expect(searchRequests(harness.searchMessages)).toContainEqual({
        params: { tenantId: TENANT },
        query: { limit: "20", q: "je" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      results().getByRole("option", { name: /Jenny's Delegate/ }),
    ).toBeVisible();

    // Tab narrows to the highlighted row's type.
    await hover(results().getByRole("option", { name: /Jenny's Delegate/ }));
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);
    expect(
      screen.getByRole("button", { name: "Remove Members scope" }),
    ).toBeVisible();
    expect(
      results().getByRole("option", { name: /Jenny's Delegate/ }),
    ).toBeVisible();
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
  });

  it.each([
    ["Members", "codex", /Codex/],
    ["Rooms", "all", /^#all/],
  ])("sends no backend search in the %s scope", async (scope, text, row) => {
    const harness = await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.click(
      results().getByRole("option", { name: new RegExp(`^${scope}`) }),
    );
    fireEvent.change(input, { target: { value: text } });
    // Let the debounce settle on the query before checking for requests.
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(results().getByRole("option", { name: row })).toBeVisible();
    expect(harness.searchMessages).not.toHaveBeenCalled();
    expect(harness.searchDocuments).not.toHaveBeenCalled();

    // The same query searches both groups once the scope is removed.
    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${scope} scope` }),
    );
    await waitFor(() =>
      expect(harness.searchMessages).toHaveBeenCalledTimes(1),
    );
    expect(harness.searchDocuments).toHaveBeenCalledTimes(1);
  });

  it("cancels the searches a newer query replaces", async () => {
    const harness = await renderDialog();
    harness.searchMessages.mockReturnValueOnce(new Promise(() => {}));
    harness.searchDocuments.mockReturnValueOnce(new Promise(() => {}));
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    fireEvent.change(input, { target: { value: "dep" } });
    await waitFor(() =>
      expect(harness.searchMessages).toHaveBeenCalledTimes(1),
    );
    const firstMessages =
      harness.searchMessages.mock.calls[0]![0].request.signal;
    const firstDocuments =
      harness.searchDocuments.mock.calls[0]![0].request.signal;
    expect(firstMessages.aborted).toBe(false);
    expect(firstDocuments.aborted).toBe(false);

    fireEvent.change(input, { target: { value: "deploy" } });
    await waitFor(() =>
      expect(harness.searchMessages).toHaveBeenCalledTimes(2),
    );
    expect(firstMessages.aborted).toBe(true);
    expect(firstDocuments.aborted).toBe(true);
    expect(
      harness.searchMessages.mock.calls[1]![0].request.signal.aborted,
    ).toBe(false);
  });

  it("shows a search TeamHub stopped at its time limit without retrying it", async () => {
    const harness = await renderDialog({ queryClient: createAppQueryClient() });
    harness.searchMessages.mockReturnValue(
      teamHubErrorResponse(
        503,
        "SEARCH_TIMEOUT",
        "search took too long; narrow the query and try again",
      ),
    );
    fireEvent.change(screen.getByRole("combobox", { name: INPUT_NAME }), {
      target: { value: "deploy" },
    });
    expect(await screen.findByText("Search failed")).toBeVisible();
    expect(
      screen.getByText("search took too long; narrow the query and try again"),
    ).toBeVisible();
    expect(harness.searchMessages).toHaveBeenCalledTimes(1);
  });

  it("steps into a scope from its card, browses Members, and closes with Escape", async () => {
    const harness = await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    // The Messages card is active first; Tab steps into it.
    fireEvent.keyDown(input, { key: "Tab" });
    expect(
      screen.getByRole("button", { name: "Remove Messages scope" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Search messages");
    fireEvent.keyDown(input, { key: "Backspace" });
    // Enter on the Members card browses every member before a word is typed.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      screen.getByRole("button", { name: "Remove Members scope" }),
    ).toBeVisible();
    expect(
      await results().findByRole("option", { name: /Codex/ }),
    ).toBeVisible();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  it("consumes only plain Tab that changes scope and otherwise allows native focus movement", async () => {
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    for (const modifiers of [
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      expect(fireEvent.keyDown(input, { key: "Tab", ...modifiers })).toBe(true);
      expect(
        screen.queryByRole("button", { name: "Remove Messages scope" }),
      ).toBeNull();
    }

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);
    expect(
      screen.getByRole("button", { name: "Remove Messages scope" }),
    ).toBeVisible();
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(true);
  });

  it("allows Tab to leave a selected recent query without changing scope", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    expect(results().getByRole("option", { name: "deploy" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect(
      screen.queryByRole("button", { name: /Remove .* scope/ }),
    ).toBeNull();
  });

  it("drops the highlight when the pointer leaves the list and keeps Enter on the active row", async () => {
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    const cards = results().getAllByRole("option");
    await hover(cards[1]!);
    expect(cards[1]).toHaveClass("bg-app-hover");
    fireEvent.mouseLeave(screen.getByRole("listbox").parentElement!);
    expect(cards[1]).not.toHaveClass("bg-app-hover");
    // Still the Enter target while unhighlighted.
    expect(input).toHaveAttribute("aria-activedescendant", cards[1]!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(cards[2]).toHaveClass("bg-app-hover");
    fireEvent.mouseLeave(screen.getByRole("listbox").parentElement!);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      screen.getByRole("button", { name: "Remove Docs scope" }),
    ).toBeVisible();
  });

  it("shows recent searches for an empty query", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    expect(screen.getByText("Recent")).toBeVisible();
    expect(screen.queryByText("Frequently used")).not.toBeInTheDocument();
    const rows = results().getAllByRole("option");
    expect(rows.slice(4).map((row) => row.textContent)).toEqual([
      expect.stringContaining("deploy"),
      expect.stringContaining("freeze"),
    ]);
    // Recent queries are single-line rows with the query glyph.
    expect(rows[4]).toHaveClass("h-10");
    expect(
      rows[4]!.querySelector("svg.global-search-query-glyph"),
    ).not.toBeNull();

    // Arrow keys walk across the scope cards and the Recent rows.
    expect(input).toHaveAttribute("aria-activedescendant", rows[0]!.id);
    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    expect(input).toHaveAttribute("aria-activedescendant", rows[5]!.id);
  });

  it("re-runs a recent search from its row and clears the list on request", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    const harness = await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("freeze");
    expect(harness.onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(searchRequests(harness.searchMessages)).toContainEqual({
        params: { tenantId: TENANT },
        query: { limit: "20", q: "freeze" },
        signal: expect.any(AbortSignal),
      }),
    );

    fireEvent.change(input, { target: { value: "" } });
    await results().findByRole("option", { name: /deploy/ });
    fireEvent.click(
      screen.getByRole("button", { name: "Clear recent searches" }),
    );
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
    expect(readGlobalSearchStore(TENANT).queries).toEqual([]);
  });
  it("shows the eight most recent queries and runs one by click", async () => {
    const queries = Array.from({ length: 10 }, (_, index) => `query ${index}`);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ queries }));
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });

    const rows = results().getAllByRole("option").slice(4);
    expect(rows.map((row) => row.textContent)).toEqual(queries.slice(0, 8));

    fireEvent.click(rows[0]!);
    expect(input).toHaveValue("query 0");
    await waitFor(() => expect(screen.queryByText("Recent")).toBeNull());
  });

  it("removes one recent search without running it", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    const harness = await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });

    fireEvent.click(
      screen.getByRole("button", { name: "Remove recent search deploy" }),
    );

    expect(readGlobalSearchStore(TENANT).queries).toEqual(["freeze"]);
    expect(results().queryByRole("option", { name: "deploy" })).toBeNull();
    expect(results().getByRole("option", { name: "freeze" })).toBeVisible();
    // Removing forgets the entry; it does not run it.
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(harness.searchMessages).not.toHaveBeenCalled();
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  it("removes the selected recent search with Delete", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      results().getAllByRole("option")[4]!.id,
    );
    expect(screen.getByText("Remove recent")).toBeVisible();

    fireEvent.keyDown(input, { key: "Delete" });

    expect(readGlobalSearchStore(TENANT).queries).toEqual(["freeze"]);
    expect(results().queryByRole("option", { name: "deploy" })).toBeNull();
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("hides the recent searches while a query is being searched", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    expect(screen.getByText("Recent")).toBeVisible();

    fireEvent.change(input, { target: { value: "deploy" } });
    await waitFor(() => expect(screen.queryByText("Recent")).toBeNull());

    fireEvent.change(input, { target: { value: "" } });
    expect(await screen.findByText("Recent")).toBeVisible();
  });

  it("keeps the recent searches out of a scoped search until the chip is cleared", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    const harness = await renderDialog({
      room: { id: "room-all", name: "All hands" },
    });
    expect(screen.queryByText("Recent")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove This Room scope" }),
    ).toBeVisible();
    expect(harness.searchMessages).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove This Room scope" }),
    );

    expect(await screen.findByText("Recent")).toBeVisible();
    expect(results().getByRole("option", { name: "deploy" })).toBeVisible();
    expect(results().getByRole("option", { name: "freeze" })).toBeVisible();
  });

  it("keeps every recent option owned by the listbox and reports its Delete shortcut", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    await renderDialog();
    const listbox = screen.getByRole("listbox");
    const recent = results().getByRole("option", { name: "deploy" });

    expect(recent).toHaveAttribute("aria-selected", "false");
    expect(recent.parentElement).toHaveAttribute("role", "presentation");
    expect(recent.closest('[role="listbox"]')).toBe(listbox);
    expect(
      screen.getByRole("button", { name: "Remove recent search deploy" }),
    ).toHaveAttribute("aria-keyshortcuts", "Delete");
  });

  it("keeps the highlight on the next recent after a removal and runs it on Enter", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    expect(results().getAllByRole("option")[4]).toHaveTextContent("deploy");

    fireEvent.keyDown(input, { key: "Delete" });

    const options = results().getAllByRole("option");
    expect(options[4]).toHaveTextContent("freeze");
    // The highlight follows the row that moved up, rather than resetting to the
    // first scope card.
    expect(input).toHaveAttribute("aria-activedescendant", options[4]!.id);
    expect(options[4]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("freeze");
  });

  it("forgets the next recent with a second Delete", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }

    fireEvent.keyDown(input, { key: "Delete" });
    fireEvent.keyDown(input, { key: "Delete" });

    expect(readGlobalSearchStore(TENANT).queries).toEqual([]);
    expect(screen.queryByText("Recent")).toBeNull();
    const options = results().getAllByRole("option");
    expect(options).toHaveLength(4);
    // The highlight clamps to the last remaining row.
    expect(input).toHaveAttribute("aria-activedescendant", options[3]!.id);
  });

  it("leaves Delete to the field while it holds text", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seededStore()));
    await renderDialog();
    const input = screen.getByRole("combobox", { name: INPUT_NAME });
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }

    // Recent rows stay on screen while the typed query is still settling.
    fireEvent.change(input, { target: { value: "deploy" } });
    expect(screen.getByText("Recent")).toBeVisible();
    expect(fireEvent.keyDown(input, { key: "Delete" })).toBe(true);
    expect(readGlobalSearchStore(TENANT).queries).toEqual(["deploy", "freeze"]);
  });

  it("accepts Cmd/Ctrl+K anywhere, including editors, but not mid-composition", () => {
    expect(
      isGlobalSearchShortcut(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
      ),
    ).toBe(true);
    expect(
      isGlobalSearchShortcut(
        new KeyboardEvent("keydown", { key: "K", ctrlKey: true }),
      ),
    ).toBe(true);
    expect(
      isGlobalSearchShortcut(new KeyboardEvent("keydown", { key: "k" })),
    ).toBe(false);
    expect(
      isGlobalSearchShortcut(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(false);
    expect(
      isGlobalSearchShortcut(
        new KeyboardEvent("keydown", {
          isComposing: true,
          key: "k",
          metaKey: true,
        }),
      ),
    ).toBe(false);

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editor.append(child);
    document.body.append(editor);
    let seen: KeyboardEvent | undefined;
    window.addEventListener("keydown", (event) => (seen = event), {
      once: true,
    });
    child.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "k", metaKey: true }),
    );
    expect(seen).toBeDefined();
    expect(isGlobalSearchShortcut(seen!)).toBe(true);
    editor.remove();
  });
});

function seededStore(): GlobalSearchStore {
  return { queries: ["deploy", "freeze"] };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <p data-testid="location">
      {location.pathname}
      {location.search}
    </p>
  );
}

/** The shell mounts the dialog only while search is open, so closing unmounts
 * it and the next opening starts fresh. */
function ClosableSearch({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {open ? (
        <GlobalSearchDialog
          onClose={() => {
            setOpen(false);
            onClose();
          }}
          tenantId={TENANT}
        />
      ) : null}
      <button onClick={() => setOpen(true)} type="button">
        Reopen search
      </button>
    </>
  );
}

async function renderDialog({
  closable = false,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  room,
}: {
  closable?: boolean;
  queryClient?: QueryClient;
  room?: SearchRoomScope;
} = {}) {
  const runtime = createTestTeamHubRuntime();

  const documents = await teamHubData(
    runtime.client.api.GET("/v0/library/documents/search", {
      params: { query: { q: "product-v0-brief" } },
    }),
  );
  const messages = await teamHubData(
    runtime.client.api.GET("/v0/rooms/{roomId}/messages", {
      params: { path: { roomId: "room-all" } },
    }),
  );
  const samples = async () => ({
    document: documents.items[0] as TeamHubDocument,
    message: messages.items[0] as TeamHubMessage,
  });
  const searchMessages = vi.fn(
    (_request: TestRouteRequest): unknown => emptySearchPage,
  );
  runtime.server.on(
    "GET",
    "/v0/tenants/{tenantId}/messages/search",
    searchMessages,
  );
  const searchDocuments = vi.fn(
    (_request: TestRouteRequest): unknown => emptySearchPage,
  );
  runtime.server.on("GET", "/v0/library/documents/search", searchDocuments);
  const onClose = vi.fn();
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            {closable ? (
              <ClosableSearch onClose={onClose} />
            ) : (
              <GlobalSearchDialog
                onClose={onClose}
                room={room}
                tenantId={TENANT}
              />
            )}
            <LocationProbe />
          </>
        ),
        path: "/t/:tenantId/library",
      },
      { element: <LocationProbe />, path: "*" },
    ],
    { initialEntries: [`/t/${TENANT}/library`] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("combobox", { name: INPUT_NAME });
  return { onClose, router, runtime, samples, searchDocuments, searchMessages };
}

const emptySearchPage = { items: [], page: { has_more: false } };

function searchRequests(handler: { mock: { calls: [TestRouteRequest][] } }) {
  return handler.mock.calls.map(([{ params, query, request }]) => ({
    params,
    query: Object.fromEntries(query),
    signal: request.signal,
  }));
}

function messageHit(
  message: TeamHubMessage,
  text: string,
  room: TeamHubMessageSearchHit["room"],
): TeamHubMessageSearchHit {
  return {
    message: {
      ...message,
      raw_message: text,
      room_id: room.id,
    },
    room,
  };
}

/** Rest the pointer on a row long enough for it to become the active row. */
async function hover(element: Element) {
  fireEvent.mouseMove(element);
  await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
}

function createTestStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
