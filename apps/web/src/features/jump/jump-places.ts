import { meetingPath } from "@/features/memory/meeting-routes";
import {
  formatMeetingWhen,
  meetingWhen,
} from "@/features/memory/meetings-calendar";
import type {
  TeamHubMemoryEntry,
  TeamHubRoomListItem,
} from "@/features/teamhub/teamhub-types";
import { wikiCollectionLabels } from "@/features/wiki/wiki-display-state";

export interface JumpPlace {
  detail: string;
  id: string;
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
  const meetingPlaces = meetings
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
  const places: JumpPlace[] = [
    ...roomPlaces,
    ...meetingPlaces,
    {
      detail: "Files",
      id: "library",
      path: tenantPath(tenantId, "/library"),
      title: "Library",
    },
    {
      detail: "Meetings",
      id: "meetings",
      path: tenantPath(tenantId, "/library?tab=meetings"),
      title: "Meetings",
    },
    {
      detail: "Wiki",
      id: "wiki",
      path: tenantPath(tenantId, "/library/wiki"),
      title: "Wiki",
    },
    ...Object.entries(wikiCollectionLabels).map(([id, title]) => ({
      detail: "Wiki",
      id: `wiki-${id}`,
      path: tenantPath(tenantId, `/library/wiki/${id}`),
      title,
    })),
    {
      detail: "Apps",
      id: "connectors",
      path: tenantPath(tenantId, "/apps"),
      title: "Connectors",
    },
    {
      detail: "Chats",
      id: "messages",
      path: tenantPath(tenantId, "/rooms"),
      title: "Messages",
    },
  ];
  return places;
}

export function filterJumpPlaces(places: readonly JumpPlace[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...places];
  return places.filter((place) =>
    `${place.title} ${place.detail}`.toLocaleLowerCase().includes(needle),
  );
}
