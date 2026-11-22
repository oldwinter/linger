import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";

import { meetingsTabPath } from "./meetings-panel";
import { useMeetings } from "./memory-queries";
import { chooseUpNext, describeUpNext, meetingOpenPath } from "./up-next";

/** The next meeting as a clock that moves while you watch. */
export function UpNextPage() {
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
      backLabel="Back to meetings"
      backTo={meetingsTabPath(tenantId, "week")}
      subtitle="The meeting that is closest, counted down while you watch."
      title="Up next"
    >
      {meetings.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Checking the clock.
        </p>
      ) : meetings.isError ? (
        <p className="text-sm text-destructive" role="alert">
          The clock could not be read.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {picture.clock ? (
            <p
              aria-hidden="true"
              className="font-mono text-4xl tabular-nums text-foreground"
            >
              {picture.clock}
            </p>
          ) : null}
          <p className="text-sm text-foreground">{picture.headline}</p>
          <p className="text-sm text-muted-foreground" role="status">
            {picture.detail}
          </p>
          {next ? (
            <Link
              className="w-fit text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={meetingOpenPath(tenantId, next.id)}
            >
              Open this meeting
            </Link>
          ) : null}
        </div>
      )}
    </LibrarySubpageShell>
  );
}
