import {
  Download01Icon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { Select, SelectItem } from "@/components/ui/select";
import { isShortcutKeyEvent } from "@/lib/keyboard-shortcut";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";

import {
  forgetMeetingPosition,
  readMeetingResume,
  rememberMeetingPosition,
  resumablePosition,
} from "./meeting-resume";
import {
  DEFAULT_MEETING_PLAYBACK_RATE,
  isMeetingPlaybackRate,
  MEETING_PLAYBACK_RATES,
  readMeetingPlaybackSpeed,
  writeMeetingPlaybackSpeed,
  type MeetingPlaybackRate,
} from "./meeting-playback-speed";

/** "754.2" seconds -> "12:34"; hours appear only when needed. */
export function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** Long enough to notice the change was refused, short enough not to linger. */
const rateNoticeMs = 2000;
/** Between time-update saves, so scrubbing does not write on every frame. */
const resumeSaveIntervalMs = 5000;
/** How far one arrow key moves the playhead. */
const seekStepSeconds = 5;
/**
 * Controls that act on a bare Space themselves. The player leaves the key to
 * them so the control fires once, not twice.
 */
const activatableSelector =
  "a, button, summary, [role='button'], [role='tab'], [role='menuitem']";

function rateLabel(rate: number) {
  return `${rate}x`;
}

/**
 * A quiet one-line player for a meeting recording: a round ink play button,
 * the elapsed and total time, a thin seekable track, a playback-speed pill,
 * and a download icon. Without a source it renders the same frame, disabled,
 * while it loads.
 */
export function MeetingAudioPlayer({
  accountId,
  downloadDisabled,
  filename,
  mediaType,
  meetingId,
  onDownload,
  src,
  status,
}: {
  /** Whose listening positions and speed this browser remembers. */
  accountId?: string;
  downloadDisabled?: boolean;
  filename: string;
  mediaType?: string;
  /** Changes with the meeting, so the next one carries its Account's speed. */
  meetingId?: string;
  onDownload: () => void;
  src?: string;
  /** Replaces the time line, e.g. while the recording is still loading. */
  status?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState<MeetingPlaybackRate>(() =>
    readMeetingPlaybackSpeed(accountId),
  );
  const [rateNotice, setRateNotice] = useState(false);
  const [resumeFrom, setResumeFrom] = useState<number>();
  const rateNoticeTimer = useRef<number | undefined>(undefined);
  const restoredRef = useRef(false);
  const lastSavedAt = useRef(0);
  const ready = Boolean(src) && !failed;
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;

  // The element leaves with the player, but the media element outlives a
  // meeting change, so the speed it carried must not, while the Account's
  // chosen speed stays in this browser.
  const attachAudio = useCallback(
    (element: HTMLAudioElement | null) => {
      audioRef.current = element;
      // The element mounts only once the recording has a src, which can be
      // later than the meeting change that read this Account's speed.
      if (element) element.playbackRate = readMeetingPlaybackSpeed(accountId);
      return () => {
        if (!element) return;
        element.playbackRate = DEFAULT_MEETING_PLAYBACK_RATE;
        rememberMeetingPosition(
          accountId,
          meetingId,
          element.currentTime,
          Date.now(),
        );
      };
    },
    [accountId, meetingId],
  );

  // Another meeting is another recording: the remembered position belongs to
  // that one playback and is never carried over. The speed is the Account's
  // preference, so the next recording opens at the speed last chosen.
  useEffect(() => {
    window.clearTimeout(rateNoticeTimer.current);
    const storedRate = readMeetingPlaybackSpeed(accountId);
    setRate(storedRate);
    setRateNotice(false);
    setResumeFrom(undefined);
    restoredRef.current = false;
    lastSavedAt.current = 0;
    if (audioRef.current) audioRef.current.playbackRate = storedRate;
  }, [accountId, meetingId]);

  useEffect(() => () => window.clearTimeout(rateNoticeTimer.current), []);

  /** Saves the place now; a position at the very start is no place to return to. */
  function savePosition(at: number) {
    if (!accountId || !meetingId) return;
    if (!Number.isFinite(at) || at <= 0) return;
    const now = Date.now();
    rememberMeetingPosition(accountId, meetingId, at, now);
    lastSavedAt.current = now;
  }

  /** Applies a remembered place once its metadata supplies the duration. */
  function restorePosition(audio: HTMLAudioElement) {
    if (restoredRef.current || !accountId || !meetingId) return;
    restoredRef.current = true;
    const entry = readMeetingResume(accountId)[meetingId];
    const position = entry
      ? resumablePosition(entry.position, audio.duration)
      : null;
    if (position === null) return;
    audio.currentTime = position;
    setCurrent(position);
    setResumeFrom(position);
  }

  function startFromBeginning() {
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;
    lastSavedAt.current = 0;
    setCurrent(0);
    setResumeFrom(undefined);
    forgetMeetingPosition(accountId, meetingId);
  }

  function onTimeUpdate(event: SyntheticEvent<HTMLAudioElement>) {
    const at = event.currentTarget.currentTime;
    setCurrent(at);
    // Scrubbing fires time updates in a burst; one write per interval is enough
    // to survive a reload, and pause or seek saves land immediately.
    if (Date.now() - lastSavedAt.current < resumeSaveIntervalMs) return;
    savePosition(at);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  /** Moves the playhead five seconds and stops at either end of the recording. */
  function seekBy(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }
    const next = Math.min(
      Math.max(audio.currentTime + seconds, 0),
      audio.duration,
    );
    audio.currentTime = next;
    setCurrent(next);
    // Choosing a moment by hand takes over from the resumed one.
    setResumeFrom(undefined);
    if (next > 0) savePosition(next);
    else forgetMeetingPosition(accountId, meetingId);
  }

  /**
   * The recording answers Space and the side arrows while the person works
   * inside the meeting, and the meeting surface decides when a key is its own.
   */
  const onSurfaceKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isShortcutKeyEvent(event)) return;
    if (!audioRef.current || !ready) return;
    if (event.key === " ") {
      if (
        event.target instanceof Element &&
        event.target.closest(activatableSelector)
      ) {
        return;
      }
      event.preventDefault();
      toggle();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    seekBy(event.key === "ArrowLeft" ? -seekStepSeconds : seekStepSeconds);
  });

  useEffect(() => {
    // The handler belongs to the meeting surface, not to the window, so it goes
    // quiet as soon as the meeting is left.
    const surface = sectionRef.current?.closest<HTMLElement>(
      "[data-meeting-surface]",
    );
    if (!surface) return;
    function onKeyDown(event: KeyboardEvent) {
      onSurfaceKeyDown(event);
    }
    surface.addEventListener("keydown", onKeyDown);
    return () => surface.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Applies a speed to the playing element and reports the one really in
   * effect. A browser that refuses the rate keeps the previous one, and the
   * control says so instead of showing a speed that is not active.
   */
  function chooseRate(next: string) {
    const audio = audioRef.current;
    const requested = Number(next);
    if (!audio || !isMeetingPlaybackRate(requested)) return;
    window.clearTimeout(rateNoticeTimer.current);
    setRateNotice(false);
    try {
      audio.playbackRate = requested;
    } catch {
      // The element keeps the rate it already had.
    }
    // Some browsers clamp the rate rather than throw, so read it back.
    if (audio.playbackRate === requested) {
      setRate(requested);
      // The Account's choice outlives this meeting and this tab.
      writeMeetingPlaybackSpeed(accountId, requested);
      return;
    }
    try {
      audio.playbackRate = rate;
    } catch {
      // The refusal already left the previous rate in place.
    }
    // The control keeps showing the rate still in effect, never the refused one.
    setRateNotice(true);
    rateNoticeTimer.current = window.setTimeout(
      () => setRateNotice(false),
      rateNoticeMs,
    );
  }

  return (
    <section
      aria-label="Meeting recording"
      className="flex items-center gap-3 rounded-xl border border-app-border bg-app-surface px-3 py-2.5"
      ref={sectionRef}
    >
      {src ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- user-provided media has no caption track to reference
        <audio
          onDurationChange={(event) =>
            setDuration(event.currentTarget.duration)
          }
          onEnded={() => setPlaying(false)}
          onError={() => setFailed(true)}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration);
            restorePosition(event.currentTarget);
          }}
          onPause={(event) => {
            setPlaying(false);
            savePosition(event.currentTarget.currentTime);
          }}
          onPlay={() => {
            setPlaying(true);
            setResumeFrom(undefined);
          }}
          onTimeUpdate={onTimeUpdate}
          preload="metadata"
          ref={attachAudio}
          title={filename}
        >
          <source src={src} type={mediaType} />
        </audio>
      ) : null}
      <button
        aria-label={playing ? "Pause recording" : "Play recording"}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-app-ink text-app-surface transition-[transform,opacity] duration-150 active:scale-95 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus focus-visible:ring-offset-2"
        disabled={!ready}
        onClick={toggle}
        type="button"
      >
        {playing ? (
          <Icon icon={PauseIcon} size={14} />
        ) : (
          <Icon icon={PlayIcon} className="translate-x-px" size={14} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[14px] font-medium text-app-ink">
            Meeting recording
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-app-muted">
            {failed
              ? "This browser cannot play it; download instead."
              : (status ??
                `${formatPlaybackTime(current)} / ${formatPlaybackTime(duration)}`)}
          </span>
        </div>
        <input
          aria-label="Seek recording"
          aria-valuetext={`${formatPlaybackTime(current)} of ${formatPlaybackTime(duration)}`}
          className="meeting-audio-track mt-1.5 block w-full"
          disabled={!ready || !duration}
          max={duration || 0}
          min={0}
          onChange={(event) => {
            const audio = audioRef.current;
            if (!audio) return;
            audio.currentTime = Number(event.target.value);
            setCurrent(audio.currentTime);
            // Choosing a place by hand takes over from the resumed one.
            setResumeFrom(undefined);
            if (audio.currentTime > 0) savePosition(audio.currentTime);
            else forgetMeetingPosition(accountId, meetingId);
          }}
          step={0.1}
          style={
            { "--meeting-audio-progress": `${progress}%` } as CSSProperties
          }
          type="range"
          value={current}
        />
        {resumeFrom !== undefined ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-app-muted">
            <span>
              Resumed at {formatPlaybackTime(resumeFrom)} /{" "}
              {formatPlaybackTime(duration)}
            </span>
            <button
              className="rounded-sm text-app-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
              onClick={startFromBeginning}
              type="button"
            >
              Start from the beginning
            </button>
          </p>
        ) : null}
      </div>
      <Select
        aria-label={`Playback speed, ${rateLabel(rate)}`}
        className="shrink-0"
        disabled={!ready}
        onValueChange={chooseRate}
        value={String(rate)}
        variant="pill"
      >
        {MEETING_PLAYBACK_RATES.map((value) => (
          <SelectItem key={value} value={String(value)}>
            {rateLabel(value)}
          </SelectItem>
        ))}
      </Select>
      {rateNotice ? (
        <span className="shrink-0 text-[11px] text-app-danger" role="status">
          Speed unavailable
        </span>
      ) : null}
      <button
        aria-label={`Download ${filename}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
        disabled={downloadDisabled}
        onClick={onDownload}
        title="Download recording"
        type="button"
      >
        <Icon icon={Download01Icon} size={16} />
      </button>
    </section>
  );
}
