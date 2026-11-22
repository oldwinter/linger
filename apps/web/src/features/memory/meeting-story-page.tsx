import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { useMeetings } from "./memory-queries";
import { meetingPath } from "./meeting-routes";
import { formatMeetingWhen, meetingWhen } from "./meetings-calendar";
import { meetingStoryBeats, storySentence } from "./meeting-story";
import { useMeetingToldPart } from "./meeting-told-part";

/** One meeting retold as the lines you would actually say to someone. */
export function MeetingStoryPage() {
  const { client } = useTeamHubRuntime();
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
    ? `Meeting ${formatMeetingWhen(when.date, when.time)}`
    : (listed?.title ?? "Meeting");
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
      backLabel="Back to the meeting"
      backTo={meetingPath(tenantId, entryId)}
      subtitle={`${title}. The lines you could say out loud, then the one you would actually tell.`}
      title="Tell this story"
    >
      {meetings.isPending || (listed && selected.isPending) ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading the meeting.
        </p>
      ) : meetings.isError || selected.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">
            Could not load this meeting.
          </p>
          <Button
            onClick={() => {
              if (meetings.isError) void meetings.refetch();
              if (selected.isError) void selected.refetch();
            }}
            size="compact"
            tone="secondary"
          >
            Retry
          </Button>
        </div>
      ) : !listed ? (
        <p className="text-sm text-muted-foreground" role="status">
          This meeting is not in your library.
        </p>
      ) : sentences.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          This meeting does not have a story to tell yet.
        </p>
      ) : (
        <>
          {featured ? (
            <section aria-labelledby="story-to-tell">
              <h2 className="text-sm text-foreground" id="story-to-tell">
                The part you would tell
              </h2>
              <p className="mt-3 text-lg text-foreground">{featured}</p>
            </section>
          ) : null}
          <ol aria-label="Meeting story" className="flex flex-col gap-3">
            {sentences.map((sentence, index) => (
              <li
                className="rounded-2xl border border-border px-4 py-3"
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
                  This is the part I would tell
                </Button>
              </li>
            ))}
          </ol>
        </>
      )}
    </LibrarySubpageShell>
  );
}
