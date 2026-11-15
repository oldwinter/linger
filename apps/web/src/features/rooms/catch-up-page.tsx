import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  beginCatchUp,
  catchUpAttention,
  clearCatchUpWalk,
  readCatchUpWalk,
  writeCatchUpWalk,
  type CatchUpWalk,
} from "./catch-up";
import {
  teamHubIdentityQueryOptions,
  tenantRoomsQueryOptions,
} from "./room-queries";

/**
 * Walks the chats that had new messages or mentions when Catch up started.
 * The list stays put after those badges clear, so opening one chat does not
 * lose the rest.
 */
export function CatchUpPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const accountId = identity.data?.account.id;
  const [walk, setWalk] = useState<CatchUpWalk | undefined>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !accountId || !rooms.data) return;
    started.current = true;
    const stored = readCatchUpWalk(accountId, tenantId);
    const next = stored ?? beginCatchUp(rooms.data.items);
    if (!stored && next.rooms.length > 0) {
      writeCatchUpWalk(accountId, tenantId, next);
    }
    setWalk(next);
  }, [accountId, rooms.data, tenantId]);

  function replaceWalk(next: CatchUpWalk) {
    if (!accountId) return;
    if (next.rooms.length === 0) clearCatchUpWalk(accountId, tenantId);
    else writeCatchUpWalk(accountId, tenantId, next);
    setWalk(next);
  }

  function startOver() {
    if (!rooms.data) return;
    replaceWalk(beginCatchUp(rooms.data.items));
  }

  const current = walk?.rooms[walk.index];
  const chatsPath = `/t/${encodeURIComponent(tenantId)}/rooms`;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-app-surface px-6 py-10">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl text-app-ink">Catch up</h1>
          <Link
            className="text-sm text-app-muted hover:text-app-ink"
            to={chatsPath}
          >
            Back to chats
          </Link>
        </header>
        {identity.isError || rooms.isError ? (
          <p className="text-sm text-app-danger" role="alert">
            Chats could not be loaded.
            <Button
              className="ml-3"
              onClick={() => {
                void identity.refetch();
                void rooms.refetch();
              }}
              size="compact"
              tone="ghost"
            >
              Retry
            </Button>
          </p>
        ) : !walk ? (
          <p className="text-sm text-app-muted">Loading chats</p>
        ) : current ? (
          <section aria-label={current.name} className="flex flex-col gap-4">
            <p className="text-sm text-app-muted">
              {walk.index + 1} of {walk.rooms.length}
            </p>
            <h2 className="text-2xl text-app-ink">{current.name}</h2>
            {current.preview ? (
              <p className="text-[15px] leading-6 text-app-ink">
                {current.preview}
              </p>
            ) : null}
            <p className="text-sm text-app-muted">
              {catchUpAttention(current)}
            </p>
            <div className="flex items-center gap-3">
              <Link
                className="inline-flex h-9 items-center rounded-lg bg-app-ink px-3 text-sm text-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(current.id)}/chat`}
              >
                Open
              </Link>
              <Button
                onClick={() => replaceWalk({ ...walk, index: walk.index + 1 })}
                size="compact"
                tone="secondary"
              >
                {walk.index + 1 === walk.rooms.length ? "Finish" : "Next"}
              </Button>
            </div>
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            <h2 className="text-2xl text-app-ink">You're caught up</h2>
            <p className="text-sm text-app-muted">
              {walk.rooms.length === 0
                ? "No chats have new messages."
                : `You walked ${walk.rooms.length} ${walk.rooms.length === 1 ? "chat" : "chats"}.`}
            </p>
            {walk.rooms.length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-app-ink">
                {walk.rooms.map((room) => (
                  <li key={room.id}>{room.name}</li>
                ))}
              </ul>
            ) : null}
            <Button onClick={startOver} size="compact" tone="secondary">
              Start over
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}
