import { Cancel01Icon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { Icon } from "@/components/ui/icon";

import { releaseCarriedMeeting, useCarriedMeeting } from "./meeting-carry";
import { rememberMeetingPosition } from "./meeting-resume";

/** Between time-update saves, so the bar does not write on every frame. */
const saveIntervalMs = 5000;

/**
 * The recording that was playing when its meeting closed. It stays at the
 * bottom of the workspace until the listener leaves it behind.
 */
export function MeetingCarryBar() {
  const carried = useCarriedMeeting();
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSavedAt = useRef(0);
  const [playing, setPlaying] = useState(true);
  if (!carried) return null;
  const meeting = carried;

  function save(at: number) {
    if (Date.now() - lastSavedAt.current < saveIntervalMs) return;
    rememberMeetingPosition(
      meeting.accountId,
      meeting.meetingId,
      at,
      Date.now(),
    );
    lastSavedAt.current = Date.now();
  }

  function leaveBehind() {
    const at = audioRef.current?.currentTime;
    if (at !== undefined)
      rememberMeetingPosition(
        meeting.accountId,
        meeting.meetingId,
        at,
        Date.now(),
      );
    releaseCarriedMeeting();
  }

  return (
    <section
      aria-label="Meeting still playing"
      className="flex shrink-0 items-center gap-3 border-t border-app-border bg-app-surface px-3 py-2"
      key={meeting.meetingId}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-provided media has no caption track to reference */}
      <audio
        onEnded={leaveBehind}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          audio.playbackRate = meeting.rate;
          if (meeting.seconds > 0) audio.currentTime = meeting.seconds;
          void audio.play().catch(() => setPlaying(false));
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) => save(event.currentTarget.currentTime)}
        preload="auto"
        ref={audioRef}
        src={meeting.src}
        title={meeting.filename}
      />
      <button
        aria-label={playing ? "Pause recording" : "Play recording"}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-app-ink text-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play().catch(() => setPlaying(false));
          else audio.pause();
        }}
        type="button"
      >
        {playing ? (
          <Icon icon={PauseIcon} size={14} />
        ) : (
          <Icon icon={PlayIcon} className="translate-x-px" size={14} />
        )}
      </button>
      <Link
        className="min-w-0 flex-1 truncate text-sm text-app-ink hover:underline"
        to={meeting.href}
      >
        {meeting.title}
      </Link>
      <button
        aria-label="Leave the recording"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-app-muted hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
        onClick={leaveBehind}
        type="button"
      >
        <Icon icon={Cancel01Icon} size={14} />
      </button>
    </section>
  );
}
