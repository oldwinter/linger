import { useRef, useState } from "react";

/** Each edge is long enough to hear a sentence, short enough to hold in mind. */
const MEETING_EDGE_SECONDS = 12;

/** A middle this long keeps the two edges from being the whole meeting. */
const MIDDLE_SECONDS = 20;

export interface MeetingEdges {
  /** Where the closing stretch starts, in seconds. */
  closeAt: number;
  edge: number;
}

/**
 * The opening and the close of a recording, heard as one moment.
 * A short recording has no middle to leave out, so it has no such moment.
 */
export function meetingOpenAndClose(
  duration: number,
): MeetingEdges | undefined {
  if (
    !Number.isFinite(duration) ||
    duration < MEETING_EDGE_SECONDS * 2 + MIDDLE_SECONDS
  )
    return undefined;
  return {
    closeAt: duration - MEETING_EDGE_SECONDS,
    edge: MEETING_EDGE_SECONDS,
  };
}

/**
 * Plays a recording's first stretch and last stretch at the same time.
 * Neither stretch is the meeting's own playhead.
 */
export function MeetingOpenAndClose({
  duration,
  mediaType,
  onEngage,
  src,
}: {
  duration: number;
  mediaType?: string;
  /** The meeting's own recording waits so the two edges are what is heard. */
  onEngage?: () => void;
  src: string;
}) {
  const windows = meetingOpenAndClose(duration);
  const openRef = useRef<HTMLAudioElement>(null);
  const closeRef = useRef<HTMLAudioElement>(null);
  const [hearing, setHearing] = useState(false);

  if (!windows) return null;

  const stop = () => {
    openRef.current?.pause();
    closeRef.current?.pause();
    setHearing(false);
  };

  const start = () => {
    const opening = openRef.current;
    const closing = closeRef.current;
    if (!opening || !closing) return;
    onEngage?.();
    opening.currentTime = 0;
    closing.currentTime = windows.closeAt;
    setHearing(true);
    void opening.play()?.catch(() => setHearing(false));
    void closing.play()?.catch(() => setHearing(false));
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* eslint-disable jsx-a11y/media-has-caption -- user-provided media has no caption track */}
      <audio
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime >= windows.edge)
            event.currentTarget.pause();
        }}
        preload="metadata"
        ref={openRef}
      >
        <source src={src} type={mediaType} />
      </audio>
      <audio
        onEnded={stop}
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime >= windows.closeAt + windows.edge)
            stop();
        }}
        preload="metadata"
        ref={closeRef}
      >
        <source src={src} type={mediaType} />
      </audio>
      {/* eslint-enable jsx-a11y/media-has-caption */}
      <button
        className="rounded-sm text-[11px] leading-4 text-app-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
        onClick={hearing ? stop : start}
        type="button"
      >
        {hearing
          ? "Stop the open and the close"
          : "Hear the open and the close"}
      </button>
      {hearing ? (
        <span className="text-[11px] leading-4 text-app-muted" role="status">
          Hearing the open and the close
        </span>
      ) : null}
    </div>
  );
}
