import {
  Download01Icon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { Select, SelectItem } from "@/components/ui/select";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

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

/** The speeds a recording offers; every meeting starts at the default. */
const playbackRates = [0.75, 1, 1.25, 1.5, 2] as const;
const defaultRate = 1;
/** Long enough to notice the change was refused, short enough not to linger. */
const rateNoticeMs = 2000;

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
  downloadDisabled,
  filename,
  mediaType,
  meetingId,
  onDownload,
  src,
  status,
}: {
  downloadDisabled?: boolean;
  filename: string;
  mediaType?: string;
  /** Changes with the meeting, so the next one starts at the default speed. */
  meetingId?: string;
  onDownload: () => void;
  src?: string;
  /** Replaces the time line, e.g. while the recording is still loading. */
  status?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState(defaultRate);
  const [rateNotice, setRateNotice] = useState(false);
  const rateNoticeTimer = useRef<number | undefined>(undefined);
  const ready = Boolean(src) && !failed;
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;

  // The element leaves with the player, but a rate must not outlive it.
  const attachAudio = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    return () => {
      if (element) element.playbackRate = defaultRate;
    };
  }, []);

  // Another meeting is another recording: the speed choice belongs to this
  // playback and is never carried over or stored.
  useEffect(() => {
    window.clearTimeout(rateNoticeTimer.current);
    setRate(defaultRate);
    setRateNotice(false);
    if (audioRef.current) audioRef.current.playbackRate = defaultRate;
  }, [meetingId]);

  useEffect(() => () => window.clearTimeout(rateNoticeTimer.current), []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  /**
   * Applies a speed to the playing element and reports the one really in
   * effect. A browser that refuses the rate keeps the previous one, and the
   * control says so instead of showing a speed that is not active.
   */
  function chooseRate(next: string) {
    const audio = audioRef.current;
    if (!audio) return;
    const requested = Number(next);
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
    >
      {src ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- user-provided media has no caption track to reference
        <audio
          onDurationChange={(event) =>
            setDuration(event.currentTarget.duration)
          }
          onEnded={() => setPlaying(false)}
          onError={() => setFailed(true)}
          onLoadedMetadata={(event) =>
            setDuration(event.currentTarget.duration)
          }
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
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
          }}
          step={0.1}
          style={
            { "--meeting-audio-progress": `${progress}%` } as CSSProperties
          }
          type="range"
          value={current}
        />
      </div>
      <Select
        aria-label={`Playback speed, ${rateLabel(rate)}`}
        className="shrink-0"
        disabled={!ready}
        onValueChange={chooseRate}
        value={String(rate)}
        variant="pill"
      >
        {playbackRates.map((value) => (
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
