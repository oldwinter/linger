import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";

import { dayKey } from "@/lib/date-format";
import { formatMeetingDay } from "@/features/memory/meetings-calendar";
import { weekMemoryPath } from "@/features/memory/week-memory";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { documentFileName } from "./document-display-name";
import { libraryDocumentsQueryKey } from "./library-queries";
import { LibrarySubpageShell } from "./library-subpage-shell";
import { librarySubpagesMessages as m } from "./library-subpages.messages";
import {
  describeLibraryWeek,
  type LibraryWeekFile,
  weekDates,
} from "./library-week";

/** Files the library changed this Monday-through-Sunday, not one calendar day. */
export function LibraryWeekPage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
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
    queryKey: libraryDocumentsQueryKey(tenantId, "week"),
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
    <LibrarySubpageShell
      backLabel={t(m.backToLibrary)}
      backTo={`/t/${encodeURIComponent(tenantId)}/library`}
      headerActions={
        <Link
          className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={weekMemoryPath(tenantId)}
        >
          {t(m.weekInMemory)}
        </Link>
      }
      subtitle={t(m.weekSubtitle, {
        from: formatMeetingDay(span[0]!),
        to: formatMeetingDay(span[6]!),
      })}
      title={t(m.weekTitle)}
    >
      {documents.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingLibrary)}
        </p>
      ) : documents.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {t(m.loadFailed)}
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground" role="status">
            {picture.summary}
          </p>
          {picture.more ? (
            <p className="text-sm text-muted-foreground">{t(m.moreChanges)}</p>
          ) : null}
          {picture.days.map((day) => (
            <section aria-label={day.label} key={day.date}>
              <h2 className="text-sm font-medium text-muted-foreground">
                {day.label}
              </h2>
              <ul className="mt-2 flex flex-col gap-2">
                {day.files.map((file) => (
                  <li key={file.id}>
                    <Link
                      className="flex items-baseline justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-xs transition-colors hover:border-border-hover hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    </LibrarySubpageShell>
  );
}
