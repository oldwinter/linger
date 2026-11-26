import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { roomActionsMessages as m } from "./room-actions.messages";
import {
  tenantAgentAvailabilityQueryOptions,
  tenantAgentsQueryOptions,
  tenantRoomsQueryOptions,
} from "./room-queries";
import {
  arrangeAwakeAgents,
  awakeSummary,
  type AwakeAgent,
} from "./who-is-awake";

/** Who can hear you right now, updated as agents come and go. */
export function WhoIsAwakePage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const agents = useQuery(tenantAgentsQueryOptions(client, tenantId));
  const availability = useQuery({
    ...tenantAgentAvailabilityQueryOptions(client, tenantId),
    refetchInterval: 5_000,
  });
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const roomByActor = new Map(
    (rooms.data?.items ?? []).flatMap((room) =>
      room.direct_peer ? [[room.direct_peer.id, room.id] as const] : [],
    ),
  );
  const people = arrangeAwakeAgents(
    (agents.data?.items ?? []).map((agent): AwakeAgent => {
      const snapshot = availability.data?.items.find(
        (item) => item.actor_id === agent.actor.id,
      );
      return {
        actorId: agent.actor.id,
        label: snapshot?.availability.label ?? t(m.whoIsAwakeStatusUnavailable),
        name: agent.actor.display_name,
        online: snapshot?.availability.status === "online",
        roomId: roomByActor.get(agent.actor.id),
      };
    }),
  );
  const loading = agents.isPending || availability.isPending || rooms.isPending;
  const failed = agents.isError || availability.isError || rooms.isError;
  const chatsPath = `/t/${encodeURIComponent(tenantId)}/rooms`;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-xl text-foreground">{t(m.whoIsAwakeTitle)}</h1>
            <Link
              className="text-sm text-app-muted hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={chatsPath}
            >
              {t(m.backToChats)}
            </Link>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(m.whoIsAwakeDescription)}
          </p>
        </header>
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.whoIsAwakeLoading)}
          </p>
        ) : failed ? (
          <div
            className="flex items-center gap-3 text-sm text-destructive"
            role="alert"
          >
            <span>{t(m.whoIsAwakeLoadFailed)}</span>
            <Button
              onClick={() => {
                if (agents.isError) void agents.refetch();
                if (availability.isError) void availability.refetch();
                if (rooms.isError) void rooms.refetch();
              }}
              size="compact"
              tone="ghost"
            >
              {t(commonMessages.retry)}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground" role="status">
              {awakeSummary(people, t)}
            </p>
            <ul
              aria-label={t(m.whoIsAwakeAgentsList)}
              className="flex flex-col gap-2"
            >
              {people.map((agent) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
                  key={agent.actorId}
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">
                      {agent.name}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {agent.label}
                    </span>
                  </span>
                  {agent.roomId ? (
                    <Link
                      className="shrink-0 text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(agent.roomId)}/chat`}
                    >
                      {t(m.whoIsAwakeTalkTo, { name: agent.name })}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
