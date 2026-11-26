import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { personalProfileQueryOptions } from "@/features/settings/personal-profile-queries";
import {
  pocketNotesQueryKey,
  storeTodayPocketNote,
} from "@/features/rooms/pocket-notes/pocket-note-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import {
  introductionLines,
  introductionNote,
  introductionParagraphs,
  noteWithIntroduction,
  type IntroductionLead,
} from "./introduction";
import { IntroduceInRoom } from "./introduce-in-room-control";
import { wikiSubpagesMessages as m } from "./wiki-subpages.messages";

const leads: Array<{ id: IntroductionLead; label: Message<string> }> = [
  { id: "person", label: m.leadPerson },
  { id: "talk", label: m.leadTalk },
  { id: "work", label: m.leadWork },
];

/** A card Another Me would hand a friend, then kept on today's Pocket note. */
export function IntroductionPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const t = useT();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const profile = useQuery(personalProfileQueryOptions(client, tenantId));
  const notes = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/me/pocket-notes", {
          params: { path: { tenantId } },
        }),
      ),
    queryKey: [...pocketNotesQueryKey(tenantId), "introduction"],
  });
  const [lead, setLead] = useState<IntroductionLead>("person");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const current = profile.data?.current?.profile;
  const lines = current ? introductionLines(current) : undefined;
  const paragraphs = lines ? introductionParagraphs(lines, lead) : [];
  const note = paragraphs.length ? introductionNote(paragraphs) : "";
  const today = notes.data?.today;
  const todayText =
    notes.data?.items.find((item) => item.date === today)?.text ?? "";
  const alreadyKept = Boolean(note) && todayText.includes(note.trim());

  const keep = async () => {
    if (!today || !note || pending || alreadyKept) return;
    const next = noteWithIntroduction(todayText, note);
    if (!next) {
      setError(t(m.noteFullError));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const saved = await teamHubData(
        client.api.PUT("/v0/tenants/{tenantId}/me/pocket-notes/today", {
          params: { path: { tenantId } },
          body: { text: next },
        }),
      );
      storeTodayPocketNote(queryClient, tenantId, saved);
      setKept(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(m.noteUpdateFailed));
    } finally {
      setPending(false);
    }
  };

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToProfile)}
      backTo={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
      subtitle={t(m.introSubtitle)}
      title={t(m.introTitle)}
    >
      {profile.isPending || notes.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingIntro)}
        </p>
      ) : profile.isError || notes.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">{t(m.introLoadFailed)}</p>
          <Button
            onClick={() => {
              if (profile.isError) void profile.refetch();
              if (notes.isError) void notes.refetch();
            }}
            size="compact"
            tone="secondary"
          >
            {t(commonMessages.retry)}
          </Button>
        </div>
      ) : !current || paragraphs.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.notEnoughToIntroduce)}
        </p>
      ) : (
        <>
          <div
            aria-label={t(m.openingLine)}
            className="flex flex-wrap gap-2"
            role="group"
          >
            {leads.map((item) => (
              <Button
                aria-pressed={lead === item.id}
                key={item.id}
                onClick={() => {
                  setLead(item.id);
                  setKept(false);
                }}
                tone={lead === item.id ? "primary" : "secondary"}
                type="button"
              >
                {t(item.label)}
              </Button>
            ))}
          </div>
          <article
            aria-label={t(m.introArticleLabel)}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 py-5 shadow-xs"
          >
            {paragraphs.map((paragraph) => (
              <p className="text-sm text-foreground" key={paragraph}>
                {paragraph}
              </p>
            ))}
          </article>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {kept || alreadyKept ? (
            <p className="text-sm text-foreground" role="status">
              {t(m.onTodaysNote)}
            </p>
          ) : (
            <Button
              data-voice-risk="never"
              disabled={pending}
              onClick={() => void keep()}
              type="button"
            >
              {pending ? t(m.leavingOnNote) : t(m.leaveOnTodaysNote)}
            </Button>
          )}
          <IntroduceInRoom
            key={paragraphs.join("\n")}
            paragraphs={paragraphs}
            tenantId={tenantId}
          />
        </>
      )}
    </LibrarySubpageShell>
  );
}
