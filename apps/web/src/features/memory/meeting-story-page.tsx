import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { useMeetings } from "./memory-queries";
import { memorySubpagesMessages as m } from "./memory-subpages.messages";
import { meetingPath } from "./meeting-routes";
import { formatMeetingWhen, meetingWhen } from "./meetings-calendar";
import { meetingStoryBeats, storySentence } from "./meeting-story";
import { useMeetingToldPart } from "./meeting-told-part";

/** One meeting retold as the lines you would actually say to someone. */
export function MeetingStoryPage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const entryId = useSearchParams()[0].get("entry") ?? "";
  const meetings = useMeetings(tenantId);
  const listed = meetings.data?.find((entry) => entry.id === entryId);
  const selected = useQuery({
    enabled: listed !== undefined,
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/memory/{entryId}", {
          params: { path: { tenantId, entryId: listed?.id ?? "" } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "personal-memory", listed?.id, "story"],
  });
  const toldPart = useMeetingToldPart(entryId, entryId.length > 0);
  const [told, setTold] = useState<number | null>(null);
  const when = listed ? meetingWhen(listed.path) : undefined;
  const title = when
    ? t(m.meetingNamed, { when: formatMeetingWhen(when.date, when.time) })
    : (listed?.title ?? t(m.meetingFallback));
  const beats = useMemo(
    () => (selected.data ? meetingStoryBeats(selected.data.content) : []),
    [selected.data],
  );
  const sentences = beats.map(storySentence);
  const matched = toldPart.sentence ? sentences.indexOf(toldPart.sentence) : -1;
  useEffect(() => {
    if (matched >= 0) setTold(matched);
  }, [matched]);
  const featured = told === null ? undefined : sentences[told];

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToMeeting)}
      backTo={meetingPath(tenantId, entryId)}
      subtitle={t(m.tellStorySubtitle, { meeting: title })}
      title={t(m.tellStoryTitle)}
    >
      {meetings.isPending || (listed && selected.isPending) ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingMeeting)}
        </p>
      ) : meetings.isError || selected.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">{t(m.meetingLoadFailed)}</p>
          <Button
            onClick={() => {
              if (meetings.isError) void meetings.refetch();
              if (selected.isError) void selected.refetch();
            }}
            size="compact"
            tone="secondary"
          >
            {t(commonMessages.retry)}
          </Button>
        </div>
      ) : !listed ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.meetingNotInLibrary)}
        </p>
      ) : sentences.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.noStoryYet)}
        </p>
      ) : (
        <>
          {featured ? (
            <section
              aria-labelledby="story-to-tell"
              className="rounded-2xl border border-border bg-card p-5 shadow-xs"
            >
              <h2
                className="text-sm font-medium text-muted-foreground"
                id="story-to-tell"
              >
                {t(m.partYouWouldTell)}
              </h2>
              <p className="mt-3 text-lg text-foreground">{featured}</p>
            </section>
          ) : null}
          <ol
            aria-label={t(m.meetingStoryLabel)}
            className="flex flex-col gap-3"
          >
            {sentences.map((sentence, index) => (
              <li
                className="rounded-2xl border border-border bg-card px-4 py-3 shadow-xs"
                key={`${index}-${sentence}`}
              >
                <p className="text-sm text-foreground">{sentence}</p>
                <Button
                  aria-pressed={told === index}
                  className="mt-3"
                  onClick={() => {
                    setTold(index);
                    toldPart.choose(sentence);
                  }}
                  size="compact"
                  tone={told === index ? "primary" : "secondary"}
                  type="button"
                >
                  {t(m.thisIsPartIWouldTell)}
                </Button>
              </li>
            ))}
          </ol>
        </>
      )}
    </LibrarySubpageShell>
  );
}
