import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubVoiceCaptureQuestion } from "@/features/teamhub/teamhub-types";

import { meetingQuestionsKey } from "./ask-meeting";
import { useMeetings } from "./memory-queries";
import { meetingPath } from "./meeting-routes";
import { formatMeetingWhen, meetingWhen } from "./meetings-calendar";
import { meetingsTabPath } from "./meetings-panel";

export function AskMeetingPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const entryId = useSearchParams()[0].get("entry") ?? "";
  const meetings = useMeetings(tenantId);
  const meeting = meetings.data?.find((entry) => entry.id === entryId);
  const captureId = meeting?.meeting?.capture_id;
  const questions = useQuery({
    enabled: Boolean(captureId),
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/voice-captures/{captureSessionId}/questions", {
          params: { path: { captureSessionId: captureId! } },
        }),
      ),
    queryKey: meetingQuestionsKey(captureId ?? ""),
  });
  const ask = useMutation({
    mutationFn: (question: string) =>
      teamHubData(
        client.api.POST("/v0/voice-captures/{captureSessionId}/questions", {
          params: { path: { captureSessionId: captureId! } },
          body: { question },
        }),
      ),
    onSuccess: async () => {
      setQuestion("");
      if (!captureId) return;
      await queryClient.invalidateQueries({
        queryKey: meetingQuestionsKey(captureId),
      });
    },
  });
  const questionId = useId();
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    questionRef.current?.focus();
  }, [captureId]);

  if (meetings.isPending) {
    return (
      <LibrarySubpageShell
        backLabel="Back to meetings"
        backTo={meetingsTabPath(tenantId, "week")}
      >
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner size={16} />
          Loading this meeting...
        </p>
      </LibrarySubpageShell>
    );
  }

  if (meetings.isError || !meeting?.meeting || !captureId) {
    return (
      <LibrarySubpageShell
        backLabel="Back to meetings"
        backTo={meetingsTabPath(tenantId, "week")}
      >
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-destructive" role="alert">
            {meetings.isError
              ? "Could not load this meeting."
              : "This meeting could not be opened."}
          </p>
          <Button
            onClick={() => void meetings.refetch()}
            size="compact"
            tone="secondary"
          >
            Retry
          </Button>
        </div>
      </LibrarySubpageShell>
    );
  }

  const when = meetingWhen(meeting.path);
  const name = when
    ? `Meeting · ${formatMeetingWhen(when.date, when.time)}`
    : meeting.title;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || ask.isPending) return;
    ask.mutate(text);
  }

  const saved = questions.data?.items ?? [];

  return (
    <LibrarySubpageShell
      backLabel={`Back to ${name}`}
      backTo={meetingPath(tenantId, meeting.id)}
      eyebrow={name}
      subtitle="Ask something the recording can answer. The answer stays with this meeting."
      title="Ask the recording"
    >
      {questions.isPending ? (
        <p className="text-sm" role="status">
          Loading saved questions...
        </p>
      ) : questions.isError ? (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="text-sm text-destructive">
            Could not load saved questions.
          </p>
          <Button
            onClick={() => void questions.refetch()}
            size="compact"
            tone="secondary"
          >
            Retry
          </Button>
        </div>
      ) : saved.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          Nothing has been asked of this recording yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {saved.map((item) => (
            <li key={item.id}>
              <SavedQuestion
                item={item}
                meetingId={meeting.id}
                tenantId={tenantId}
              />
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={submit}>
        <label className="block" htmlFor={questionId}>
          <span className="mb-1.5 block text-sm font-medium">
            What do you want to know?
          </span>
          <textarea
            className="ui-field-control min-h-24 w-full resize-none"
            id={questionId}
            maxLength={1000}
            onChange={(event) => setQuestion(event.target.value)}
            ref={questionRef}
            value={question}
          />
        </label>
        <Button
          className="mt-3"
          disabled={!question.trim() || ask.isPending}
          tone="primary"
          type="submit"
        >
          Ask the recording
        </Button>
        {ask.isError ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            That question did not go through.
          </p>
        ) : null}
      </form>
    </LibrarySubpageShell>
  );
}

function SavedQuestion({
  item,
  meetingId,
  tenantId,
}: {
  item: TeamHubVoiceCaptureQuestion;
  meetingId: string;
  tenantId: string;
}) {
  return (
    <article className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium text-foreground">{item.question}</h2>
      {item.kind === "task" ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This page keeps answers from the recording. That question was a
          request for Another Me, and it was not sent.
        </p>
      ) : (
        <p className="mt-2 text-sm leading-6 text-foreground">{item.answer}</p>
      )}
      {item.sources.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {item.sources.map((source) => {
            const hasOffset =
              typeof source.start_offset_ms === "number" &&
              Number.isFinite(source.start_offset_ms) &&
              source.start_offset_ms >= 0;
            const seconds = hasOffset
              ? Math.floor(source.start_offset_ms / 1000)
              : undefined;
            return (
              <li
                className="text-sm text-muted-foreground"
                key={`${source.start_offset_ms}-${source.end_offset_ms}-${source.text}`}
              >
                {seconds !== undefined ? (
                  <Link
                    className="inline-flex items-baseline gap-2 rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    to={`${meetingPath(tenantId, meetingId)}&at=${seconds}`}
                  >
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {formatSourceTimestamp(seconds)}
                    </span>
                    <span>{source.text}</span>
                  </Link>
                ) : (
                  source.text
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}

function formatSourceTimestamp(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
