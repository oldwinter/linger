import {
  Download01Icon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useRef, useState, type CSSProperties } from "react";

import { readMeetingPlayback, writeMeetingPlayback } from "./meeting-playback";

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

/**
 * A quiet one-line player for a meeting recording: a round ink play button,
 * the elapsed and total time, a thin seekable track, and a download icon.
 * Without a source it renders the same frame, disabled, while it loads.
 */
export function MeetingAudioPlayer({
  downloadDisabled,
  filename,
  mediaType,
  onDownload,
  resume,
  src,
  status,
}: {
  downloadDisabled?: boolean;
  filename: string;
  mediaType?: string;
  onDownload: () => void;
  /** Remembers this recording for the signed-in account across visits. */
  resume?: { accountId: string; captureId: string };
  src?: string;
  /** Replaces the time line, e.g. while the recording is still loading. */
  status?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastWritten = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const ready = Boolean(src) && !failed;
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
  const resumeLabel =
    !playing && current > 3
      ? `Resume at ${formatPlaybackTime(current)}`
      : undefined;

  function remember(seconds: number, total: number) {
    if (!resume) return;
    const finished =
      Number.isFinite(total) && total > 0 && seconds >= total - 5;
    const keep = Number.isFinite(seconds) && seconds > 3 && !finished;
    if (!keep) {
      // A zero playhead at load is not the listener reaching the end.
      if (!finished) return;
      writeMeetingPlayback(resume.accountId, resume.captureId, seconds, total);
      lastWritten.current = 0;
      return;
    }
    if (Math.abs(seconds - lastWritten.current) < 5) return;
    writeMeetingPlayback(resume.accountId, resume.captureId, seconds, total);
    lastWritten.current = Math.floor(seconds);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
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
          onEnded={(event) => {
            setPlaying(false);
            remember(
              event.currentTarget.duration,
              event.currentTarget.duration,
            );
          }}
          onError={() => setFailed(true)}
          onLoadedMetadata={(event) => {
            const audio = event.currentTarget;
            setDuration(audio.duration);
            if (!resume) return;
            const saved = readMeetingPlayback(
              resume.accountId,
              resume.captureId,
            );
            if (saved > 3 && audio.duration && saved < audio.duration - 5) {
              audio.currentTime = saved;
              setCurrent(saved);
              lastWritten.current = saved;
            }
          }}
          onPause={(event) => {
            setPlaying(false);
            remember(
              event.currentTarget.currentTime,
              event.currentTarget.duration,
            );
          }}
          onPlay={() => setPlaying(true)}
          onTimeUpdate={(event) => {
            setCurrent(event.currentTarget.currentTime);
            remember(
              event.currentTarget.currentTime,
              event.currentTarget.duration,
            );
          }}
          preload="metadata"
          ref={audioRef}
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
            {resumeLabel ?? "Meeting recording"}
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
