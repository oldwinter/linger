import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";

import { dayKey } from "@/lib/date-format";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { libraryWeekPath } from "@/features/library/library-week";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { dayReviewPath } from "./day-review";
import { useMeetings } from "./memory-queries";
import { memorySubpagesMessages as m } from "./memory-subpages.messages";
import { MemoryTimelineTabs } from "./memory-timeline-tabs";
import { formatMeetingDay, meetingsByDate } from "./meetings-calendar";
import { meetingsTabPath } from "./meetings-panel";
import { describeWeek, weekDays, type WeekMemoryDay } from "./week-memory";
import { reportDate, usePeriodReports } from "./wiki-period-reports";

/** One week of meetings, dailies, and notes, as a picture rather than a day. */
export function WeekMemoryPage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
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
    <LibrarySubpageShell
      backLabel={t(m.backToMeetings)}
      backTo={meetingsTabPath(tenantId, "week")}
      headerActions={
        <Link
          className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={libraryWeekPath(tenantId)}
        >
          {t(m.whatChangedThisWeek)}
        </Link>
      }
      subtitle={t(m.weekMemorySubtitle, {
        from: formatMeetingDay(days[0]!),
        to: formatMeetingDay(days[6]!),
      })}
      title={t(m.weekMemoryTitle)}
      viewTabs={<MemoryTimelineTabs active="week" tenantId={tenantId} />}
    >
      {meetings.isPending || dailies.isPending || notes.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingWeek)}
        </p>
      ) : meetings.isError || dailies.isError || notes.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {t(m.weekLoadFailed)}
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground" role="status">
            {picture.summary}
          </p>
          {picture.entries.length ? (
            <ul
              aria-label={t(m.daysWithMemory)}
              className="flex flex-col gap-2"
            >
              {picture.entries.map((entry) => (
                <li key={entry.date}>
                  <Link
                    className="block rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-xs transition-colors hover:border-border-hover hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    to={dayReviewPath(tenantId, entry.date)}
                  >
                    {entry.text}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </LibrarySubpageShell>
  );
}
