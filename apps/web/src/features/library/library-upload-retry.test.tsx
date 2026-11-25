import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TeamHubError } from "@/features/teamhub/teamhub-client";
import {
  TeamHubRuntimeProvider,
  type TeamHubRuntime,
} from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import {
  resetTenantUploadsForTest,
  tenantUploads,
} from "./library-upload-queue";
import { useMyDocumentsUploads } from "./use-my-documents-uploads";

function createWrapper(queryClient: QueryClient, runtime: TeamHubRuntime) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TeamHubRuntimeProvider runtime={runtime}>
            {children}
          </TeamHubRuntimeProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
}

describe("Library upload failure formatting and retry", () => {
  it("formats 413 limit_bytes and retries the retained File cleanly without duplicates", async () => {
    const runtime = createTestTeamHubRuntime();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const file = new File(["hello world"], "spec.md", {
      type: "text/markdown",
    });

    let attempts = 0;
    const uploadSpy = vi
      .spyOn(runtime.client, "uploadPersonalWikiDocument")
      .mockImplementation(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TeamHubError({
            code: "PAYLOAD_TOO_LARGE",
            details: [
              {
                code: "too_large",
                field: "content",
                limit_bytes: 25 * 1024 * 1024,
                reason: "exceeds the document size limit",
              },
            ],
            message: "Document content exceeds the configured limit",
            status: 413,
          });
        }
        return {
          id: "doc-retried",
          status: "active",
          tenant_id: "tenant-northstar",
          title: "spec.md",
        } as unknown as Awaited<
          ReturnType<typeof runtime.client.uploadPersonalWikiDocument>
        >;
      });

    const { result } = renderHook(
      () =>
        useMyDocumentsUploads({
          creating: null,
          expandFolder: vi.fn(),
          items: [],
          onChanged: vi.fn(async () => undefined),
          setCreating: vi.fn(),
          setError: vi.fn(),
          tenantId: "tenant-northstar",
        }),
      { wrapper: createWrapper(queryClient, runtime) },
    );

    await act(async () => {
      await result.current.importDocument(file);
    });

    await waitFor(() => expect(result.current.failedUploads).toHaveLength(1));
    expect(result.current.failedUploads[0]).toMatchObject({
      filename: "spec.md",
      message: "11 B exceeds the 25 MB limit.",
    });
    expect(result.current.failedUploads[0]?.source?.file).toBe(file);

    const failureId = result.current.failedUploads[0]!.id!;
    await act(async () => {
      await result.current.retryFailedUpload(failureId);
    });

    await waitFor(() => expect(result.current.failedUploads).toHaveLength(0));
    expect(uploadSpy).toHaveBeenCalledTimes(2);
    resetTenantUploadsForTest();
  });

  it("preserves non-retryable and earlier failed entries across multi-parent retryAllFailedUploads", async () => {
    resetTenantUploadsForTest();
    const runtime = createTestTeamHubRuntime();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fileA = new File(["alpha"], "alpha.md", { type: "text/markdown" });
    const fileB = new File(["beta"], "beta.md", { type: "text/markdown" });

    vi.spyOn(runtime.client, "uploadPersonalWikiDocument").mockImplementation(
      async (_tenantId, input) => {
        if (input.file.name === "alpha.md") {
          throw new Error("alpha still failing");
        }
        return {
          id: "doc-beta",
          status: "active",
          tenant_id: "tenant-northstar",
          title: "beta.md",
        } as unknown as Awaited<
          ReturnType<typeof runtime.client.uploadPersonalWikiDocument>
        >;
      },
    );

    tenantUploads.setError("tenant-northstar", {
      failures: [
        {
          filename: "unreadable.md",
          id: "fail-nonretryable",
          message: "Could not read file",
        },
        {
          filename: "alpha.md",
          id: "fail-alpha",
          message: "alpha initial fail",
          parentId: "folder-a",
          source: { file: fileA, folderPath: [] },
        },
        {
          filename: "beta.md",
          id: "fail-beta",
          message: "beta initial fail",
          parentId: "folder-b",
          source: { file: fileB, folderPath: [] },
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useMyDocumentsUploads({
          creating: null,
          expandFolder: vi.fn(),
          items: [],
          onChanged: vi.fn(async () => undefined),
          setCreating: vi.fn(),
          setError: vi.fn(),
          tenantId: "tenant-northstar",
        }),
      { wrapper: createWrapper(queryClient, runtime) },
    );

    await act(async () => {
      await result.current.retryAllFailedUploads();
    });

    await waitFor(() => expect(result.current.failedUploads).toHaveLength(2));
    expect(
      result.current.failedUploads.map((failure) => failure.filename),
    ).toEqual(["unreadable.md", "alpha.md"]);
    resetTenantUploadsForTest();
  });
});
