import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";

import type {
  WikiRefreshFailureReason,
  WikiRefreshStatus,
} from "./wiki-refresh";
import { WikiWorkingLine } from "./wiki-working-card";

const failureMessages: Record<WikiRefreshFailureReason, string> = {
  computer_offline: "Wiki update failed — Your Computer was offline.",
  runtime_auth_required: "Wiki update failed — Runtime sign-in required.",
  runtime_incompatible:
    "Wiki update failed — Runtime incompatible. Update your local CLI or Linger.",
  runtime_unavailable: "Wiki update failed — Local Runtime is unavailable.",
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
  if (refreshing)
    return (
      <WikiWorkingLine
        actorId={agentActorId}
        className="mb-6"
        text="Another Me is writing your Wiki"
      />
    );
  if (!failed) return null;
  const message =
    failureReason && Object.hasOwn(failureMessages, failureReason)
      ? failureMessages[failureReason]
      : "Wiki update failed";
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
