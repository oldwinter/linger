import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { useWikiDocuments } from "./knowledge-sidebar-trees";
import {
  deferred,
  serveWikiDocuments,
  wikiDocument,
} from "./wiki.test-support";

describe("useWikiDocuments", () => {
  it("loads every page without a Load more action", async () => {
    const runtime = createTestTeamHubRuntime();
    const list = serveWikiDocuments(runtime)
      .mockResolvedValueOnce({
        items: [wikiDocument("first", "First page", "wiki_page")],
        page: { has_more: true, next_cursor: "cursor with space" },
      })
      .mockResolvedValueOnce({
        items: [wikiDocument("next", "Next page", "wiki_page")],
        page: { has_more: false },
      });

    const { result } = renderDocuments(runtime);

    await waitFor(() =>
      expect(pageIds(result.current.data)).toEqual(["first", "next"]),
    );
    expect(result.current.hasNextPage).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]?.[0].query.get("cursor")).toBe(
      "cursor with space",
    );
  });

  it("does not request a repeated cursor indefinitely", async () => {
    const runtime = createTestTeamHubRuntime();
    const list = serveWikiDocuments(runtime)
      .mockResolvedValueOnce({
        items: [wikiDocument("first", "First page", "wiki_page")],
        page: { has_more: true, next_cursor: "same" },
      })
      .mockResolvedValue({
        items: [wikiDocument("next", "Next page", "wiki_page")],
        page: { has_more: true, next_cursor: "same" },
      });

    const { result } = renderDocuments(runtime);

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a later page fails and recovers on retry", async () => {
    const runtime = createTestTeamHubRuntime();
    const list = serveWikiDocuments(runtime)
      .mockResolvedValueOnce({
        items: [wikiDocument("first", "First page", "wiki_page")],
        page: { has_more: true, next_cursor: "next" },
      })
      .mockResolvedValueOnce(
        teamHubErrorResponse(500, "WIKI_UNAVAILABLE", "next page unavailable"),
      )
      .mockResolvedValueOnce({
        items: [wikiDocument("first", "First page", "wiki_page")],
        page: { has_more: true, next_cursor: "next" },
      })
      .mockResolvedValueOnce({
        items: [wikiDocument("last", "Last page", "wiki_page")],
        page: { has_more: false },
      });

    const { result } = renderDocuments(runtime);

    await waitFor(() =>
      expect(result.current.error?.message).toContain("next page unavailable"),
    );
    expect(list).toHaveBeenCalledTimes(2);

    await act(() => result.current.refetch());
    await waitFor(() =>
      expect(pageIds(result.current.data)).toEqual(["first", "last"]),
    );
    expect(result.current.error).toBeNull();
    expect(list).toHaveBeenCalledTimes(4);
  });

  it("fails closed on a page that belongs to another Tenant", async () => {
    const runtime = createTestTeamHubRuntime();
    serveWikiDocuments(runtime).mockResolvedValue({
      items: [
        {
          ...wikiDocument("foreign", "Foreign page", "wiki_page"),
          tenant_id: "tenant-other",
        },
      ],
      page: { has_more: false },
    });

    const { result } = renderDocuments(runtime);

    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        "Wiki Documents are unavailable.",
      ),
    );
  });

  it("does not reuse Documents across Tenants", async () => {
    const runtime = createTestTeamHubRuntime();
    serveWikiDocuments(runtime).mockImplementation(
      async ({ params: { tenantId = "" } }) => ({
        items: [
          moveDocumentToTenant(
            wikiDocument(
              `document-${tenantId}`,
              `Page for ${tenantId}`,
              "wiki_page",
            ),
            tenantId,
          ),
        ],
        page: { has_more: false },
      }),
    );

    const { rerender, result } = renderDocuments(runtime);
    await waitFor(() =>
      expect(pageIds(result.current.data)).toEqual([
        "document-tenant-northstar",
      ]),
    );

    rerender({ tenantId: "tenant-other" });

    await waitFor(() =>
      expect(pageIds(result.current.data)).toEqual(["document-tenant-other"]),
    );
  });

  it("ignores a late page from the previous Tenant", async () => {
    const runtime = createTestTeamHubRuntime();
    const late = deferred<{
      items: TeamHubDocument[];
      page: { has_more: false };
    }>();
    serveWikiDocuments(runtime).mockImplementation(
      async ({ params: { tenantId = "" } }) => {
        if (tenantId === "tenant-northstar") return late.promise;
        return {
          items: [
            moveDocumentToTenant(
              wikiDocument("current", "Current Tenant page", "wiki_page"),
              tenantId,
            ),
          ],
          page: { has_more: false },
        };
      },
    );

    const { rerender, result } = renderDocuments(runtime);
    rerender({ tenantId: "tenant-other" });
    await waitFor(() =>
      expect(pageIds(result.current.data)).toEqual(["current"]),
    );

    await act(async () => {
      late.resolve({
        items: [wikiDocument("late", "Late previous page", "wiki_page")],
        page: { has_more: false },
      });
      await late.promise;
    });

    expect(pageIds(result.current.data)).toEqual(["current"]);
  });
});

function renderDocuments(runtime: TestTeamHubRuntime) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(
    ({ tenantId }: { tenantId: string }) => useWikiDocuments(tenantId),
    {
      initialProps: { tenantId: "tenant-northstar" },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <TeamHubRuntimeProvider runtime={runtime}>
            {children}
          </TeamHubRuntimeProvider>
        </QueryClientProvider>
      ),
    },
  );
}

function pageIds(data: { pages: { items: TeamHubDocument[] }[] } | undefined) {
  return data?.pages.flatMap((page) => page.items.map((item) => item.id)) ?? [];
}

function moveDocumentToTenant(
  document: TeamHubDocument,
  tenantId: string,
): TeamHubDocument {
  return {
    ...document,
    creator: { ...document.creator, tenant_id: tenantId },
    owner: { ...document.owner, tenant_id: tenantId },
    tenant_id: tenantId,
  };
}
