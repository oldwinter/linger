import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import type {
  WikiRefreshFailureReason,
  WikiRefreshStatus,
} from "./wiki-refresh";
import { WikiWorkingLine } from "./wiki-working-card";
import { wikiMessages as m } from "./wiki.messages";

const failureMessages: Record<WikiRefreshFailureReason, Message<string>> = {
  computer_offline: m.updateFailedComputerOffline,
  runtime_auth_required: m.updateFailedSignIn,
  runtime_incompatible: m.updateFailedIncompatible,
  runtime_unavailable: m.updateFailedRuntimeUnavailable,
};

/** What the Wiki home says while a refresh writes pages, or after one failed.
 * The pages written so far appear in their collections as ordinary cards. */
export function WikiRefreshBanner({
  agentActorId,
  failed,
  failureReason,
  refreshing,
}: Pick<WikiRefreshStatus, "failed" | "failureReason" | "refreshing"> & {
  agentActorId?: string;
}) {
  const t = useT();
  if (refreshing)
    return (
      <WikiWorkingLine
        actorId={agentActorId}
        className="mb-6"
        text={t(m.writingWiki)}
      />
    );
  if (!failed) return null;
  const message = t(
    failureReason && Object.hasOwn(failureMessages, failureReason)
      ? failureMessages[failureReason]
      : m.updateFailed,
  );
  return (
    <div
      className="mb-6 flex min-h-9 items-center gap-2 rounded-lg border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-4 py-2 text-xs font-medium text-[var(--app-status-danger-text)]"
      role="alert"
    >
      <Icon icon={AlertCircleIcon} size={14} />
      {message}
    </div>
  );
}
