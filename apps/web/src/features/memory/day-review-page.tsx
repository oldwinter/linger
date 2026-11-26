import {
  ArrowRight02Icon,
  BookOpen01Icon,
  Mic01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import {
  pocketNotesQueryKey,
  storeTodayPocketNote,
} from "@/features/rooms/pocket-notes/pocket-note-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubPocketNotePage } from "@/features/teamhub/teamhub-types";
import { formatLocale } from "@/i18n/language";
import { useT, useTranslation } from "@/i18n/use-translation";

import {
  dayReviewPath,
  isCalendarDay,
  reviewDay,
  shiftDay,
} from "./day-review";
import { dayShapePath } from "./day-shape";
import { useMeetings } from "./memory-queries";
import { memorySubpagesMessages as m } from "./memory-subpages.messages";
import { MemoryTimelineTabs } from "./memory-timeline-tabs";
import { meetingPath } from "./meeting-routes";
import { formatMeetingWhen, meetingsByDate } from "./meetings-calendar";
import { reportDate, usePeriodReports } from "./wiki-period-reports";

/**
 * Pocket Notes are newest first. Stop once the page is older than the day,
 * so a past day does not read every later page after it has been passed.
 */
export async function loadPocketDay(
  client: TeamHubClient,
  tenantId: string,
  requested: string | undefined,
) {
  let cursor: string | undefined;
  const seen = new Set<string>();
  while (true) {
    const page: TeamHubPocketNotePage = await teamHubData(
      client.api.GET("/v0/tenants/{tenantId}/me/pocket-notes", {
        params: {
          path: { tenantId },
          query: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      }),
    );
    const today = page.today;
    const date = reviewDay(requested ?? null, today)!;
    const found = page.items.find((item) => item.date === date);
    if (found) return { date, text: found.text, today };
    const oldest = page.items.at(-1)?.date;
    const passed = Boolean(oldest && oldest < date);
    if (
      date === today ||
      passed ||
      !page.page.has_more ||
      !page.page.next_cursor ||
      seen.has(page.page.next_cursor)
    ) {
      return { date, text: "", today };
    }
    seen.add(page.page.next_cursor);
    cursor = page.page.next_cursor;
  }
}

function heading(day: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** One day across Pocket, meetings, and the Daily Another Me wrote. */
export function DayReviewPage() {
  const { language, t } = useTranslation();
  const locale = formatLocale(language);
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("date");
  const { client } = useTeamHubRuntime();
  const pocketKey = [
    "teamhub",
    tenantId,
    "day-review",
    "pocket",
    isCalendarDay(requested) ? requested : "",
  ] as const;
  const pocket = useQuery({
    queryKey: pocketKey,
    queryFn: () =>
      loadPocketDay(
        client,
        tenantId,
        isCalendarDay(requested) ? requested : undefined,
      ),
  });
  const meetings = useMeetings(tenantId);
  const reports = usePeriodReports(tenantId, "daily");
  const day = reviewDay(requested, pocket.data?.today);
  const today = pocket.data?.today;
  const onDay = day ? (meetingsByDate(meetings.data ?? []).get(day) ?? []) : [];
  const report = reports.data?.find((entry) => reportDate(entry) === day);
  const library = `/t/${encodeURIComponent(tenantId)}/library`;
  const isToday = Boolean(day && today && day === today);

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToLibrary)}
      backTo={library}
      headerActions={
        day ? (
          <Link
            className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={dayShapePath(tenantId, day)}
          >
            {isToday ? t(m.shapeOfToday) : t(m.shapeOfThisDay)}
          </Link>
        ) : null
      }
      headerExtra={
        day && today ? (
          <DayStepper day={day} today={today} tenantId={tenantId} />
        ) : null
      }
      title={day ? heading(day, locale) : t(m.thisDay)}
      viewTabs={
        <MemoryTimelineTabs active="day" day={day} tenantId={tenantId} />
      }
    >
      <section
        aria-label={t(m.pocket)}
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon icon={Note01Icon} size={16} />
            </span>
            <h2 className="text-sm font-semibold text-foreground">
              {t(m.pocket)}
            </h2>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {isToday ? t(m.pocketEditable) : t(m.pocketReadOnly)}
          </span>
        </div>
        {pocket.isPending ? (
          <p className="text-sm text-muted-foreground">{t(m.loadingPocket)}</p>
        ) : pocket.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {t(m.pocketLoadFailed)}
          </p>
        ) : isToday ? (
          <TodayPocket
            initial={pocket.data.text}
            pocketKey={pocketKey}
            tenantId={tenantId}
          />
        ) : pocket.data?.text ? (
          <p className="whitespace-pre-wrap rounded-xl border border-border/60 bg-app-surface px-4 py-3 text-sm leading-6 text-foreground">
            {pocket.data.text}
          </p>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            {t(m.nothingInPocket)}
          </p>
        )}
      </section>

      <section
        aria-label={t(m.meetings)}
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon icon={Mic01Icon} size={16} />
            </span>
            <h2 className="text-sm font-semibold text-foreground">
              {t(m.meetings)}
            </h2>
          </div>
          {!meetings.isPending && !meetings.isError ? (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {onDay.length}
            </span>
          ) : null}
        </div>
        {meetings.isPending ? (
          <p className="text-sm text-muted-foreground">
            {t(m.loadingMeetings)}
          </p>
        ) : meetings.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {t(m.meetingsLoadFailed)}
          </p>
        ) : onDay.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            {t(m.noMeetings)}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {onDay.map((meeting) => (
              <li
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-app-surface px-3.5 py-2.5 transition-colors hover:border-border-hover"
                key={meeting.id}
              >
                <Link
                  className="text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  to={meetingPath(tenantId, meeting.id)}
                >
                  {t(m.meetingNamed, {
                    when: formatMeetingWhen(meeting.date, meeting.time),
                  })}
                </Link>
                {meeting.recordingFilename ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {meeting.recordingFilename}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label={t(m.dailyReport)}
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon icon={BookOpen01Icon} size={16} />
            </span>
            <h2 className="text-sm font-semibold text-foreground">
              {t(m.dailyReport)}
            </h2>
          </div>
          {!reports.isPending && !reports.isError ? (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {report ? t(m.reportReady) : t(m.reportPending)}
            </span>
          ) : null}
        </div>
        {reports.isPending ? (
          <p className="text-sm text-muted-foreground">{t(m.loadingReport)}</p>
        ) : reports.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {t(m.reportLoadFailed)}
          </p>
        ) : report ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-xl border border-border/60 bg-app-surface px-4 py-3 text-sm leading-6 text-foreground">
              {report.summary || t(m.reportWrittenFallback)}
            </p>
            <Link
              className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={`${library}/wiki/graph?day=${encodeURIComponent(day!)}`}
            >
              <span>{t(m.openOnTimeline)}</span>
              <Icon icon={ArrowRight02Icon} size={14} />
            </Link>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            {t(m.reportNotWritten)}
          </p>
        )}
      </section>
    </LibrarySubpageShell>
  );
}

function DayStepper({
  day,
  tenantId,
  today,
}: {
  day: string;
  tenantId: string;
  today: string;
}) {
  const t = useT();
  const previous = dayReviewPath(tenantId, shiftDay(day, -1));
  const atToday = day >= today;
  return (
    <nav aria-label={t(m.daysNav)} className="flex items-center gap-3 text-sm">
      <Link className="text-foreground hover:underline" to={previous}>
        {t(m.previousDay)}
      </Link>
      {atToday ? (
        <span className="text-muted-foreground">{t(m.nextDay)}</span>
      ) : (
        <Link
          className="text-foreground hover:underline"
          to={dayReviewPath(tenantId, shiftDay(day, 1))}
        >
          {t(m.nextDay)}
        </Link>
      )}
      {day === today ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {t(m.today)}
        </span>
      ) : null}
    </nav>
  );
}

