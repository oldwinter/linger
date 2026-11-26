import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button, buttonClassName } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { roomActionsMessages as m } from "./room-actions.messages";
import { tenantRoomsQueryOptions } from "./room-queries";
import {
  chooseSurprise,
  roomsToSpin,
  surpriseRoomTitle,
} from "./surprise-room";

const SPIN_FRAMES = 8;
const SPIN_MS = 70;

/** Spins the rooms you belong to and opens wherever it lands. */
export function SurpriseRoomPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const spinList = roomsToSpin(rooms.data?.items ?? []);
  const [shown, setShown] = useState<TeamHubRoomListItem>();
  const [phase, setPhase] = useState<"idle" | "spinning" | "landed">("idle");
  const targetRef = useRef<TeamHubRoomListItem>(undefined);
  const chatsPath = `/t/${encodeURIComponent(tenantId)}/rooms`;

  useEffect(() => {
    if (phase !== "spinning") return;
    const list = roomsToSpin(rooms.data?.items ?? []);
    const target = targetRef.current;
    if (!target || list.length === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      setPhase("landed");
      return;
    }
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;
      if (frame >= SPIN_FRAMES) {
        window.clearInterval(timer);
        setShown(target);
        setPhase("landed");
        return;
      }
      const next = list[frame % list.length];
      if (next) setShown(next);
    }, SPIN_MS);
    return () => window.clearInterval(timer);
  }, [phase, rooms.data?.items]);

  function spin() {
    const pick = chooseSurprise(spinList, Math.random);
    if (!pick) return;
    targetRef.current = pick;
    setShown(pick);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPhase("landed");
      return;
    }
    setPhase("spinning");
  }

  const title = shown ? surpriseRoomTitle(shown) : undefined;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-xl text-foreground">{t(m.surpriseTitle)}</h1>
            <Link
              className="text-sm text-app-muted hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={chatsPath}
            >
              {t(m.backToChats)}
            </Link>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(m.surpriseDescription)}
          </p>
        </header>
        {rooms.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.surpriseLoading)}
          </p>
        ) : rooms.isError ? (
          <div
            className="flex items-center gap-3 text-sm text-destructive"
            role="alert"
          >
            <span>{t(m.surpriseLoadFailed)}</span>
            <Button
              onClick={() => void rooms.refetch()}
              size="compact"
              tone="ghost"
            >
              {t(commonMessages.retry)}
            </Button>
          </div>
        ) : spinList.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.surpriseEmpty)}
          </p>
        ) : (
          <>
            <p className="text-2xl text-foreground" role="status">
              {phase === "idle"
                ? t(m.surpriseReady)
                : phase === "spinning"
                  ? title
                  : t(m.surpriseLanded, { title: title ?? "" })}
            </p>
            {phase === "landed" && shown ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  className={buttonClassName({ tone: "primary" })}
                  to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(shown.id)}/chat`}
                >
                  {t(m.surpriseGoTo, { title: title ?? "" })}
                </Link>
                <Button onClick={spin} tone="secondary" type="button">
                  {t(m.surpriseSpinAgain)}
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  disabled={phase === "spinning"}
                  onClick={spin}
                  type="button"
                >
                  {t(
                    phase === "spinning" ? m.surpriseSpinning : m.surpriseSpin,
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
