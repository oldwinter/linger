import { isRecord } from "@linger/service-kit";
import type { JsonLogger } from "@linger/service-kit/node";
import { createTeamHubAgentRuntimeStateClient } from "@linger/wire-contracts/teamhub-internal/client";
import type { components } from "@linger/wire-contracts/teamhub-internal/types";

import type { ModelCallKind } from "./model-tasks.js";

type AnotherMePlacement = components["schemas"]["AnotherMePlacement"];

export type LocalRuntimeType = "codex" | "claude" | "pi" | "antigravity";

export interface ModelOwner {
  readonly tenantId: string;
  readonly ownerActorId: string;
}

/** Where an Agent runs; the Daemon refuses a call for a locally stopped Agent. */
export interface ModelPlacement extends ModelOwner {
  /** The Agent Service Agent id. */
  readonly agentId: string;
  readonly computerId: string;
  readonly runtimeType: LocalRuntimeType;
  /** The model configured for this Agent on its local Runtime. */
  readonly model?: string;
  /** The Another Me's own actor; TeamHub placements always carry it. */
  readonly agentActorId?: string;
}

/** Placements of active Another Me Agents; with an owner, only that owner's. */
export type AnotherMePlacementSource = (
  owner: ModelOwner | undefined,
  signal?: AbortSignal,
) => Promise<readonly ModelPlacement[]>;

/** Why a background call failed, as its Human is told. */
export type BackgroundFailureReason =
  | "runtime_incompatible"
  | "runtime_auth_required"
  | "runtime_unavailable"
  | "unknown";

/** How one background call that ran on an Another Me's Computer ended. */
export interface BackgroundCallOutcome {
  readonly tenantId: string;
  readonly agentActorId: string;
  readonly kind: ModelCallKind;
  /** Absent for a completed call. */
  readonly failure?: BackgroundFailureReason;
}

/** Active Another Me placements read from TeamHub. */
export function createTeamHubAnotherMePlacementSource(options: {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly fetch?: typeof fetch;
}): AnotherMePlacementSource {
  const client = createTeamHubAgentRuntimeStateClient({
    baseUrl: options.baseUrl,
    serviceToken: options.serviceToken,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return async (owner, signal) => {
    const response = await client.listAnotherMePlacements(owner, signal);
    if (!response.ok)
      throw new Error(
        `TeamHub Another Me placements request failed (${response.status})`,
      );
    const body: unknown = await response.json();
    return (isRecord(body) && Array.isArray(body.items) ? body.items : [])
      .filter(isPlacementItem)
      .map((item) => ({
        tenantId: item.tenant_id,
        ownerActorId: item.owner_actor_id,
        agentId: item.agent_id,
        computerId: item.computer_id,
        runtimeType: item.local_runtime_type,
        ...(typeof item.runtime_model === "string" && item.runtime_model
          ? { model: item.runtime_model }
          : {}),
        agentActorId: item.agent_actor_id,
      }));
  };
}

/** How long a background outcome report may take before it is dropped. */
const BACKGROUND_REPORT_TIMEOUT_MS = 10_000;

/** Sends each background call's outcome to TeamHub, which counts an Another
 * Me's failures in a row for its Human. Nobody waits on a report: a failed
 * one, including a TeamHub that predates the route, only logs a warning. */
export function createTeamHubBackgroundOutcomeReporter(options: {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly logger: Pick<JsonLogger, "log">;
  readonly fetch?: typeof fetch;
}): (outcome: BackgroundCallOutcome) => void {
  const client = createTeamHubAgentRuntimeStateClient({
    baseUrl: options.baseUrl,
    serviceToken: options.serviceToken,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return (outcome) => {
    const failed = (fields: Record<string, unknown>) =>
      options.logger.log("warn", "model_call.background_report_failed", {
        kind: outcome.kind,
        agent_actor_id: outcome.agentActorId,
        ...fields,
      });
    client
      .recordAnotherMeBackgroundCall(
        {
          tenant_id: outcome.tenantId,
          agent_actor_id: outcome.agentActorId,
          outcome: outcome.failure ? "failed" : "completed",
          ...(outcome.failure ? { reason: outcome.failure } : {}),
        },
        AbortSignal.timeout(BACKGROUND_REPORT_TIMEOUT_MS),
      )
      .then(
        (response) => {
          // A body that already errored rejects its cancel.
          void response.body?.cancel().catch(() => undefined);
          if (!response.ok) failed({ status: response.status });
        },
        (error: unknown) => failed({ error }),
      );
  };
}

function isPlacementItem(item: unknown): item is AnotherMePlacement {
  return (
    isRecord(item) &&
    typeof item.tenant_id === "string" &&
    typeof item.owner_actor_id === "string" &&
    typeof item.agent_id === "string" &&
    typeof item.agent_actor_id === "string" &&
    typeof item.computer_id === "string" &&
    (item.local_runtime_type === "codex" ||
      item.local_runtime_type === "claude" ||
      item.local_runtime_type === "pi" ||
      item.local_runtime_type === "antigravity")
  );
}
