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
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { meetingQuestionsKey } from "./ask-meeting";
import { useMeetings } from "./memory-queries";
import { memorySubpagesMessages as m } from "./memory-subpages.messages";
import { meetingPath } from "./meeting-routes";
import { formatMeetingWhen, meetingWhen } from "./meetings-calendar";
import { meetingsTabPath } from "./meetings-panel";

export function AskMeetingPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const t = useT();
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
        backLabel={t(m.backToMeetings)}
        backTo={meetingsTabPath(tenantId, "week")}
      >
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner size={16} />
          {t(m.loadingThisMeeting)}
        </p>
      </LibrarySubpageShell>
    );
  }

  if (meetings.isError || !meeting?.meeting || !captureId) {
    return (
      <LibrarySubpageShell
        backLabel={t(m.backToMeetings)}
        backTo={meetingsTabPath(tenantId, "week")}
      >
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-destructive" role="alert">
            {meetings.isError
              ? t(m.meetingLoadFailed)
              : t(m.meetingCouldNotOpen)}
          </p>
          <Button
            onClick={() => void meetings.refetch()}
            size="compact"
            tone="secondary"
          >
            {t(commonMessages.retry)}
          </Button>
        </div>
      </LibrarySubpageShell>
    );
  }

  const when = meetingWhen(meeting.path);
  const name = when
    ? t(m.meetingHeading, { when: formatMeetingWhen(when.date, when.time) })
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
      backLabel={t(m.backToNamed, { name })}
      backTo={meetingPath(tenantId, meeting.id)}
      eyebrow={name}
      subtitle={t(m.askSubtitle)}
      title={t(m.askTitle)}
    >
      {questions.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingQuestions)}
        </p>
      ) : questions.isError ? (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="text-sm text-destructive">{t(m.questionsLoadFailed)}</p>
          <Button
            onClick={() => void questions.refetch()}
            size="compact"
            tone="secondary"
          >
            {t(commonMessages.retry)}
          </Button>
        </div>
      ) : saved.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.nothingAskedYet)}
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
            {t(m.whatDoYouWantToKnow)}
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
          {t(m.askTitle)}
        </Button>
        {ask.isError ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {t(m.questionFailed)}
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
  const t = useT();
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <h2 className="text-sm font-medium text-foreground">{item.question}</h2>
      {item.kind === "task" ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t(m.taskRequestNotSent)}
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
