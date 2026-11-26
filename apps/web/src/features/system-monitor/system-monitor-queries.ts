import type { components } from "@linger/wire-contracts/teamhub-public/types";
import { queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  openEventStream,
  type EventSourceFactory,
  type PageActivity,
} from "@/features/teamhub/event-stream";
import { teamHubData, teamHubUrl } from "@/features/teamhub/teamhub-api";
import { reportTeamHubAuthenticationRequired } from "@/features/teamhub/teamhub-authentication";
import { resolveTeamHubBaseUrl } from "@/features/teamhub/teamhub-base-url";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";

type Schemas = components["schemas"];
export type SystemTelemetryView = Schemas["SystemTelemetryView"];
export type SystemTelemetrySnapshot = Schemas["SystemTelemetrySnapshot"];
export type SystemTelemetryHardware = Schemas["SystemTelemetryHardware"];
export type SystemTelemetryMemory = Schemas["SystemTelemetryMemory"];
export type SystemTelemetryInference = Schemas["SystemTelemetryInference"];
export type SystemTelemetryRequest = Schemas["SystemTelemetryRequest"];
export type SystemTelemetrySlot = Schemas["SystemTelemetrySlot"];
export type SystemTelemetryLoadedModel = Schemas["SystemTelemetryLoadedModel"];
export type SystemTelemetryBottleneck = Schemas["SystemTelemetryBottleneck"];
export type SystemTelemetryCpuCluster = Schemas["SystemTelemetryCpuCluster"];
export type SystemTelemetryThermal = Schemas["SystemTelemetryThermal"];

export const systemTelemetryPath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/system-telemetry";
export const systemTelemetryStreamPath =
  "/v0/tenants/{tenantId}/local-computers/{computerId}/system-telemetry/stream";

export function systemTelemetryQueryKey(tenantId: string, computerId: string) {
  return ["teamhub", tenantId, "system-telemetry", computerId] as const;
}

export function systemTelemetryQueryOptions(
  client: TeamHubClient,
  tenantId: string,
  computerId: string,
) {
  return queryOptions({
    queryFn: ({ signal }) =>
      teamHubData(
        client.api.GET(systemTelemetryPath, {
          params: { path: { computerId, tenantId } },
          signal,
        }),
      ),
    queryKey: systemTelemetryQueryKey(tenantId, computerId),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export type SystemTelemetryStreamStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "paused"
  | "offline";

export interface SystemTelemetryStreamState {
  readonly view: SystemTelemetryView | null;
  readonly status: SystemTelemetryStreamStatus;
  readonly error: string | null;
}

export interface UseSystemTelemetryStreamOptions {
  readonly tenantId: string;
  readonly computerId: string;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly retryToken: number;
  readonly baseUrl?: string;
  readonly pageActivity?: PageActivity;
  readonly eventSourceFactory?: EventSourceFactory;
}

function parseTelemetryEvent(data: string): SystemTelemetryView | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "computer_id" in parsed &&
      "online" in parsed &&
      "supported" in parsed
    ) {
      return parsed as SystemTelemetryView;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Streams live SystemTelemetryView snapshots over TeamHub SSE.
 * Depends strictly on resource identity and stream lifecycle flags so
 * unrelated UI rerenders never recreate the EventSource connection.
 */
export function useSystemTelemetryStream({
  baseUrl,
  computerId,
  enabled,
  eventSourceFactory,
  pageActivity,
  paused,
  retryToken,
  tenantId,
}: UseSystemTelemetryStreamOptions): SystemTelemetryStreamState {
  const [streamRecord, setStreamRecord] = useState<{
    readonly targetKey: string;
    readonly view: SystemTelemetryView | null;
    readonly status: SystemTelemetryStreamStatus;
    readonly error: string | null;
  }>({
    targetKey: `${tenantId}:${computerId}`,
    view: null,
    status: paused ? "paused" : "connecting",
    error: null,
  });

  const targetKey = `${tenantId}:${computerId}`;

  useEffect(() => {
    if (!enabled || paused) {
      return;
    }

    const resolvedBase = resolveTeamHubBaseUrl(baseUrl);
    const url = teamHubUrl(resolvedBase, systemTelemetryStreamPath, {
      path: { computerId, tenantId },
    });

    const close = openEventStream(
      {
        eventSourceFactory,
        pageActivity,
        reconnectDelayMs: 1_500,
        maximumReconnectDelayMs: 15_000,
      },
      {
        closedMessage: "System telemetry stream disconnected.",
        events: {
          telemetry(data, connection) {
            const view = parseTelemetryEvent(data);
            if (!view) return;
            connection.resetBackoff();
            setStreamRecord({
              targetKey,
              view,
              status: view.online ? "live" : "offline",
              error: null,
            });
          },
        },
        onError(error) {
          setStreamRecord((current) => ({
            targetKey,
            view: current.targetKey === targetKey ? current.view : null,
            status: "reconnecting",
            error: error.message,
          }));
        },
        onOpen() {
          setStreamRecord((current) => ({
            targetKey,
            view: current.targetKey === targetKey ? current.view : null,
            status:
              current.targetKey === targetKey && current.view
                ? current.view.online
                  ? "live"
                  : "offline"
                : "connecting",
            error: null,
          }));
        },
        onSessionExpired: reportTeamHubAuthenticationRequired,
        onWaiting(state) {
          setStreamRecord((current) => ({
            targetKey,
            view: current.targetKey === targetKey ? current.view : null,
            status: state === "offline" ? "offline" : "reconnecting",
            error: current.targetKey === targetKey ? current.error : null,
          }));
        },
        prepare() {
          return url;
        },
      },
    );

    return () => {
      close();
    };
  }, [
    baseUrl,
    computerId,
    enabled,
    eventSourceFactory,
    pageActivity,
    paused,
    retryToken,
    targetKey,
    tenantId,
  ]);

  if (streamRecord.targetKey !== targetKey) {
    return {
      view: null,
      status: paused ? "paused" : enabled ? "connecting" : "offline",
      error: null,
    };
  }

  return {
    view: streamRecord.view,
    status: paused ? "paused" : enabled ? streamRecord.status : "offline",
    error: paused ? null : streamRecord.error,
  };
}
