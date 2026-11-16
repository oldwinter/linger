import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { personalProfileQueryOptions } from "@/features/settings/personal-profile-queries";
import {
  pocketNotesQueryKey,
  storeTodayPocketNote,
} from "@/features/rooms/pocket-notes/pocket-note-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  introductionLines,
  introductionNote,
  introductionParagraphs,
  noteWithIntroduction,
  type IntroductionLead,
} from "./introduction";
import { IntroduceInRoom } from "./introduce-in-room-control";

const leads: Array<{ id: IntroductionLead; label: string }> = [
  { id: "person", label: "Lead with who you are" },
  { id: "talk", label: "Lead with how to talk to you" },
  { id: "work", label: "Lead with how you work" },
];

/** A card Another Me would hand a friend, then kept on today's Pocket note. */
export function IntroductionPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
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
      setError("Today's note is full, so this introduction does not fit.");
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
      setError(
        cause instanceof Error
          ? cause.message
          : "Today's note could not be updated.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">
            How Another Me would introduce you
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A few lines from what Another Me remembers, in an order you would
            actually show someone.
          </p>
        </header>
        {profile.isPending || notes.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading your introduction.
          </p>
        ) : !current || paragraphs.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            Another Me has not written enough to introduce you yet.
          </p>
        ) : (
          <>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Opening line"
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
                  {item.label}
                </Button>
              ))}
            </div>
            <article
              aria-label="Introduction"
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 py-5"
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
                It is on today's note.
              </p>
            ) : (
              <Button
                disabled={pending}
                onClick={() => void keep()}
                type="button"
              >
                {pending ? "Leaving it" : "Leave this on today's note"}
              </Button>
            )}
            <IntroduceInRoom
              key={paragraphs.join("\n")}
              paragraphs={paragraphs}
              tenantId={tenantId}
            />
          </>
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
        >
          Back to Profile
        </Link>
      </div>
    </main>
  );
}
