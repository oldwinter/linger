import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";

import { dayKey } from "@/lib/date-format";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { useMeetings } from "./memory-queries";
import { formatMeetingDay, meetingsByDate } from "./meetings-calendar";
import { meetingsTabPath } from "./meetings-panel";
import { describeWeek, weekDays, type WeekMemoryDay } from "./week-memory";
import { reportDate, usePeriodReports } from "./wiki-period-reports";

/** One week of meetings, dailies, and notes, as a picture rather than a day. */
export function WeekMemoryPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const today = dayKey(new Date());
  const days = weekDays(today);
  const daySet = useMemo(() => new Set(days), [days]);
  const meetings = useMeetings(tenantId);
  const dailies = usePeriodReports(tenantId, "daily");
  const notes = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/me/pocket-notes", {
          params: { path: { tenantId }, query: { limit: 50 } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "pocket-notes", "week"],
  });
  const picture = useMemo(() => {
    const byDate = meetingsByDate(meetings.data ?? []);
    const dailyDays = new Set(
      (dailies.data ?? [])
        .map(reportDate)
        .filter(
          (date): date is string => date !== undefined && daySet.has(date),
        ),
    );
    const noteDays = new Set(
      (notes.data?.items ?? [])
        .map((note) => note.date)
        .filter((date) => daySet.has(date)),
    );
    const memory: WeekMemoryDay[] = days.map((date) => ({
      daily: dailyDays.has(date),
      date,
      meetings: byDate.get(date)?.length ?? 0,
      note: noteDays.has(date),
    }));
    return describeWeek(memory);
  }, [dailies.data, daySet, days, meetings.data, notes.data]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">The week in memory</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {`${formatMeetingDay(days[0]!)} through ${formatMeetingDay(days[6]!)}. Meetings, dailies, and notes from the whole week.`}
          </p>
        </header>
        {meetings.isPending || dailies.isPending || notes.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading the week.
          </p>
        ) : meetings.isError || dailies.isError || notes.isError ? (
          <p className="text-sm text-destructive" role="alert">
            The week could not be loaded.
          </p>
        ) : (
          <>
            <p className="text-sm text-foreground" role="status">
              {picture.summary}
            </p>
            {picture.lines.length ? (
              <ul aria-label="Days with memory" className="flex flex-col gap-2">
                {picture.lines.map((line) => (
                  <li
                    className="rounded-2xl border border-border px-4 py-3 text-sm text-foreground"
                    key={line}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
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
