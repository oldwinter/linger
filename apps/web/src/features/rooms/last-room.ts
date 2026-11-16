import {
  notifyPreferenceChange,
  removePreferenceKeys,
  storedPreferenceKeys,
  subscribePreferenceChange,
} from "@/lib/local-preference-keys";

const PREFIX = "last-room.v1:";
const CHANGED = "last-room-changed";

/**
 * Which Room a Space opens on after the person has already been in one.
 * A remembered Room that is gone falls through to Another Me, then the first
 * Room. The first visit, with nothing remembered, still opens Another Me.
 */
export function pickLandingRoom(
  roomIds: readonly string[],
  anotherMeRoomId: string | undefined,
  rememberedRoomId: string | undefined,
): string | undefined {
  if (rememberedRoomId && roomIds.includes(rememberedRoomId)) {
    return rememberedRoomId;
  }
  if (anotherMeRoomId && roomIds.includes(anotherMeRoomId)) {
    return anotherMeRoomId;
  }
  return roomIds[0];
}

export function readLastRoom(
  accountId: string | undefined,
  tenantId: string | undefined,
): string | undefined {
  if (!accountId || !tenantId) return undefined;
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(storageKey(accountId)) ?? "{}",
    );
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return undefined;
    }
    const roomId = (stored as Record<string, unknown>)[tenantId];
    return typeof roomId === "string" && roomId ? roomId : undefined;
  } catch {
    return undefined;
  }
}

export function rememberLastRoom(
  accountId: string | undefined,
  tenantId: string,
  roomId: string,
) {
  if (!accountId || !roomId) return;
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(storageKey(accountId)) ?? "{}",
    );
    const rooms =
      stored && typeof stored === "object" && !Array.isArray(stored)
        ? { ...(stored as Record<string, string>) }
        : {};
    if (rooms[tenantId] === roomId) return;
    rooms[tenantId] = roomId;
    window.localStorage.setItem(storageKey(accountId), JSON.stringify(rooms));
  } catch {
    return;
  }
  notifyPreferenceChange(CHANGED);
}

export function hasLastRoom(): boolean {
  return storedPreferenceKeys([PREFIX]).length > 0;
}

export function clearLastRooms(): void {
  removePreferenceKeys([PREFIX]);
  notifyPreferenceChange(CHANGED);
}

export function subscribeLastRoom(listener: () => void): () => void {
  return subscribePreferenceChange(CHANGED, listener);
}

function storageKey(accountId: string) {
  return `${PREFIX}${accountId}`;
}
