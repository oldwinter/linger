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

const modelSourcePath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/model-source";
const modelSourceTestPath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/model-source/test";
const modelSourceModelsPath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/model-source/models";

export function tenantModelSourceQueryKey(tenantId: string) {
  return ["teamhub", tenantId, "model-source"] as const;
}

export function modelSourceQueryKey(tenantId: string, computerId: string) {
  return [...tenantModelSourceQueryKey(tenantId), computerId] as const;
}

/**
 * Where one Computer's Agents get their model. Reading it asks the Computer,
 * so it is not refetched on local-models hints, only on mount, reconnect,
 * computer changes, or after a switch.
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
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
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

/** Sends one request to a BYOK endpoint's address from the Computer, without saving it. */
export function testByokEndpoint(
  client: TeamHubClient,
  tenantId: string,
  computerId: string,
  body: ByokTestRequest,
  signal?: AbortSignal,
) {
  return teamHubData(
    client.api.POST(modelSourceTestPath, {
      body,
      params: { path: { computerId, tenantId } },
      signal,
    }),
  );
}

/**
 * The models a BYOK endpoint lists at its base URL + path + /models, asked
 * from the Computer each time the owner asks for them.
 */
export function listByokModels(
  client: TeamHubClient,
  tenantId: string,
  computerId: string,
  body: ByokEndpointInput,
  signal?: AbortSignal,
) {
  return teamHubData(
    client.api.POST(modelSourceModelsPath, {
      body,
      params: { path: { computerId, tenantId } },
      signal,
    }),
  );
}
