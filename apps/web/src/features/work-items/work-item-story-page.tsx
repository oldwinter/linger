import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { collectTeamHubCursorPages } from "@/features/teamhub/teamhub-cursor-pages";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";

import { tenantWorkItemTargetQueryOptions } from "./work-item-queries";
import { dashboardWorkItemPath } from "./work-item-routes";
import { workItemActivityText, workRoomPath } from "./work-item-story";

/**
 * The read-only story of one Work Item: what was written, then what happened.
 * The Dashboard stays the board; this page does not change the Work Item.
 */
export function WorkItemStoryPage() {
  const { client } = useTeamHubRuntime();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const workItemId = requireRoomRouteParam(params.workItemId, "Work Item");
  const itemQuery = useQuery(
    tenantWorkItemTargetQueryOptions(client, tenantId, workItemId),
  );
  const timelineQuery = useQuery({
    queryFn: () =>
      collectTeamHubCursorPages((page) =>
        teamHubData(
          client.api.GET("/v0/work-items/{workItemId}/timeline", {
            params: { path: { workItemId }, query: page },
          }),
        ),
      ),
    queryKey: ["teamhub", tenantId, "work-items", workItemId, "timeline"],
  });
  const item = itemQuery.data;
  const roomId =
    item?.work_room_id ??
    timelineQuery.data?.items.reduce<string | undefined>(
      (found, entry) =>
        found ??
        (entry.type === "activity" ? entry.activity.room_id : undefined),
      undefined,
    );

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7 md:px-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {itemQuery.isPending || timelineQuery.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading this Work Item.
          </p>
        ) : itemQuery.error || !item ? (
          <p className="text-sm text-muted-foreground" role="status">
            This Work Item is not on the Dashboard.
          </p>
        ) : (
          <>
            <header>
              <p className="text-xs text-muted-foreground">
                {item.kind === "issue" ? "Issue" : "Task"} #{item.number}
              </p>
              <h1 className="mt-1 text-xl text-foreground">{item.title}</h1>
              <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                {item.description.trim()
                  ? item.description
                  : "No description yet."}
              </p>
              {item.mandate ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {item.mandate.strength === "create_and_delegate"
                    ? "Created and handed off"
                    : "Created"}{" "}
                  by Another Me under “{item.mandate.rule_text}”.
                </p>
              ) : null}
            </header>
            {timelineQuery.error ? (
              <p className="text-sm text-destructive" role="alert">
                The story could not be loaded.
              </p>
            ) : (
              <section aria-labelledby="work-item-story-heading">
                <h2
                  className="text-sm text-foreground"
                  id="work-item-story-heading"
                >
                  What happened
                </h2>
                {timelineQuery.data?.items.length ? (
                  <ol className="mt-3 flex flex-col gap-3">
                    {timelineQuery.data.items.map((entry) =>
                      entry.type === "comment" ? (
                        <li
                          className="rounded-2xl border border-border px-4 py-3"
                          key={entry.comment.id}
                        >
                          <p className="text-xs text-muted-foreground">
                            {entry.comment.author.display_name}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                            {entry.comment.body.trim()
                              ? entry.comment.body
                              : "A comment was removed."}
                          </p>
                        </li>
                      ) : (
                        <li
                          className="text-sm text-foreground"
                          key={entry.activity.id}
                        >
                          {workItemActivityText(entry.activity)}
                        </li>
                      ),
                    )}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nothing has been recorded yet.
                  </p>
                )}
              </section>
            )}
            {roomId ? (
              <Link
                className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={workRoomPath(tenantId, roomId)}
              >
                Open the Room doing this work
              </Link>
            ) : null}
          </>
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={dashboardWorkItemPath(tenantId, workItemId)}
        >
          Back to the Dashboard
        </Link>
      </div>
    </main>
  );
}
