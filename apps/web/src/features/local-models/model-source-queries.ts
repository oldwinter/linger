import type { components } from "@linger/wire-contracts/teamhub-public/types";
import { queryOptions } from "@tanstack/react-query";

import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";

type Schemas = components["schemas"];
export type ModelSourceView = Schemas["ModelSourceView"];
export type ModelSourceStatus = Schemas["ModelSourceStatus"];
export type ModelSourceMode = Schemas["ModelSourceMode"];
export type ModelSourceRuntime = Schemas["ModelSourceRuntime"];
export type ModelSourceSwitchRequest = Schemas["ModelSourceSwitchRequest"];
export type ByokInput = Schemas["ByokInput"];
export type ByokTestRequest = Schemas["ByokTestRequest"];
export type ByokEndpointInput = Schemas["ByokEndpointInput"];
export type ByokModel = Schemas["ByokModel"];

const modelSourcePath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/model-source";
const modelSourceTestPath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/model-source/test";
const modelSourceModelsPath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/model-source/models";

export function modelSourceQueryKey(tenantId: string, computerId: string) {
  return ["teamhub", tenantId, "model-source", computerId] as const;
}

/**
 * Where one Computer's Agents get their model. Reading it asks the Computer,
 * so it is not refetched on local-models hints, only after a switch.
 */
export function modelSourceQueryOptions(
  client: TeamHubClient,
  tenantId: string,
  computerId: string,
) {
  return queryOptions({
    queryFn: ({ signal }) =>
      teamHubData(
        client.api.GET(modelSourcePath, {
          params: { path: { computerId, tenantId } },
          signal,
        }),
      ),
    queryKey: modelSourceQueryKey(tenantId, computerId),
    retry: false,
    staleTime: 60_000,
  });
}

/** Switches the Computer, then moves its Agents; may take minutes. */
export function switchModelSource(
  client: TeamHubClient,
  tenantId: string,
  computerId: string,
  body: ModelSourceSwitchRequest,
) {
  return teamHubData(
    client.api.POST(modelSourcePath, {
      body,
      params: { path: { computerId, tenantId } },
    }),
  );
}

/**
 * Probes a BYOK endpoint from the Computer without saving it, finding the
 * wire format it answers for the Runtime.
 */
export function testByokEndpoint(
  client: TeamHubClient,
  tenantId: string,
  computerId: string,
  body: ByokTestRequest,
) {
  return teamHubData(
    client.api.POST(modelSourceTestPath, {
      body,
      params: { path: { computerId, tenantId } },
    }),
  );
}

/**
 * The models a BYOK endpoint lists, asked from the Computer. `keyRevision`
 * stands in for the API key, which stays out of the query key; it changes
 * whenever the owner enters a different key.
 */
export function byokModelsQueryOptions(
  client: TeamHubClient,
  tenantId: string,
  computerId: string,
  endpoint: ByokEndpointInput,
  keyRevision: number,
) {
  return queryOptions({
    enabled: endpoint.base_url !== "",
    gcTime: 0,
    queryFn: ({ signal }) =>
      teamHubData(
        client.api.POST(modelSourceModelsPath, {
          body: endpoint,
          params: { path: { computerId, tenantId } },
          signal,
        }),
      ),
    queryKey: [
      "teamhub",
      tenantId,
      "byok-models",
      computerId,
      endpoint.base_url,
      keyRevision,
    ] as const,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
