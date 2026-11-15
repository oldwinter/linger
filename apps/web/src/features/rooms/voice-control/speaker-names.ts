import { useSyncExternalStore } from "react";

import type { VoiceTranscriptItem } from "./voice-control-context";

/** Speaker ids are anonymous clusters for one recording, so a name stays with that capture. */
const storagePrefix = "linger.voice-speaker-names.";
const emptyNames: SpeakerNameMap = {};
const listeners = new Set<() => void>();
const cache = new Map<string, { names: SpeakerNameMap; raw: string }>();

export interface SpeakerNameMap {
  [speakerId: string]: string;
}

export interface NamedVoice {
  fallback: string;
  id: string;
  lines: string[];
}

const speakerIdPattern = /^spk_[1-9][0-9]*$/;

export function speakerKey(
  item: Pick<VoiceTranscriptItem, "speakerId" | "speakerLabel">,
) {
  if (item.speakerId && speakerIdPattern.test(item.speakerId))
    return item.speakerId;
  const match = item.speakerLabel?.match(/^Speaker ([1-9][0-9]*)$/);
  return match ? `spk_${match[1]}` : undefined;
}

export function voicesInTranscript(items: readonly VoiceTranscriptItem[]) {
  const voices = new Map<string, NamedVoice>();
  for (const item of items) {
    const id = speakerKey(item);
    if (!id) continue;
    const voice = voices.get(id) ?? {
      fallback: item.speakerLabel ?? `Speaker ${id.slice("spk_".length)}`,
      id,
      lines: [],
    };
    voice.lines.push(item.text);
    voices.set(id, voice);
  }
  return [...voices.values()].sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true }),
  );
}

export function speakerDisplayName(
  speakerId: string | undefined,
  fallback: string | undefined,
  names: SpeakerNameMap,
) {
  if (speakerId && names[speakerId]) return names[speakerId];
  return fallback;
}

export function readSpeakerNames(
  captureId: string | undefined,
): SpeakerNameMap {
  if (!captureId) return emptyNames;
  const raw = readRaw(captureId);
  const cached = cache.get(captureId);
  if (cached && cached.raw === raw) return cached.names;
  const names = parseSpeakerNames(raw);
  cache.set(captureId, { names, raw });
  return names;
}

export function writeSpeakerNames(captureId: string, names: SpeakerNameMap) {
  const clean = parseSpeakerNames(JSON.stringify(names));
  const raw = JSON.stringify(clean);
  cache.set(captureId, { names: clean, raw });
  try {
    localStorage.setItem(storageKey(captureId), raw);
  } catch {
    // A private window can refuse storage; the in-memory copy still updates this page.
  }
  for (const listener of listeners) listener();
}

export function subscribeSpeakerNames(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSpeakerNames(captureId: string | undefined) {
  return useSyncExternalStore(
    subscribeSpeakerNames,
    () => readSpeakerNames(captureId),
    () => emptyNames,
  );
}

function storageKey(captureId: string) {
  return `${storagePrefix}${captureId}`;
}

function readRaw(captureId: string) {
  try {
    return localStorage.getItem(storageKey(captureId)) ?? "";
  } catch {
    return "";
  }
}

function parseSpeakerNames(raw: string): SpeakerNameMap {
  if (!raw) return emptyNames;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyNames;
  }
  if (!parsed || typeof parsed !== "object") return emptyNames;
  const names: SpeakerNameMap = {};
  for (const [id, name] of Object.entries(parsed)) {
    if (!speakerIdPattern.test(id) || typeof name !== "string") continue;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40) continue;
    names[id] = trimmed;
  }
  return Object.keys(names).length === 0 ? emptyNames : names;
}
