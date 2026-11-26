import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button, buttonClassName } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import {
  beginCatchUp,
  catchUpAttention,
  catchUpNote,
  clearCatchUpWalk,
  readCatchUpWalk,
  writeCatchUpWalk,
  type CatchUpWalk,
} from "./catch-up";
import { keepCatchUpInPocket } from "./catch-up-note";
import { roomActionsMessages as m } from "./room-actions.messages";
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
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const accountId = identity.data?.account.id;
  const [walk, setWalk] = useState<CatchUpWalk | undefined>();
  const [kept, setKept] = useState<"kept" | "already" | "failed" | undefined>();
  const started = useRef(false);
  const keep = useMutation({
    mutationFn: (note: string) =>
      keepCatchUpInPocket({ client, note, queryClient, tenantId }),
    onError: () => setKept("failed"),
    onSuccess: (result) => setKept(result),
  });

  useEffect(() => {
    if (started.current || !accountId || !rooms.data) return;
    started.current = true;
    const stored = readCatchUpWalk(accountId, tenantId);
    const fresh = beginCatchUp(rooms.data.items);
    const storedFinished =
      stored !== undefined && stored.index >= stored.rooms.length;
    const next =
      stored && !(storedFinished && fresh.rooms.length > 0) ? stored : fresh;
    if (next !== stored && next.rooms.length > 0) {
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
    setKept(undefined);
    replaceWalk(beginCatchUp(rooms.data.items));
  }

  const current = walk?.rooms[walk.index];
  const chatsPath = `/t/${encodeURIComponent(tenantId)}/rooms`;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-app-surface px-6 py-10">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl text-app-ink">{t(m.catchUpTitle)}</h1>
          <Link
            className="text-sm text-app-muted hover:text-app-ink"
            to={chatsPath}
          >
            {t(m.backToChats)}
          </Link>
        </header>
        {identity.isError || rooms.isError ? (
          <p className="text-sm text-app-danger" role="alert">
            {t(m.catchUpLoadFailed)}
            <Button
              className="ml-3"
              onClick={() => {
                void identity.refetch();
                void rooms.refetch();
              }}
              size="compact"
              tone="ghost"
            >
              {t(commonMessages.retry)}
            </Button>
          </p>
        ) : !walk ? (
          <div
            className="flex items-center gap-2 text-sm text-app-muted"
            role="status"
          >
            <Spinner />
            <span>{t(m.catchUpLoading)}</span>
          </div>
        ) : current ? (
          <section aria-label={current.name} className="flex flex-col gap-4">
            <p className="text-sm text-app-muted">
              {t(m.catchUpProgress, {
                current: walk.index + 1,
                total: walk.rooms.length,
              })}
            </p>
            <h2 className="text-2xl text-app-ink">{current.name}</h2>
            {current.preview ? (
              <p className="text-[15px] leading-6 text-app-ink">
                {current.preview}
              </p>
            ) : null}
            <p className="text-sm text-app-muted">
              {catchUpAttention(current, t)}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {walk.index > 0 ? (
                <Button
                  onClick={() =>
                    replaceWalk({ ...walk, index: walk.index - 1 })
                  }
                  size="compact"
                  tone="secondary"
                >
                  {t(m.previous)}
                </Button>
              ) : null}
              <Link
                className={buttonClassName({
                  size: "compact",
                  tone: "primary",
                })}
                to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(current.id)}/chat`}
              >
                {t(commonMessages.open)}
              </Link>
              <Button
                onClick={() => replaceWalk({ ...walk, index: walk.index + 1 })}
                size="compact"
                tone="secondary"
              >
                {t(walk.index + 1 === walk.rooms.length ? m.finish : m.next)}
              </Button>
            </div>
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            <h2 className="text-2xl text-app-ink">{t(m.catchUpDoneTitle)}</h2>
            <p className="text-sm text-app-muted">
              {walk.rooms.length === 0
                ? t(m.catchUpNothingNew)
                : t(m.catchUpWalkedChats, { count: walk.rooms.length })}
            </p>
            {walk.rooms.length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-app-ink">
                {walk.rooms.map((room) => (
                  <li key={room.id}>{room.name}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-3">
              {walk.rooms.length > 0 &&
              kept !== "kept" &&
              kept !== "already" ? (
                <Button
                  loading={keep.isPending}
                  onClick={() => {
                    const note = catchUpNote(walk.rooms, t);
                    if (note) keep.mutate(note);
                  }}
                  size="compact"
                  tone="secondary"
                >
                  {t(m.catchUpKeepInNote)}
                </Button>
              ) : null}
              <Button onClick={startOver} size="compact" tone="secondary">
                {t(m.catchUpStartOver)}
              </Button>
            </div>
            {kept === "kept" || kept === "already" ? (
              <p className="text-sm text-app-ink" role="status">
                {t(m.catchUpKeptInNote)}
              </p>
            ) : null}
            {kept === "failed" ? (
              <p className="text-sm text-app-danger" role="alert">
                {t(m.catchUpSaveFailed)}
              </p>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
