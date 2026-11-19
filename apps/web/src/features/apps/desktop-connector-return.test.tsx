import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import {
  externalConnectionsQueryKey,
  tenantExternalConnectionsQueryKey,
} from "./connected-apps-queries";
import { DesktopConnectorReturn } from "./desktop-connector-return";

afterEach(() => vi.unstubAllGlobals());

it("asks the signed-in client to verify the return and refreshes connector queries", async () => {
  let returned: ((account?: string) => void) | undefined;
  const unsubscribe = vi.fn();
  vi.stubGlobal("lingerDesktop", {
    connectorOAuth: {
      onReturn(listener: (account?: string) => void) {
        returned = listener;
        return unsubscribe;
      },
    },
  });
  const runtime = createTestTeamHubRuntime();
  const complete = vi
    .spyOn(runtime.client, "completeExternalConnectionAuthorization")
    .mockResolvedValue(undefined);
  const cache = new QueryClient();
  const own = externalConnectionsQueryKey();
  const tenant = tenantExternalConnectionsQueryKey("tenant-test");
  const unrelated = ["teamhub", "unrelated"];
  for (const key of [own, tenant, unrelated]) cache.setQueryData(key, []);
  const view = render(
    <QueryClientProvider client={cache}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <DesktopConnectorReturn />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );

  expect(returned).toBeTypeOf("function");
  returned?.("ca_returned");
  await waitFor(() =>
    expect(cache.getQueryState(own)?.isInvalidated).toBe(true),
  );
  expect(cache.getQueryState(tenant)?.isInvalidated).toBe(true);
  expect(cache.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(complete).toHaveBeenCalledExactlyOnceWith("ca_returned");
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
