import { useSyncExternalStore } from "react";

import {
  DEFAULT_MEETING_PLAYBACK_RATE,
  isMeetingPlaybackRate,
  type MeetingPlaybackRate,
} from "./meeting-playback-speed";

/** What the meeting player was doing at the moment it left the screen. */
export interface PlaybackLeave {
  playing: boolean;
  rate: number;
  seconds: number;
}

/** The recording and the meeting it belongs to, before a blob URL exists. */
export interface CarriedMeetingDraft {
  accountId?: string;
  blob: Blob;
  filename: string;
  href: string;
  mediaType: string;
  meetingId: string;
  rate: MeetingPlaybackRate;
  seconds: number;
  title: string;
}

/** One recording that kept playing after its meeting page closed. */
export interface CarriedMeeting {
  accountId?: string;
  filename: string;
  href: string;
  mediaType: string;
  meetingId: string;
  rate: MeetingPlaybackRate;
  seconds: number;
  src: string;
  title: string;
}

/**
 * A playing audio recording can leave with the listener. A paused one, a
 * missing file, or anything that is not audio stays on the page that had it.
 */
export function carriedMeetingFromLeave(
  source: {
    accountId?: string;
    blob?: Blob;
    filename: string;
    href: string;
    mediaType?: string;
    meetingId: string;
    title: string;
  },
  leave: PlaybackLeave,
): CarriedMeetingDraft | undefined {
  if (!leave.playing || !source.blob) return;
  if (!source.mediaType?.toLowerCase().startsWith("audio/")) return;
  if (!Number.isFinite(leave.seconds) || leave.seconds < 0) return;
  return {
    accountId: source.accountId,
    blob: source.blob,
    filename: source.filename,
    href: source.href,
    mediaType: source.mediaType,
    meetingId: source.meetingId,
    rate: isMeetingPlaybackRate(leave.rate)
      ? leave.rate
      : DEFAULT_MEETING_PLAYBACK_RATE,
    seconds: leave.seconds,
    title: source.title,
  };
}

let carried: CarriedMeeting | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function revoke(meeting: CarriedMeeting | undefined) {
  if (meeting) URL.revokeObjectURL(meeting.src);
}

/** The recording still playing away from its meeting, if there is one. */
export function carriedMeetingSnapshot(): CarriedMeeting | undefined {
  return carried;
}

export function subscribeCarriedMeeting(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCarriedMeeting() {
  return useSyncExternalStore(subscribeCarriedMeeting, carriedMeetingSnapshot);
}

/** Keeps at most one recording. A newer one replaces whatever was playing. */
export function carryMeeting(draft: CarriedMeetingDraft) {
  const src = URL.createObjectURL(draft.blob);
  revoke(carried);
  carried = {
    accountId: draft.accountId,
    filename: draft.filename,
    href: draft.href,
    mediaType: draft.mediaType,
    meetingId: draft.meetingId,
    rate: draft.rate,
    seconds: draft.seconds,
    src,
    title: draft.title,
  };
  emit();
}

/** Stops the recording that followed the listener and frees its blob URL. */
export function releaseCarriedMeeting() {
  if (!carried) return;
  revoke(carried);
  carried = undefined;
  emit();
}
