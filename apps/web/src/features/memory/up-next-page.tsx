import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

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
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">Up next</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The meeting that is closest, counted down while you watch.
          </p>
        </header>
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
                className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={meetingOpenPath(tenantId, next.id)}
              >
                Open this meeting
              </Link>
            ) : null}
          </div>
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={meetingsTabPath(tenantId, "week")}
        >
          Back to meetings
        </Link>
      </div>
    </main>
  );
}
