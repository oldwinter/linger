import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";

import { dayKey } from "@/lib/date-format";
import { formatMeetingDay } from "@/features/memory/meetings-calendar";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { documentFileName } from "./document-display-name";
import {
  describeLibraryWeek,
  type LibraryWeekFile,
  weekDates,
} from "./library-week";

/** Files the library changed this Monday-through-Sunday, not one calendar day. */
export function LibraryWeekPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const today = dayKey(new Date());
  const days = useMemo(() => new Set(weekDates(today)), [today]);
  const documents = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/library/documents", {
          params: { query: { limit: 50, view: "recent" } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "library-documents", "week"],
  });
  const picture = useMemo(() => {
    const items = documents.data?.items ?? [];
    const files: LibraryWeekFile[] = [];
    for (const document of items) {
      const date = dayKey(new Date(document.updated_at));
      if (!days.has(date)) continue;
      files.push({
        date,
        id: document.id,
        owner: document.owner.display_name,
        title: documentFileName(document),
      });
    }
    const more =
      documents.data?.page.has_more === true &&
      items.length > 0 &&
      items.every((document) =>
        days.has(dayKey(new Date(document.updated_at))),
      );
    return { ...describeLibraryWeek(files), more };
  }, [days, documents.data]);
  const span = weekDates(today);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">What changed this week</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {`${formatMeetingDay(span[0]!)} through ${formatMeetingDay(span[6]!)}. Files in the library, from the whole week.`}
          </p>
        </header>
        {documents.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading the library.
          </p>
        ) : documents.isError ? (
          <p className="text-sm text-destructive" role="alert">
            The library could not be loaded.
          </p>
        ) : (
          <>
            <p className="text-sm text-foreground" role="status">
              {picture.summary}
            </p>
            {picture.more ? (
              <p className="text-sm text-muted-foreground">
                There are more changes than this list holds.
              </p>
            ) : null}
            {picture.days.map((day) => (
              <section aria-label={day.label} key={day.date}>
                <h2 className="text-sm text-muted-foreground">{day.label}</h2>
                <ul className="mt-2 flex flex-col gap-2">
                  {day.files.map((file) => (
                    <li key={file.id}>
                      <Link
                        className="flex items-baseline justify-between gap-3 rounded-2xl border border-border px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        to={documentDetailPath({
                          documentId: file.id,
                          tenantId,
                        })}
                      >
                        <span>{file.title}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {file.owner}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/t/${encodeURIComponent(tenantId)}/library`}
        >
          Back to the library
        </Link>
      </div>
    </main>
  );
}
