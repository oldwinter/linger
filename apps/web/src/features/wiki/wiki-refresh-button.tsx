import { RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TeamHubPersonalWikiRefreshOutcome } from "@/features/teamhub/teamhub-types";

import { useRequestWikiRefresh } from "./wiki-refresh";

const outcomeText: Record<TeamHubPersonalWikiRefreshOutcome, string> = {
  accepted: "Wiki refresh started.",
  already_latest: "Your Wiki is already up to date.",
  in_progress: "A Wiki refresh is already running.",
  no_sources: "Add a source before refreshing your Wiki.",
};

/**
 * The Wiki tab's own refresh action. Its outcome is shown in plain words, and
 * the polling hook reloads the pages while the server runs the refresh.
 */
export function WikiRefreshButton({
  refreshing,
  tenantId,
}: {
  refreshing: boolean;
  tenantId: string;
}) {
  const request = useRequestWikiRefresh(tenantId);
  const message = request.error
    ? request.error.message || "Wiki refresh could not start."
    : request.isPending || refreshing
      ? null
      : request.data
        ? outcomeText[request.data.outcome]
        : null;
  return (
    <div className="ml-auto flex items-center gap-3">
      {message ? (
        <span
          className="text-xs text-muted-foreground"
          role={request.error ? "alert" : "status"}
        >
          {message}
        </span>
      ) : null}
      <Button
        disabled={refreshing}
        loading={request.isPending}
        onClick={() => request.mutate()}
        size="compact"
        title={
          refreshing
            ? "A Wiki refresh is already running"
            : "Refresh your Wiki from its sources"
        }
        tone="ghost"
      >
        <Icon icon={RefreshIcon} size={14} className="shrink-0" />
        {refreshing ? "Refreshing…" : "Refresh Wiki"}
      </Button>
    </div>
  );
}
