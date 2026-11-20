import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { personalProfileQueryOptions } from "@/features/settings/personal-profile-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { lifeChapters } from "./life-telling";
import { LifeTellingView } from "./life-telling-view";

/** The life Another Me would tell, one chapter at a time. */
export function LifePage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const profile = useQuery(personalProfileQueryOptions(client, tenantId));
  const entries = profile.data?.current?.profile.background.timeline ?? [];
  const chapters = lifeChapters(entries);

  return (
    <LibrarySubpageShell
      backLabel="Back to Profile"
      backTo={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
      subtitle="The years Another Me remembers, from the earliest, as lines you could say out loud."
      title="How Another Me would tell your life"
    >
      {profile.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading your life.
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
