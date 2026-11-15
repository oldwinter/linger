import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { documentFileName } from "@/features/library/document-display-name";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { documentQueryOptions } from "@/features/rooms/room-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

/** Keeps the document exactly as it is now, as a history checkpoint. */
export function MarkMomentPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const documentId = requireRoomRouteParam(useParams().documentId, "Document");
  const document = useQuery(documentQueryOptions(client, tenantId, documentId));
  const mark = useMutation({
    mutationFn: () =>
      teamHubData(
        client.api.POST("/v0/documents/{documentId}/history/checkpoints", {
          params: { path: { documentId } },
        }),
      ),
  });
  const name = document.data ? documentFileName(document.data) : "This page";

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">Mark this moment</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {`${name} stays in its history as it is right now. Later edits do not erase the mark.`}
          </p>
        </header>
        {document.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Opening the page.
          </p>
        ) : document.isError ? (
          <p className="text-sm text-destructive" role="alert">
            This page could not be opened.
          </p>
        ) : mark.isSuccess ? (
          <p className="text-sm text-foreground" role="status">
            Marked. This moment stays in the page history.
          </p>
        ) : (
          <Button
            disabled={mark.isPending}
            onClick={() => mark.mutate()}
            type="button"
          >
            {mark.isPending ? "Marking" : "Mark it"}
          </Button>
        )}
        {mark.isError ? (
          <p className="text-sm text-destructive" role="alert">
            The moment could not be marked.
          </p>
        ) : null}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={documentDetailPath({ documentId, tenantId })}
        >
          Back to the page
        </Link>
      </div>
    </main>
  );
}
