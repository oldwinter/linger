import { Link, useParams } from "react-router";

import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useT } from "@/i18n/use-translation";

import { recordingMessages as m } from "./recording.messages";
import {
  useOptionalVoiceControl,
  type VoiceCaptureState,
} from "./voice-control-context";

/** The words a recording is hearing, large enough to watch as they arrive. */
export function HearingPage() {
  const t = useT();
  const voice = useOptionalVoiceControl();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const hearing = isHearing(voice?.captureState.status);
  const items = hearing ? (voice?.transcriptItems ?? []) : [];
  const partial = hearing ? voice?.partialTranscript?.trim() : undefined;
  const latest = items.at(-1);
  const earlier = items.slice(0, -1).slice(-3);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">{t(m.hearingTitle)}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(m.hearingSubtitle)}
          </p>
        </header>
        {!hearing ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.hearingNothing)}
          </p>
        ) : (
          <div aria-live="polite" className="flex flex-col gap-4">
            {latest ? (
              <p className="text-2xl text-foreground">{latest.text}</p>
            ) : (
              <p className="text-2xl text-muted-foreground" role="status">
                {t(m.hearingListening)}
              </p>
            )}
            {partial ? (
              <p className="text-sm italic text-muted-foreground">{partial}</p>
            ) : null}
            {earlier.length ? (
              <ul
                aria-label={t(m.hearingEarlierLabel)}
                className="flex flex-col gap-2"
              >
                {earlier.map((item) => (
                  <li className="text-sm text-muted-foreground" key={item.id}>
                    {item.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
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

function isHearing(status: VoiceCaptureState["status"] | undefined) {
  return (
    status === "starting" ||
    status === "recording" ||
    status === "finalizing" ||
    status === "recovering"
  );
}
