import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { isRecord } from "@linger/service-kit";

import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

const storagePrefix = "linger.meeting-told-part.";

function storageKey(accountId: string, meetingId: string) {
  return `${storagePrefix}${encodeURIComponent(accountId)}.${encodeURIComponent(meetingId)}`;
}

/** The sentence this account chose to tell from one meeting, if it is still stored. */
export function readToldPart(
  accountId: string,
  meetingId: string,
): string | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(
      storageKey(accountId, meetingId),
    );
    if (!stored) return undefined;
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed) || typeof parsed.sentence !== "string") {
      return undefined;
    }
    const sentence = parsed.sentence.trim();
    return sentence.length > 0 ? sentence : undefined;
  } catch {
    return undefined;
  }
}

export function writeToldPart(
  accountId: string,
  meetingId: string,
  sentence: string,
) {
  try {
    globalThis.localStorage?.setItem(
      storageKey(accountId, meetingId),
      JSON.stringify({ sentence }),
    );
  } catch {
    // The choice still shows on this page when the browser cannot store it.
  }
}

/**
 * The line you would tell from one meeting, kept on this computer for the
 * signed-in account. The meeting document itself stays read-only.
 */
export function useMeetingToldPart(meetingId: string, enabled: boolean) {
  const { client } = useTeamHubRuntime();
  const identity = useQuery({
    ...teamHubIdentityQueryOptions(client),
    enabled,
  });
  const accountId = identity.data?.account.id;
  const [sentence, setSentence] = useState<string | undefined>();
  const pending = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!accountId) return;
    if (pending.current !== undefined) {
      writeToldPart(accountId, meetingId, pending.current);
      pending.current = undefined;
      return;
    }
    setSentence(readToldPart(accountId, meetingId));
  }, [accountId, meetingId]);

  function choose(next: string) {
    setSentence(next);
    if (!accountId) {
      pending.current = next;
      return;
    }
    pending.current = undefined;
    writeToldPart(accountId, meetingId, next);
  }

  return { choose, ready: Boolean(accountId), sentence };
}
