import { meetingPath } from "@/features/memory/meeting-routes";
import {
  formatMeetingWhen,
  meetingWhen,
} from "@/features/memory/meetings-calendar";
import type {
  TeamHubMemoryEntry,
  TeamHubRoomListItem,
} from "@/features/teamhub/teamhub-types";
import { wikiCollections } from "@/features/wiki/wiki-display-state";
import { translate } from "@/i18n/language";

export interface JumpPlace {
  detail: string;
  id: string;
  keywords?: readonly string[];
  path: string;
  title: string;
}

function tenantPath(tenantId: string, suffix: string) {
  return `/t/${encodeURIComponent(tenantId)}${suffix}`;
}

function roomTitle(room: TeamHubRoomListItem, anotherMeRoomId?: string) {
  if (room.id === anotherMeRoomId) return "Another Me";
  return room.direct_peer?.display_name ?? room.name;
}

/** Recorded meetings formatted as navigable places, newest first. */
export function buildMeetingJumpPlaces(
  meetings: readonly TeamHubMemoryEntry[],
  tenantId: string,
): JumpPlace[] {
  return meetings
    .flatMap((entry) => {
      const when = meetingWhen(entry.path);
      if (!entry.meeting || !when) return [];
      return [
        {
          date: `${when.date}T${when.time}`,
          place: {
            detail: entry.meeting.recording_filename,
            id: `meeting-${entry.id}`,
            path: meetingPath(tenantId, entry.id),
            title: formatMeetingWhen(when.date, when.time),
          },
        },
      ];
    })
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((item) => item.place);
}

/** Core product surfaces shared by Jump and Global Search. */
export function buildCoreProductPlaces(tenantId: string): JumpPlace[] {
  return [
    {
      detail: "Tasks & work items",
      id: "dashboard",
      path: tenantPath(tenantId, "/dashboard"),
      title: "Dashboard",
    },
    {
      detail: "Files & documents",
      id: "library",
      path: tenantPath(tenantId, "/library"),
      title: "Library",
    },
    {
      detail: "Recordings & transcripts",
      id: "meetings",
      path: tenantPath(tenantId, "/library?tab=meetings"),
      title: "Meetings",
    },
    {
      detail: "Personal knowledge",
      id: "wiki",
      path: tenantPath(tenantId, "/library/wiki"),
      title: "Wiki",
    },
    ...Object.entries(wikiCollections).map(([id, words]) => ({
      detail: "Wiki",
      id: `wiki-${id}`,
      path: tenantPath(tenantId, `/library/wiki/${id}`),
      title: translate(words.label),
    })),
    {
      detail: "External integrations",
      id: "connectors",
      keywords: ["apps"],
      path: tenantPath(tenantId, "/apps"),
      title: "Connectors",
    },
    {
      detail: "Chats",
      id: "messages",
      path: tenantPath(tenantId, "/rooms"),
      title: "Messages",
    },
    {
      detail: "Account & preferences",
      id: "settings",
      path: tenantPath(tenantId, "/settings/account"),
      title: "Settings",
    },
    {
      detail: "Settings",
      id: "computers",
      keywords: ["local", "devices"],
      path: tenantPath(tenantId, "/settings/computers"),
      title: "Computers",
    },
    {
      detail: "Settings",
      id: "models",
      keywords: ["local", "byok"],
      path: tenantPath(tenantId, "/settings/models"),
      title: "Models",
    },
  ];
}

/**
 * Places you can open, not a search of message text. Threads stay out: a
 * thread is a message inside a room, and Search already opens those.
 */
export function buildJumpPlaces({
  anotherMeRoomId,
  meetings,
  rooms,
  tenantId,
}: {
  anotherMeRoomId?: string;
  meetings: readonly TeamHubMemoryEntry[];
  rooms: readonly TeamHubRoomListItem[];
  tenantId: string;
}): JumpPlace[] {
  const roomPlaces = rooms
    .filter((room) => room.kind !== "thread")
    .map((room) => ({
      detail: room.id === anotherMeRoomId ? "Your other self" : "Room",
      id: `room-${room.id}`,
      path: tenantPath(tenantId, `/rooms/${encodeURIComponent(room.id)}/chat`),
      title: roomTitle(room, anotherMeRoomId),
    }))
    .sort((left, right) => {
      if (left.title === "Another Me") return -1;
      if (right.title === "Another Me") return 1;
      return left.title.localeCompare(right.title);
    });
  return [
    ...roomPlaces,
    ...buildMeetingJumpPlaces(meetings, tenantId),
    ...buildCoreProductPlaces(tenantId),
  ];
}

export function filterJumpPlaces(places: readonly JumpPlace[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...places];
  return places.filter((place) =>
    [place.title, place.detail, ...(place.keywords ?? [])]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );
}
