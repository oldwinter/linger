import { useSyncExternalStore } from "react";

import type { TeamHubArtifactContentLocation } from "@/features/teamhub/teamhub-types";

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

/** One recording that kept playing after its meeting page closed. */
export interface CarriedMeeting {
  accountId?: string;
  dispose: () => void;
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
    filename: string;
    href: string;
    mediaType?: string;
    meetingId: string;
    playback?: TeamHubArtifactContentLocation;
    title: string;
  },
  leave: PlaybackLeave,
): CarriedMeeting | undefined {
  if (!leave.playing || !source.playback) return;
  if (!source.mediaType?.toLowerCase().startsWith("audio/")) return;
  if (!Number.isFinite(leave.seconds) || leave.seconds < 0) return;
  return {
    accountId: source.accountId,
    dispose: source.playback.dispose,
    filename: source.filename,
    href: source.href,
    mediaType: source.mediaType,
    meetingId: source.meetingId,
    rate: isMeetingPlaybackRate(leave.rate)
      ? leave.rate
      : DEFAULT_MEETING_PLAYBACK_RATE,
    seconds: leave.seconds,
    src: source.playback.url,
    title: source.title,
  };
}

let carried: CarriedMeeting | undefined;
let playbackSession = Symbol();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
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

/** A player captures this identity before its authenticated page can leave. */
export function currentMeetingPlaybackSession() {
  return playbackSession;
}

/** Authentication cleanup also invalidates players that have yet to unmount. */
export function resetMeetingPlaybackSession() {
  playbackSession = Symbol();
  releaseCarriedMeeting();
}

/** Accepts ownership only within the player's Session; newer audio replaces it. */
export function carryMeeting(meeting: CarriedMeeting, session: symbol) {
  if (session !== playbackSession) return false;
  carried?.dispose();
  carried = meeting;
  emit();
  return true;
}

/** Stops the recording that followed the listener and releases its playback. */
export function releaseCarriedMeeting() {
  if (!carried) return;
  carried.dispose();
  carried = undefined;
  emit();
}
