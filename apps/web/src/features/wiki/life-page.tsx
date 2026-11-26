import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { personalProfileQueryOptions } from "@/features/settings/personal-profile-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { lifeChapters } from "./life-telling";
import { LifeTellingView } from "./life-telling-view";
import { wikiSubpagesMessages as m } from "./wiki-subpages.messages";

/** The life Another Me would tell, one chapter at a time. */
export function LifePage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const profile = useQuery(personalProfileQueryOptions(client, tenantId));
  const entries = profile.data?.current?.profile.background.timeline ?? [];
  const chapters = lifeChapters(entries);

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToProfile)}
      backTo={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
      subtitle={t(m.lifeSubtitle)}
      title={t(m.lifeTitle)}
    >
      {profile.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingLife)}
        </p>
      ) : profile.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {profile.error.message}
        </p>
      ) : (
        <LifeTellingView chapters={chapters} />
      )}
    </LibrarySubpageShell>
  );
}
