import { AlertCircleIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import type { components } from "@linger/wire-contracts/teamhub-public/types";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { Link, useInRouterContext } from "react-router";

import { Icon } from "@/components/ui/icon";
import type { Message, PluralForms } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";

import { anotherMeQueryOptions } from "../room-queries";
import {
  dismissBackgroundFailure,
  readDismissedBackgroundFailure,
  subscribeDismissedBackgroundFailures,
} from "./another-me-background-failure-dismissal";
import { chatMessages as m } from "./chat.messages";

type BackgroundFailureReason =
  components["schemas"]["AnotherMeBackgroundFailureReason"];

const reasonMessages: Record<BackgroundFailureReason, Message<PluralForms>> = {
  runtime_incompatible: m.backgroundFailedIncompatible,
  runtime_auth_required: m.backgroundFailedSignIn,
  runtime_unavailable: m.backgroundFailedRuntimeUnavailable,
  unknown: m.backgroundFailedUnknown,
};

/** Tops the Another Me Chat while its background model calls keep failing.
 * TeamHub sends the failure from the third in a row and drops it once a call
 * completes or the Runtime changes; the Human can also dismiss it for the
 * current failure reason. */
export function AnotherMeBackgroundFailureBanner({
  client,
  roomId,
  tenantId,
}: {
  client: TeamHubClient;
  roomId: string;
  tenantId: string;
}) {
  const t = useT();
  const inRouter = useInRouterContext();
  const { data } = useQuery(anotherMeQueryOptions(client, tenantId));
  const failure =
    data?.room_id === roomId ? data.background_failure : undefined;
  const dismissedReason = useSyncExternalStore(
    subscribeDismissedBackgroundFailures,
    () => readDismissedBackgroundFailure(tenantId, roomId),
    () => undefined,
  );

  if (!failure || dismissedReason === failure.reason) return null;
  const message = Object.hasOwn(reasonMessages, failure.reason)
    ? reasonMessages[failure.reason]
    : m.backgroundFailedUnknown;
  const checkModels = failure.reason === "runtime_incompatible";
  const recoveryPath = `/t/${encodeURIComponent(tenantId)}/settings/${
    checkModels ? "models" : "computers"
  }`;
  const recoveryLabel = t(
    checkModels
      ? m.backgroundFailedCheckModels
      : m.backgroundFailedCheckComputers,
  );
  const actionClassName =
    "inline-flex min-h-8 shrink-0 items-center rounded-md border border-[var(--app-status-danger-border)] bg-background/80 px-2.5 py-1 text-xs font-medium text-[var(--app-status-danger-text)] transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="room-readable shrink-0 px-4 pt-3">
      <div
        className="flex min-h-9 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-3.5 py-2 text-xs font-medium text-[var(--app-status-danger-text)]"
        role="alert"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon className="mt-0.5 shrink-0" icon={AlertCircleIcon} size={14} />
          <span className="min-w-0 leading-5">
            {t(message, { count: failure.consecutive_failures })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {inRouter ? (
            <Link className={actionClassName} to={recoveryPath}>
              {recoveryLabel}
            </Link>
          ) : (
            <a className={actionClassName} href={recoveryPath}>
              {recoveryLabel}
            </a>
          )}
          <button
            aria-label={t(m.dismissBackgroundFailureNotice)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--app-status-danger-text)]/80 transition-colors hover:bg-background/60 hover:text-[var(--app-status-danger-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-voice-close=""
            onClick={() =>
              dismissBackgroundFailure(tenantId, roomId, failure.reason)
            }
            type="button"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
