import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";

import { dayReviewPath } from "./day-review";
import {
  dayShape,
  dayShapePath,
  isCalendarDay,
  openStretchPhrase,
  shiftDay,
} from "./day-shape";
import { useLocalCalendarDay } from "./local-calendar-day";
import { useMeetings } from "./memory-queries";
import { meetingPath } from "./meeting-routes";
import {
  formatMeetingDay,
  formatMeetingWhen,
  meetingsByDate,
} from "./meetings-calendar";

/** One calendar day drawn as open time and the meetings that break it. */
export function DayShapePage() {
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const today = useLocalCalendarDay();
  const requested = searchParams.get("date") ?? "";
  const explicit = isCalendarDay(requested) ? requested : null;
  const date = explicit ?? today;
  // A page opened on the live day keeps following it. A day chosen in the
  // past stays put when midnight passes.
  const tracking = useRef<boolean | undefined>(undefined);
  const previousToday = useRef(today);
  useEffect(() => {
    if (tracking.current === undefined) {
      tracking.current = explicit === null || explicit === today;
    }
    const before = previousToday.current;
    previousToday.current = today;
    if (!tracking.current || before === today) return;
    const showing = explicit ?? before;
    if (showing !== before) {
      tracking.current = false;
      return;
    }
    void navigate(dayShapePath(tenantId, today), { replace: true });
  }, [explicit, navigate, tenantId, today]);
  const meetings = useMeetings(tenantId);
  const dayMeetings = useMemo(
    () => meetingsByDate(meetings.data ?? []).get(date) ?? [],
    [date, meetings.data],
  );
  const placed = useMemo(
    () =>
      dayShape(dayMeetings.map((item) => ({ id: item.id, time: item.time }))),
    [dayMeetings],
  );
  const next = shiftDay(date, 1);
  const title = `Shape of ${formatMeetingDay(date)}`;

  return (
    <LibrarySubpageShell
      backLabel="Back to meetings"
      backTo={`/t/${encodeURIComponent(tenantId)}/library?tab=meetings&meetings=${date === today ? "today" : "7d"}`}
      headerActions={
        <Link
          className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={dayReviewPath(tenantId, date)}
        >
          This day
        </Link>
      }
      headerExtra={
        <nav aria-label="Days" className="flex items-center gap-4 text-sm">
          <Link
            className="text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={dayShapePath(tenantId, shiftDay(date, -1))}
          >
            Previous day
          </Link>
          {next <= today ? (
            <Link
              className="text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={dayShapePath(tenantId, next)}
            >
              Next day
            </Link>
          ) : (
            <span className="text-muted-foreground">Next day</span>
          )}
        </nav>
      }
      subtitle="Open stretches and the meetings that sit in them. The hours run from 08:00 through 19:00, and widen when a meeting falls outside."
      title={date === today ? `${title} · Today` : title}
    >
      {meetings.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading the day.
        </p>
      ) : meetings.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Meetings could not be loaded.
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground" role="status">
            {placed.summary}
          </p>
          <ol aria-label={title} className="flex flex-col">
            {placed.segments.map((segment) => {
              const meeting = dayMeetings.find(
                (item) => item.id === segment.meetingId,
              );
              const height =
                segment.kind === "meeting"
                  ? "4.5rem"
                  : `${Math.max(44, Math.round(segment.minutes * 0.45))}px`;
              return (
                <li
                  className={`flex items-center justify-between gap-3 border-t border-border px-3 ${
                    segment.kind === "meeting" ? "bg-card" : "bg-muted/40"
                  }`}
                  key={`${segment.kind}-${segment.from}-${segment.meetingId ?? "open"}`}
                  style={{ minHeight: height }}
                >
                  {segment.kind === "meeting" && meeting ? (
                    <Link
                      className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={meetingPath(tenantId, meeting.id)}
                    >
                      {`Meeting ${formatMeetingWhen(date, meeting.time)}`}
                    </Link>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {segment.kind === "open"
                        ? openStretchPhrase(segment.minutes)
                        : "Meeting"}
                    </span>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {segment.kind === "meeting"
                      ? segment.from
                      : `${segment.from}–${segment.to}`}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </LibrarySubpageShell>
  );
}
