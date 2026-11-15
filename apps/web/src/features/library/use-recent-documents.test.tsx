import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

import { readRecentDocuments } from "./recent-documents";
import { useRecordRecentDocument } from "./use-recent-documents";

function wrapper(signedIn: boolean) {
  const queryClient = new QueryClient();
  if (signedIn) {
    queryClient.setQueryData(teamHubIdentityQueryKey, {
      account: {
        created_at: "2026-07-24T09:00:00Z",
        email: "jenny@northstar.example",
        id: "account-a",
      },
      actors: [],
    });
  }
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function document(): TeamHubDocument {
  const owner = {
    display_name: "Jenny",
    id: "actor-jenny",
    kind: "human" as const,
    tenant_id: "tenant-northstar",
  };
  return {
    can_edit_native_content: true,
    capabilities: {
      comment: true,
      delete: true,
      duplicate: true,
      export: true,
      manage: true,
      read: true,
      use_as_context: true,
      write: true,
    },
    created_at: "2026-07-24T09:00:00Z",
    creator: owner,
    current_version: null,
    draft_capability: "write",
    format: "blocknote",
    from: [],
    id: "document-design",
    owner,
    representation_format: "markdown",
    status: "active",
    tenant_id: "tenant-northstar",
    title: "Design notes.md",
    updated_at: "2026-07-24T10:00:00Z",
  };
}

describe("Recording an opened Document", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records the Document once its page knows its name", () => {
    const { rerender } = renderHook(
      ({ opened }: { opened: TeamHubDocument | undefined }) =>
        useRecordRecentDocument(opened),
      {
        initialProps: { opened: undefined as TeamHubDocument | undefined },
        wrapper: wrapper(true),
      },
    );
    expect(readRecentDocuments("account-a")).toEqual([]);

    rerender({ opened: document() });

    expect(readRecentDocuments("account-a")).toEqual([
      expect.objectContaining({
        formatLabel: "md",
        id: "document-design",
        name: "Design notes",
        openedAt: expect.any(String),
      }),
    ]);
  });

  it("keeps one entry when the page renders the same Document again", () => {
    const { rerender } = renderHook(
      ({ opened }: { opened: TeamHubDocument | undefined }) =>
        useRecordRecentDocument(opened),
      { initialProps: { opened: document() }, wrapper: wrapper(true) },
    );
    rerender({ opened: document() });

    expect(readRecentDocuments("account-a")).toHaveLength(1);
  });

  it("records nothing without a signed-in Account", () => {
    renderHook(
      ({ opened }: { opened: TeamHubDocument | undefined }) =>
        useRecordRecentDocument(opened),
      { initialProps: { opened: document() }, wrapper: wrapper(false) },
    );

    expect(localStorage.length).toBe(0);
  });
});