function TodayPocket({
  initial,
  pocketKey,
  tenantId,
}: {
  initial: string;
  pocketKey: readonly unknown[];
  tenantId: string;
}) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [text, setText] = useState(initial);
  const save = useMutation({
    mutationFn: (value: string) =>
      teamHubData(
        client.api.PUT("/v0/tenants/{tenantId}/me/pocket-notes/today", {
          body: { text: value },
          params: { path: { tenantId } },
        }),
      ),
    onSuccess: (note) => {
      storeTodayPocketNote(queryClient, tenantId, note);
      queryClient.setQueryData(pocketKey, {
        date: note.date,
        text: note.text,
        today: note.date,
      });
      void queryClient.invalidateQueries({
        queryKey: pocketNotesQueryKey(tenantId),
      });
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(text);
      }}
    >
      <textarea
        aria-label={t(m.todayPocketLabel)}
        className="min-h-28 w-full resize-y rounded-xl border border-border bg-app-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => setText(event.target.value)}
        value={text}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={save.isPending || text === initial}
          tone="primary"
          type="submit"
        >
          {t(m.saveToPocket)}
        </Button>
        {save.isSuccess ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.pocketSaved)}
          </p>
        ) : null}
        {save.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {t(m.pocketNotSaved)}
          </p>
        ) : null}
      </div>
    </form>
  );
}
