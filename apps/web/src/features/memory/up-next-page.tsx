import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useT } from "@/i18n/use-translation";

import { meetingsTabPath } from "./meetings-panel";
import { useMeetings } from "./memory-queries";
import { memorySubpagesMessages as m } from "./memory-subpages.messages";
import { chooseUpNext, describeUpNext, meetingOpenPath } from "./up-next";

/** The next meeting as a clock that moves while you watch. */
export function UpNextPage() {
  const t = useT();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const meetings = useMeetings(tenantId);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const next = chooseUpNext(meetings.data ?? [], now);
  const picture = describeUpNext(next, now);

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToMeetings)}
      backTo={meetingsTabPath(tenantId, "week")}
      subtitle={t(m.upNextSubtitle)}
      title={t(m.upNextTitle)}
    >
      {meetings.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.checkingClock)}
        </p>
      ) : meetings.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {t(m.clockLoadFailed)}
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-xs">
          {picture.clock ? (
            <p
              aria-hidden="true"
              className="font-mono text-4xl tabular-nums text-foreground"
            >
              {picture.clock}
            </p>
          ) : null}
          <p className="text-sm font-medium text-foreground">
            {picture.headline}
          </p>
          <p className="text-sm text-muted-foreground" role="status">
            {picture.detail}
          </p>
          {next ? (
            <Link
              className="w-fit text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={meetingOpenPath(tenantId, next.id)}
            >
              {t(m.openThisMeeting)}
            </Link>
          ) : null}
        </div>
      )}
    </LibrarySubpageShell>
  );
}
