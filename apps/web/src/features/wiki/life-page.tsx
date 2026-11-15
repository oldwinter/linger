import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

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
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">
            How Another Me would tell your life
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The years Another Me remembers, from the earliest, as lines you
            could say out loud.
          </p>
        </header>
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
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
        >
          Back to Profile
        </Link>
      </div>
    </main>
  );
}
