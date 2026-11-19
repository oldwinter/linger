import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  keepMeetingDefaultTitle,
  keepMeetingFileName,
  keepMeetingIdempotencyKey,
  keepMeetingMarkdown,
  keepMeetingPageUrl,
  keepMeetingWords,
  keptMeetingDocumentPath,
} from "./keep-meeting";
import { useMeetings } from "./memory-queries";
import { meetingPath } from "./meeting-routes";
import { meetingsTabPath } from "./meetings-panel";

export function KeepMeetingPage() {
  const { client } = useTeamHubRuntime();
  const navigate = useNavigate();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const entryId = useSearchParams()[0].get("entry") ?? "";
  const meetings = useMeetings(tenantId);
  const meeting = meetings.data?.find((entry) => entry.id === entryId);
  const titleId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const meetingId = meeting?.id;
  const defaultTitle = meeting ? keepMeetingDefaultTitle(meeting) : "";

  useEffect(() => {
    setTitle(defaultTitle);
  }, [defaultTitle]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [meetingId]);

  const keep = useMutation({
    mutationFn: async () => {
      if (!meeting) throw new Error("This meeting could not be opened.");
      const name = title.trim() || keepMeetingDefaultTitle(meeting);
      const file = new File(
        [
          keepMeetingMarkdown(
            meeting,
            keepMeetingPageUrl(tenantId, meeting.id),
          ),
        ],
        keepMeetingFileName(name),
        { type: "text/markdown" },
      );
      return client.uploadPersonalWikiDocument(
        tenantId,
        { file, representationFormat: "markdown" },
        keepMeetingIdempotencyKey(meeting),
      );
    },
    onSuccess: (document) => {
      void navigate(keptMeetingDocumentPath(tenantId, document.id));
    },
  });

  if (meetings.isPending) {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-6 py-10">
        <div className="mx-auto w-full max-w-xl">
          <Link
            className="mb-6 inline-block text-sm text-muted-foreground underline"
            to={meetingsTabPath(tenantId, "week")}
          >
            Back to meetings
          </Link>
          <p
            className="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Spinner size={16} />
            Loading this meeting...
          </p>
        </div>
      </main>
    );
  }

  if (meetings.isError || !meeting) {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-6 py-10">
        <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-4">
          <Link
            className="text-sm text-muted-foreground underline"
            to={meetingsTabPath(tenantId, "week")}
          >
            Back to meetings
          </Link>
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
      </main>
    );
  }

  const words = keepMeetingWords(meeting);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!words || keep.isPending) return;
    keep.mutate();
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-6 py-10">
      <div className="mx-auto w-full max-w-xl">
        <Link
          className="mb-6 inline-block text-sm text-muted-foreground underline"
          to={meetingPath(tenantId, meeting.id)}
        >
          Back to the meeting
        </Link>
        <p className="text-sm text-muted-foreground">{defaultTitle}</p>
        <h1 className="mt-1 text-2xl text-foreground">Keep this meeting</h1>
        {words ? (
          <>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              These words become a page in your library. The meeting stays as it
              is, and you can keep writing the page.
            </p>
            <blockquote className="mt-6 border-l-2 border-border pl-4 text-sm leading-6 text-foreground">
              {words.length > 280 ? `${words.slice(0, 280)}...` : words}
            </blockquote>
            <form className="mt-6" onSubmit={submit}>
              <label className="block" htmlFor={titleId}>
                <span className="mb-1.5 block text-sm font-medium">
                  Page name
                </span>
                <input
                  className="ui-field-control w-full"
                  id={titleId}
                  maxLength={80}
                  onChange={(event) => setTitle(event.target.value)}
                  ref={titleRef}
                  value={title}
                />
              </label>
              <Button
                className="mt-4"
                disabled={!title.trim() || keep.isPending}
                tone="primary"
                type="submit"
              >
                Keep this page
              </Button>
              {keep.isError ? (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  The page could not be kept.
                </p>
              ) : null}
            </form>
          </>
        ) : (
          <p
            className="mt-3 text-sm leading-6 text-muted-foreground"
            role="status"
          >
            The summary is not written yet, so there is nothing to keep as a
            page.
          </p>
        )}
      </div>
    </main>
  );
}
