export interface MeetingMediaControls {
  onPause: () => void;
  onPlay: () => void;
  title: string;
}

/**
 * Names the meeting for the browser's media controls and lets those controls
 * play or pause it. They are not given a way to move through the recording.
 */
export function bindMeetingMediaSession({
  onPause,
  onPlay,
  title,
}: MeetingMediaControls): () => void {
  const session = readMediaSession();
  if (!session || typeof MediaMetadata === "undefined") return () => undefined;
  session.metadata = new MediaMetadata({ title });
  try {
    session.setActionHandler("play", onPlay);
    session.setActionHandler("pause", onPause);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      session.setActionHandler("play", null);
      session.setActionHandler("pause", null);
    } catch {
      // The browser already dropped the handlers.
    }
    session.playbackState = "none";
    if (session.metadata?.title === title) session.metadata = null;
  };
}

/** Tells the browser's media controls whether the recording is going, and where. */
export function placeMeetingMediaSession({
  duration,
  playbackRate,
  playing,
  position,
}: {
  duration: number;
  playbackRate: number;
  playing: boolean;
  position: number;
}) {
  const session = readMediaSession();
  if (!session) return;
  session.playbackState = playing ? "playing" : "paused";
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (!Number.isFinite(position) || !Number.isFinite(playbackRate)) return;
  try {
    session.setPositionState({
      duration,
      playbackRate: playbackRate > 0 ? playbackRate : 1,
      position: Math.min(Math.max(position, 0), duration),
    });
  } catch {
    // A browser can refuse a position while nothing is playing.
  }
}

function readMediaSession(): MediaSession | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.mediaSession;
}
