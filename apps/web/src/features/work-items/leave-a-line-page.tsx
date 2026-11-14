import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { collectTeamHubCursorPages } from "@/features/teamhub/teamhub-cursor-pages";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { workItemCommentsKey } from "./leave-a-line";
import { dashboardWorkItemPath } from "./work-item-routes";
import { tenantWorkItemTargetQueryOptions } from "./work-item-queries";

export function LeaveALinePage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const workItemId = requireRoomRouteParam(useParams().workItemId, "Work Item");
  const lineId = useId();
  const lineRef = useRef<HTMLTextAreaElement>(null);
  const [line, setLine] = useState("");
  const [saved, setSaved] = useState(false);
  const workItem = useQuery(
    tenantWorkItemTargetQueryOptions(client, tenantId, workItemId),
  );
  const comments = useQuery({
    enabled: workItem.isSuccess,
    queryFn: () =>
      collectTeamHubCursorPages((page) =>
        teamHubData(
          client.api.GET("/v0/work-items/{workItemId}/comments", {
            params: { path: { workItemId }, query: page },
          }),
        ),
      ),
    queryKey: workItemCommentsKey(workItemId),
  });
  const leave = useMutation({
    mutationFn: (text: string) =>
      teamHubData(
        client.api.POST("/v0/work-items/{workItemId}/comments", {
          params: {
            path: { workItemId },
            header: idempotencyHeader(createTeamHubIdempotencyKey()),
          },
          body: {
            body: text,
            segments: [{ type: "text", content: text }],
          },
        }),
      ),
    onSuccess: async () => {
      setLine("");
      setSaved(true);
      await queryClient.invalidateQueries({
        queryKey: workItemCommentsKey(workItemId),
      });
    },
  });

  useEffect(() => {
    lineRef.current?.focus();
  }, []);

  if (workItem.isPending) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <p role="status">Loading this job...</p>
      </main>
    );
  }

  if (workItem.isError || !workItem.data) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <p role="alert">This job could not be opened.</p>
      </main>
    );
  }

  const lines = (comments.data?.items ?? []).filter(
    (item) => !item.deleted_at && item.body,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = line.trim();
    if (!text || leave.isPending) return;
    setSaved(false);
    leave.mutate(text);
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <p className="text-sm text-muted-foreground">{workItem.data.title}</p>
      <h1 className="mt-1 text-2xl text-foreground">Leave a line</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        This stays on the job. The next person who opens it can read it.
      </p>
      {comments.isPending ? (
        <p className="mt-6 text-sm" role="status">
          Loading lines...
        </p>
      ) : lines.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          No lines on this job yet.
        </p>
      ) : (
        <ol className="mt-6 flex flex-col gap-3">
          {lines.map((item) => (
            <li className="rounded-xl border border-border p-4" key={item.id}>
              <p className="text-sm font-medium text-foreground">
                {item.author.display_name}
              </p>
              <p className="mt-1 text-sm leading-6 text-foreground">
                {item.body}
              </p>
            </li>
          ))}
        </ol>
      )}
      <form className="mt-8" onSubmit={submit}>
        <label className="block" htmlFor={lineId}>
          <span className="mb-1.5 block text-sm font-medium">The line</span>
          <textarea
            className="ui-field-control min-h-24 w-full resize-none"
            id={lineId}
            maxLength={50000}
            onChange={(event) => setLine(event.target.value)}
            ref={lineRef}
            value={line}
          />
        </label>
        <Button
          className="mt-3"
          disabled={!line.trim() || leave.isPending}
          tone="primary"
          type="submit"
        >
          Leave this line
        </Button>
        {saved ? (
          <p className="mt-3 text-sm text-foreground" role="status">
            Saved. It stays on this job.
          </p>
        ) : null}
        {leave.isError ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            That line did not stay.
          </p>
        ) : null}
      </form>
      <Link
        className="mt-8 inline-block text-sm text-muted-foreground underline"
        to={dashboardWorkItemPath(tenantId, workItemId)}
      >
        Back to the dashboard
      </Link>
    </main>
  );
}
