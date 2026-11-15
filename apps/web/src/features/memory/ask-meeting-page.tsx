import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubVoiceCaptureQuestion } from "@/features/teamhub/teamhub-types";

import { meetingQuestionsKey } from "./ask-meeting";
import { useMeetings } from "./memory-queries";
import { meetingPath } from "./meeting-routes";
import { formatMeetingWhen, meetingWhen } from "./meetings-calendar";

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
  }, []);

  if (meetings.isPending) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <p role="status">Loading this meeting...</p>
      </main>
    );
  }

  if (!meeting?.meeting || !captureId) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <p role="alert">This meeting could not be opened.</p>
      </main>
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
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <p className="text-sm text-muted-foreground">{name}</p>
      <h1 className="mt-1 text-2xl text-foreground">Ask the recording</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Ask something the recording can answer. The answer stays with this
        meeting.
      </p>
      {questions.isPending ? (
        <p className="mt-6 text-sm" role="status">
          Loading saved questions...
        </p>
      ) : saved.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          Nothing has been asked of this recording yet.
        </p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {saved.map((item) => (
            <li key={item.id}>
              <SavedQuestion item={item} />
            </li>
          ))}
        </ol>
      )}
      <form className="mt-8" onSubmit={submit}>
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
      <Link
        className="mt-8 inline-block text-sm text-muted-foreground underline"
        to={meetingPath(tenantId, meeting.id)}
      >
        Back to {name}
      </Link>
    </main>
  );
}

function SavedQuestion({ item }: { item: TeamHubVoiceCaptureQuestion }) {
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
        <ul className="mt-3 flex flex-col gap-1">
          {item.sources.map((source) => (
            <li
              className="text-sm text-muted-foreground"
              key={`${source.start_offset_ms}-${source.end_offset_ms}`}
            >
              {source.text}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
