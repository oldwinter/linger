import { commonMessages } from "@/i18n/common.messages";
import { formatLocale } from "@/i18n/language";
import { useT, useTranslation } from "@/i18n/use-translation";
import { formatDateTime } from "@/lib/date-format";
import type { PropsWithChildren } from "react";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/features/local-computer/computer-row";
import { LocalRuntimeAuthenticationGuidance } from "@/features/local-computer/local-runtime-authentication-guidance";
import { localRuntimeMessage } from "@/features/local-computer/local-runtime-message";
import type {
  TeamHubRoom,
  TeamHubTenantAgent,
  TeamHubTenantAgentAvailabilitySnapshot,
} from "@/features/teamhub/teamhub-types";
import { composerMessages } from "./composer.messages";

export function projectDirectPeerState(
  room: TeamHubRoom,
  agents: TeamHubTenantAgent[] | undefined,
  availabilitySnapshots: TeamHubTenantAgentAvailabilitySnapshot[] | undefined,
) {
  const directAgent =
    room.kind === "direct" && room.direct_peer?.kind === "agent"
      ? agents?.find((agent) => agent.actor.id === room.direct_peer?.id)
      : undefined;
  const runtimeStatus = availabilitySnapshots?.find(
    (snapshot) => snapshot.actor_id === directAgent?.actor.id,
  )?.local_runtime_status;

  return {
    deleted: room.kind === "direct" && room.direct_peer_active === false,
    directoryUnavailable:
      room.kind === "direct" &&
      room.direct_peer?.kind === "agent" &&
      !directAgent &&
      (agents !== undefined || room.direct_peer_active !== true),
    runtimeStatusUnavailable:
      directAgent?.runtime.placement?.type === "local" && !runtimeStatus,
    runtimeIssue:
      runtimeStatus?.status === "ready" &&
      (!runtimeStatus.connection_status ||
        runtimeStatus.connection_status === "connected")
        ? undefined
        : runtimeStatus,
  };
}

export const directPeerCanCompose = (
  state: ReturnType<typeof projectDirectPeerState>,
): boolean => !state.deleted && !state.directoryUnavailable;

function DirectPeerAvailability({
  children,
  onRetry,
  state,
}: PropsWithChildren<{
  onRetry: () => void;
  state: ReturnType<typeof projectDirectPeerState>;
}>) {
  const t = useT();
  if (state.deleted) return <DeletedAgentNotice />;
  if (state.directoryUnavailable) {
    return <AgentDirectoryUnavailableNotice onRetry={onRetry} />;
  }
  return (
    <>
      {state.runtimeStatusUnavailable ? (
        <p
          className="room-notice-enter room-readable py-3 text-sm text-app-muted"
          role="status"
        >
          {t(composerMessages.localAgentStatusUnavailable)}
        </p>
      ) : state.runtimeIssue ? (
        <LocalRuntimeAttentionNotice status={state.runtimeIssue} />
      ) : null}
      {children}
    </>
  );
}

export function RoomComposerDock({
  children,
  onRetry,
  outboxError,
  state,
}: PropsWithChildren<{
  onRetry: () => void;
  outboxError?: string;
  state: ReturnType<typeof projectDirectPeerState>;
}>) {
  return (
    <div className="room-composer-dock shrink-0 px-3">
      {outboxError ? (
        <p className="mb-2 text-sm text-app-danger" role="alert">
          {outboxError}
        </p>
      ) : null}
      <DirectPeerAvailability onRetry={onRetry} state={state}>
        {children}
      </DirectPeerAvailability>
    </div>
  );
}

function AgentDirectoryUnavailableNotice({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div
      className="room-readable flex items-center justify-between gap-3 border-t border-[var(--app-status-warning-border)] py-4 text-sm text-app-body"
      role="alert"
    >
      <span>{t(composerMessages.agentStatusUnavailable)}</span>
      <Button onClick={onRetry} size="compact" tone="secondary">
        {t(commonMessages.retry)}
      </Button>
    </div>
  );
}

function DeletedAgentNotice() {
  const t = useT();
  return (
    <div
      className="room-readable border-t border-app-border py-4 text-sm text-app-muted"
      role="status"
    >
      {t(composerMessages.agentDeleted)}
    </div>
  );
}

function LocalRuntimeAttentionNotice({
  status,
}: {
  status: NonNullable<
    TeamHubTenantAgentAvailabilitySnapshot["local_runtime_status"]
  >;
}) {
  const { language, t } = useTranslation();
  const authenticationRequired = status.status === "authentication_required";
  const reconnecting = status.connection_status === "reconnecting";
  const unknown =
    status.status === "unknown" || status.connection_status === "unknown";
  if (
    (reconnecting || unknown) &&
    (status.status === "ready" || status.status === "unknown")
  ) {
    // One short line with a status dot; the last confirmation is on hover.
    return (
      <div
        className="room-notice-enter room-readable flex items-center gap-2 py-2 text-xs text-app-muted"
        role="status"
        title={
          status.observed_at
            ? t(composerMessages.lastConfirmedAt, {
                time: formatDateTime(
                  status.observed_at,
                  undefined,
                  formatLocale(language),
                ),
              })
            : undefined
        }
      >
        <StatusDot tone="warning" />
        <span className="font-medium text-app-ink">
          {t(
            reconnecting
              ? composerMessages.reconnectingLocalComputer
              : composerMessages.checkingLocalComputer,
          )}
        </span>
        <span>{t(composerMessages.keepSending)}</span>
      </div>
    );
  }
  return (
    <div
      className="room-readable border-t border-[var(--app-status-warning-border)] py-4 text-sm text-app-body"
      role="status"
    >
      <p className="mb-1 font-medium">{t(composerMessages.agentUnavailable)}</p>
      {authenticationRequired ? (
        <LocalRuntimeAuthenticationGuidance
          runtimeType={status.runtime_type}
          computerName={status.display_name}
        />
      ) : (
        <p className="mt-1 text-app-muted" title={status.message}>
          {localRuntimeMessage(
            status,
            status.runtime_type,
            status.display_name,
            t,
          ) ?? t(composerMessages.checkLocalRuntime)}
        </p>
      )}
      <p className="mt-1 text-app-muted">
        {t(composerMessages.agentCannotReply)}
      </p>
    </div>
  );
}
