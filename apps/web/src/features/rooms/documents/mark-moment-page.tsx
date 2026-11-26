import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { documentFileName } from "@/features/library/document-display-name";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { documentQueryOptions } from "@/features/rooms/room-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { documentPageMessages as m } from "./document-page.messages";

/** Keeps the document exactly as it is now, as a history checkpoint. */
export function MarkMomentPage() {
  const t = useT();
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
  const name = document.data
    ? documentFileName(document.data)
    : t(m.markMomentThisPage);

  return (
    <LibrarySubpageShell
      backLabel={t(m.markMomentBack)}
      backTo={documentDetailPath({ documentId, tenantId })}
      subtitle={t(m.markMomentSubtitle, { name })}
      title={t(m.markMomentTitle)}
    >
      {document.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.markMomentOpening)}
        </p>
      ) : document.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {t(m.markMomentOpenError)}
        </p>
      ) : mark.isSuccess ? (
        <p className="text-sm text-foreground" role="status">
          {t(m.markMomentMarked)}
        </p>
      ) : (
        <Button
          disabled={mark.isPending}
          onClick={() => mark.mutate()}
          type="button"
        >
          {t(mark.isPending ? m.markMomentMarking : m.markMomentAction)}
        </Button>
      )}
      {mark.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {t(m.markMomentError)}
        </p>
      ) : null}
    </LibrarySubpageShell>
  );
}
