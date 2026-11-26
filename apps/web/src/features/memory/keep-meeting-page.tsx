import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

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
import { memorySubpagesMessages as m } from "./memory-subpages.messages";
import { meetingPath } from "./meeting-routes";
import { meetingsTabPath } from "./meetings-panel";

export function KeepMeetingPage() {
  const { client } = useTeamHubRuntime();
  const navigate = useNavigate();
  const t = useT();
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
      if (!meeting) throw new Error(t(m.meetingCouldNotOpen));
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

  if (meetings.isError || !meeting) {
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

  const words = keepMeetingWords(meeting);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!words || keep.isPending) return;
    keep.mutate();
  }

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToMeeting)}
      backTo={meetingPath(tenantId, meeting.id)}
      eyebrow={defaultTitle}
      subtitle={words ? t(m.keepSubtitle) : undefined}
      title={t(m.keepTitle)}
    >
      {words ? (
        <>
          <blockquote className="rounded-r-xl border-l-2 border-border bg-card py-3 pl-4 pr-4 text-sm leading-6 text-foreground">
            {words.length > 280 ? `${words.slice(0, 280)}...` : words}
          </blockquote>
          <form onSubmit={submit}>
            <label className="block" htmlFor={titleId}>
              <span className="mb-1.5 block text-sm font-medium">
                {t(m.pageName)}
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
              {t(m.keepThisPage)}
            </Button>
            {keep.isError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {t(m.pageCouldNotBeKept)}
              </p>
            ) : null}
          </form>
        </>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground" role="status">
          {t(m.summaryNotWrittenYet)}
        </p>
      )}
    </LibrarySubpageShell>
  );
}
