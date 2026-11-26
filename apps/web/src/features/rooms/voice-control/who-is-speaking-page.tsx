import { useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useT } from "@/i18n/use-translation";

import { recordingMessages as m } from "./recording.messages";
import {
  useSpeakerNames,
  voicesInTranscript,
  writeSpeakerNames,
  type SpeakerNameMap,
} from "./speaker-names";
import {
  useOptionalVoiceControl,
  type VoiceCaptureState,
} from "./voice-control-context";

/** Names for the voices in the recording that is open now. */
export function WhoIsSpeakingPage() {
  const t = useT();
  const voice = useOptionalVoiceControl();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const captureId = captureIdOf(voice?.captureState);
  const items = (voice?.transcriptItems ?? []).filter(
    (item) => !captureId || !item.captureId || item.captureId === captureId,
  );
  const voices = voicesInTranscript(items);
  const saved = useSpeakerNames(captureId);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">{t(m.whoIsSpeakingTitle)}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(m.whoIsSpeakingSubtitle)}
          </p>
        </header>
        {voices.length === 0 || !captureId ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.whoIsSpeakingEmpty)}
          </p>
        ) : (
          <VoiceNameForm
            captureId={captureId}
            key={captureId}
            saved={saved}
            voices={voices}
          />
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/t/${encodeURIComponent(tenantId)}/rooms`}
        >
          {t(m.backToMessages)}
        </Link>
      </div>
    </main>
  );
}

function VoiceNameForm({
  captureId,
  saved,
  voices,
}: {
  captureId: string;
  saved: SpeakerNameMap;
  voices: ReturnType<typeof voicesInTranscript>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(saved);
  const [savedNotice, setSavedNotice] = useState(false);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const next: SpeakerNameMap = {};
        for (const voice of voices) {
          const name = (draft[voice.id] ?? "").trim();
          if (name) next[voice.id] = name;
        }
        writeSpeakerNames(captureId, next);
        setSavedNotice(true);
      }}
    >
      {voices.map((voice) => {
        const typed = (draft[voice.id] ?? "").trim();
        const shown = typed || voice.fallback;
        return (
          <section className="flex flex-col gap-3" key={voice.id}>
            <label
              className="text-sm text-foreground"
              htmlFor={`voice-${voice.id}`}
            >
              {voice.fallback}
            </label>
            <input
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id={`voice-${voice.id}`}
              maxLength={40}
              onChange={(event) => {
                setSavedNotice(false);
                setDraft((current) => ({
                  ...current,
                  [voice.id]: event.target.value,
                }));
              }}
              placeholder={t(m.whoIsSpeakingNamePlaceholder)}
              value={draft[voice.id] ?? ""}
            />
            <div>
              <h2 className="text-sm text-foreground">{shown}</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {voice.lines.map((line, index) => (
                  <li
                    className="rounded-2xl border border-border px-4 py-3 text-sm text-foreground"
                    key={`${voice.id}-${index}`}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        );
      })}
      <Button type="submit">{t(m.whoIsSpeakingSubmit)}</Button>
      {savedNotice ? (
        <p className="text-sm text-foreground" role="status">
          {t(m.whoIsSpeakingSaved)}
        </p>
      ) : null}
    </form>
  );
}

function captureIdOf(state: VoiceCaptureState | undefined) {
  if (!state || state.status === "idle") return undefined;
  if (state.status === "failed") return state.capture?.id;
  return state.capture.id;
}
