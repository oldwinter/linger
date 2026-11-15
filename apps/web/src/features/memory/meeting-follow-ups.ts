import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { EMPTY_SECTION_TEXT } from "@linger/knowledge-format/sections";
import { isRecord } from "@linger/service-kit";

import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import type { MeetingOutcome } from "./meeting-overview";

const storagePrefix = "linger.meeting-follow-ups.";

/** Action lines worth checking off. Empty and "None observed." stay out. */
export function followUpTexts(outcomes: readonly MeetingOutcome[]): string[] {
  return outcomes
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0 && text !== EMPTY_SECTION_TEXT);
}

export function toggleFollowUp(
  checked: readonly string[],
  text: string,
): string[] {
  return checked.includes(text)
    ? checked.filter((item) => item !== text)
    : [...checked, text];
}

/** How many of these follow-ups are checked. Stored ids for other meetings do not count. */
export function followUpProgress(
  items: readonly string[],
  checked: readonly string[],
): { done: number; total: number } {
  const known = new Set(items);
  return {
    done: checked.filter((item) => known.has(item)).length,
    total: items.length,
  };
}

function storageKey(accountId: string, captureId: string) {
  return `${storagePrefix}${encodeURIComponent(accountId)}.${encodeURIComponent(captureId)}`;
}

export function readMeetingFollowUps(
  accountId: string,
  captureId: string,
): string[] {
  try {
    const stored = globalThis.localStorage?.getItem(
      storageKey(accountId, captureId),
    );
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed) || !Array.isArray(parsed.checked)) return [];
    return parsed.checked.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  } catch {
    return [];
  }
}

export function writeMeetingFollowUps(
  accountId: string,
  captureId: string,
  checked: readonly string[],
) {
  try {
    const storage = globalThis.localStorage;
    const key = storageKey(accountId, captureId);
    if (!storage) return;
    if (checked.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ checked }));
  } catch {
    // The checks still update on screen when this browser cannot store them.
  }
}

/**
 * Checks for one meeting's to-do list, kept on this computer for the signed-in
 * account. The meeting document itself stays read-only.
 */
export function useMeetingFollowUps(captureId: string, enabled: boolean) {
  const { client } = useTeamHubRuntime();
  const identity = useQuery({
    ...teamHubIdentityQueryOptions(client),
    enabled,
  });
  const accountId = identity.data?.account.id;
  const [checked, setChecked] = useState<string[]>([]);

  useEffect(() => {
    if (!accountId) return;
    setChecked(readMeetingFollowUps(accountId, captureId));
  }, [accountId, captureId]);

  function toggle(text: string) {
    if (!accountId) return;
    const next = toggleFollowUp(checked, text);
    setChecked(next);
    writeMeetingFollowUps(accountId, captureId, next);
  }

  return {
    checked: new Set(checked),
    ready: Boolean(accountId),
    toggle,
  };
}
