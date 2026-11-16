import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { collectTeamHubCursorPages } from "@/features/teamhub/teamhub-cursor-pages";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { dayKey } from "@/lib/date-format";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";

import { useMeetings } from "@/features/memory/memory-queries";
import { roomMembersQueryOptions } from "@/features/rooms/room-queries";

import {
  assigneesMissingFromRoom,
  assigneesMissingFromRoomText,
} from "./assignee-not-in-room";
import { loadNoteFromThatDay } from "./note-from-that-day";
import { tenantWorkItemTargetQueryOptions } from "./work-item-queries";
import { dashboardWorkItemPath } from "./work-item-routes";
import { workItemActivityText, workRoomPath } from "./work-item-story";
import {
  workOpenedDuringMeeting,
  workOpenedDuringMeetingText,
} from "./work-opened-during-meeting";

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
  const meetings = useMeetings(tenantId);
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
  const openedDuring = item
    ? workOpenedDuringMeeting(
        meetings.data ?? [],
        new Date(item.created_at),
        tenantId,
      )
    : undefined;
  const openedDay = item ? dayKey(new Date(item.created_at)) : undefined;
  const noteQuery = useQuery({
    enabled: Boolean(openedDay),
    queryFn: () => loadNoteFromThatDay(client, tenantId, openedDay ?? ""),
    queryKey: ["teamhub", tenantId, "pocket-note-for-work", openedDay],
  });
  const members = useQuery({
    ...roomMembersQueryOptions(client, tenantId, item?.work_room_id ?? ""),
    enabled: Boolean(item?.work_room_id && item.assignees.length > 0),
  });
  const missingAssignees =
    item && members.data
      ? assigneesMissingFromRoom(
          item.assignees.map((assignee) => ({
            id: assignee.actor.id,
            name: assignee.actor.display_name,
          })),
          new Set(members.data.items.map((member) => member.actor.id)),
        )
      : [];
  const missingAssigneeText = assigneesMissingFromRoomText(
    missingAssignees.map((actor) => actor.name),
  );
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
              {openedDuring ? (
                <p className="mt-3 text-sm text-foreground">
                  {workOpenedDuringMeetingText(openedDuring)}{" "}
                  <Link
                    className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    to={openedDuring.href}
                  >
                    Open that meeting
                  </Link>
                </p>
              ) : null}
              <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                {item.description.trim()
                  ? item.description
                  : "No description yet."}
              </p>
              {noteQuery.data ? (
                <blockquote className="mt-4 border-l-2 border-border pl-3">
                  <p className="text-xs text-muted-foreground">
                    Your Pocket note from that day
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                    {noteQuery.data}
                  </p>
                </blockquote>
              ) : null}
              {missingAssigneeText ? (
                <p className="mt-3 text-sm text-foreground" role="status">
                  {missingAssigneeText}
                </p>
              ) : null}
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
