import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
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

  if (meetings.isError || !meeting) {
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

  const words = keepMeetingWords(meeting);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!words || keep.isPending) return;
    keep.mutate();
  }

  return (
    <LibrarySubpageShell
      backLabel="Back to the meeting"
      backTo={meetingPath(tenantId, meeting.id)}
      eyebrow={defaultTitle}
      subtitle={
        words
          ? "These words become a page in your library. The meeting stays as it is, and you can keep writing the page."
          : undefined
      }
      title="Keep this meeting"
    >
      {words ? (
        <>
          <blockquote className="border-l-2 border-border pl-4 text-sm leading-6 text-foreground">
            {words.length > 280 ? `${words.slice(0, 280)}...` : words}
          </blockquote>
          <form onSubmit={submit}>
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
        <p className="text-sm leading-6 text-muted-foreground" role="status">
          The summary is not written yet, so there is nothing to keep as a page.
        </p>
      )}
    </LibrarySubpageShell>
  );
}
