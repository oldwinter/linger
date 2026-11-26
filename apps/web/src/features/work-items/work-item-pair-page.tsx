import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { collectTeamHubCursorPages } from "@/features/teamhub/teamhub-cursor-pages";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { tenantWorkItemTargetQueryOptions } from "./work-item-queries";
import {
  sanitizeWorkItemBoardSearch,
  workItemPairContrast,
  type WorkItemPairNavigationState,
} from "./work-item-pair";
import { workItemActivityText } from "./work-item-story";
import { workItemsMessages as m } from "./work-items.messages";

/** Two Work Items from the board, read next to each other. The board stays put. */
export function WorkItemPairPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const location = useLocation();
  const search = useSearchParams()[0];
  const leftId = search.get("left") ?? "";
  const rightId = search.get("right") ?? "";
  const navState = (location.state ??
    null) as WorkItemPairNavigationState | null;
  const boardSearch = sanitizeWorkItemBoardSearch(
    search.get("from") ?? navState?.boardSearch,
  );
  const restoreSelectedIds = navState?.selectedIds?.length
    ? navState.selectedIds
    : leftId && rightId && leftId !== rightId
      ? [leftId, rightId]
      : undefined;
  const left = useQuery({
    ...tenantWorkItemTargetQueryOptions(client, tenantId, leftId),
    enabled: leftId.length > 0,
  });
  const right = useQuery({
    ...tenantWorkItemTargetQueryOptions(client, tenantId, rightId),
    enabled: rightId.length > 0 && rightId !== leftId,
  });
  const ready = left.data && right.data;
  const contrast = ready
    ? workItemPairContrast(
        {
          priority: left.data.priority,
          room: Boolean(left.data.work_room_id),
          state: left.data.state,
          title: left.data.title,
        },
        {
          priority: right.data.priority,
          room: Boolean(right.data.work_room_id),
          state: right.data.state,
          title: right.data.title,
        },
      )
    : undefined;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7 md:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">{t(m.sideBySideTitle)}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(m.sideBySideDescription)}
          </p>
          {contrast ? (
            <p className="mt-3 text-sm text-foreground">{contrast}</p>
          ) : null}
        </header>
        {leftId.length === 0 || rightId.length === 0 || leftId === rightId ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.chooseTwoItems)}
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <WorkItemColumn
              error={left.error}
              fetching={left.isFetching}
              item={left.data}
              onRetry={() => void left.refetch()}
              pending={left.isPending}
              tenantId={tenantId}
              workItemId={leftId}
            />
            <WorkItemColumn
              error={right.error}
              fetching={right.isFetching}
              item={right.data}
              onRetry={() => void right.refetch()}
              pending={right.isPending}
              tenantId={tenantId}
              workItemId={rightId}
            />
          </div>
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          state={
            restoreSelectedIds
              ? ({
                  selectedIds: restoreSelectedIds,
                } satisfies WorkItemPairNavigationState)
              : undefined
          }
          to={{
            pathname: `/t/${encodeURIComponent(tenantId)}/dashboard`,
            search: boardSearch,
          }}
        >
          {t(m.backToBoard)}
        </Link>
      </div>
    </main>
  );
}

function WorkItemColumn({
  error,
  fetching,
  item,
  onRetry,
  pending,
  tenantId,
  workItemId,
}: {
  error: Error | null;
  fetching: boolean;
  item: TeamHubWorkItem | undefined;
  onRetry: () => void;
  pending: boolean;
  tenantId: string;
  workItemId: string;
}) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const timeline = useQuery({
    enabled: Boolean(item),
    queryFn: () =>
      collectTeamHubCursorPages((page) =>
        teamHubData(
          client.api.GET("/v0/work-items/{workItemId}/timeline", {
            params: { path: { workItemId }, query: page },
          }),
        ),
      ),
    queryKey: ["teamhub", tenantId, "work-items", workItemId, "pair-timeline"],
  });
  if (pending) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t(m.loadingWorkItem)}
      </p>
    );
  }
  if (error && !(error instanceof TeamHubError && error.status === 404)) {
    return (
      <div className="space-y-3" role="alert">
        <p className="text-sm text-app-danger">
          {error.message || t(m.workItemLoadFailed)}
        </p>
        <Button
          disabled={fetching}
          onClick={onRetry}
          size="compact"
          tone="secondary"
        >
          {fetching ? t(m.retrying) : t(commonMessages.retry)}
        </Button>
      </div>
    );
  }
  if (!item) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t(m.workItemNotOnDashboard)}
      </p>
    );
  }
  const story = (timeline.data?.items ?? []).flatMap((entry) =>
    entry.type === "activity" ? [workItemActivityText(entry.activity)] : [],
  );
  return (
    <article
      aria-label={item.title}
      className="flex flex-col gap-3 rounded-2xl border border-border px-4 py-4"
    >
      <h2 className="text-lg text-foreground">{item.title}</h2>
      <p className="whitespace-pre-wrap text-sm text-foreground">
        {item.description.trim() ? item.description : t(m.noDescriptionYet)}
      </p>
      {story.length > 0 ? (
        <ol aria-label={`${item.title} story`} className="flex flex-col gap-2">
          {story.map((line, index) => (
            <li
              className="text-sm text-muted-foreground"
              key={`${index}-${line}`}
            >
              {line}
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}
