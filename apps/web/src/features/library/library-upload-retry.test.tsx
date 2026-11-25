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
                field: "file",
                limit_bytes: 25 * 1024 * 1024,
                reason: "too_large",
              },
            ],
            message: "document exceeds 25 MB limit",
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
      message: expect.stringContaining("25 MB"),
    });
    expect(result.current.failedUploads[0]?.source?.file).toBe(file);

    const failureId = result.current.failedUploads[0]!.id!;
    await act(async () => {
      await result.current.retryFailedUpload(failureId);
    });

    await waitFor(() => expect(result.current.failedUploads).toHaveLength(0));
    expect(uploadSpy).toHaveBeenCalledTimes(2);
  });
});
