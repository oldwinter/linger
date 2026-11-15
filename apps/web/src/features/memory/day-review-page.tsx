import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import {
  pocketNotesQueryKey,
  storeTodayPocketNote,
} from "@/features/rooms/pocket-notes/pocket-note-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubPocketNotePage } from "@/features/teamhub/teamhub-types";

import { isCalendarDay, reviewDay, shiftDay } from "./day-review";
import { meetingPath, useMeetings } from "./memory-queries";
import { formatMeetingWhen, meetingsByDate } from "./meetings-calendar";
import { reportDate, usePeriodReports } from "./wiki-period-reports";

const dayHeading = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
});

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

function heading(day: string) {
  return dayHeading.format(new Date(`${day}T00:00:00Z`));
}

/** One day across Pocket, meetings, and the Daily Another Me wrote. */
export function DayReviewPage() {
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

  return (
    <main className="workspace-content-viewport workspace-scrollbar min-w-0 flex-1 overflow-y-auto bg-app-surface">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
        <header className="flex flex-col gap-3">
          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            to={library}
          >
            Library
          </Link>
          <h1 className="text-2xl text-foreground">
            {day ? heading(day) : "This day"}
          </h1>
          {day && today ? (
            <DayStepper day={day} today={today} tenantId={tenantId} />
          ) : null}
        </header>

        <section aria-label="Pocket" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">Pocket</h2>
          {pocket.isPending ? (
            <p className="text-sm text-muted-foreground">Loading Pocket…</p>
          ) : pocket.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Pocket could not be loaded.
            </p>
          ) : day && today && day === today ? (
            <TodayPocket
              initial={pocket.data.text}
              pocketKey={pocketKey}
              tenantId={tenantId}
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {pocket.data?.text || "Nothing was kept in Pocket."}
            </p>
          )}
        </section>

        <section aria-label="Meetings" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">Meetings</h2>
          {meetings.isPending ? (
            <p className="text-sm text-muted-foreground">Loading meetings…</p>
          ) : meetings.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Meetings could not be loaded.
            </p>
          ) : onDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {onDay.map((meeting) => (
                <li key={meeting.id}>
                  <Link
                    className="text-sm text-foreground underline-offset-2 hover:underline"
                    to={meetingPath(tenantId, meeting.id)}
                  >
                    Meeting {formatMeetingWhen(meeting.date, meeting.time)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Daily report" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">Daily report</h2>
          {reports.isPending ? (
            <p className="text-sm text-muted-foreground">Loading the report…</p>
          ) : reports.isError ? (
            <p className="text-sm text-destructive" role="alert">
              The report could not be loaded.
            </p>
          ) : report ? (
            <>
              <p className="text-sm text-foreground">
                {report.summary || "Another Me wrote this day."}
              </p>
              <Link
                className="text-sm text-muted-foreground hover:text-foreground"
                to={`${library}/wiki/graph?day=${encodeURIComponent(day!)}`}
              >
                Open on the timeline
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Another Me has not written this day.
            </p>
          )}
        </section>
      </div>
    </main>
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
  const base = `/t/${encodeURIComponent(tenantId)}/library/day`;
  const previous = `${base}?date=${shiftDay(day, -1)}`;
  const atToday = day >= today;
  return (
    <nav aria-label="Days" className="flex items-center gap-3 text-sm">
      <Link className="text-foreground hover:underline" to={previous}>
        Previous day
      </Link>
      {atToday ? (
        <span className="text-muted-foreground">Next day</span>
      ) : (
        <Link
          className="text-foreground hover:underline"
          to={`${base}?date=${shiftDay(day, 1)}`}
        >
          Next day
        </Link>
      )}
      {day === today ? (
        <span className="text-muted-foreground">Today</span>
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
        aria-label="Today's Pocket Note"
        className="min-h-28 w-full resize-y rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => setText(event.target.value)}
        value={text}
      />
      <div className="flex items-center gap-3">
        <Button
          disabled={save.isPending || text === initial}
          tone="primary"
          type="submit"
        >
          Save to Pocket
        </Button>
        {save.isSuccess ? (
          <p className="text-sm text-muted-foreground" role="status">
            Saved. Another Me reads this into memory.
          </p>
        ) : null}
        {save.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Pocket was not saved.
          </p>
        ) : null}
      </div>
    </form>
  );
}
