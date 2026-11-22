import {
  Compass01Icon,
  File01Icon,
  HashtagIcon,
  Message01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import type { IconSvgElement } from "@/components/ui/icon";
import {
  buildCoreProductPlaces,
  buildMeetingJumpPlaces,
  type JumpPlace,
} from "@/features/jump/jump-places";
import {
  documentFileName,
  documentRepresentationFormat,
} from "@/features/library/document-display-name";
import { documentFormatLabel } from "@/features/library/document-format-label";
import { documentSourceLabels } from "@/features/library/document-source-label";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import { roomChatPath } from "@/features/rooms/room-routes";
import { spokenRoomFace } from "@/features/rooms/members/room-spoken-face";
import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type {
  TeamHubDocument,
  TeamHubMemoryEntry,
  TeamHubMessageSearchHit,
  TeamHubRoomListItem,
  TeamHubTenantAgent,
} from "@/features/teamhub/teamhub-types";
import { type Translate, translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { searchMessages as m } from "./global-search.messages";
import type { SearchTarget, SearchTargetActor } from "./global-search-recent";

/** "people" is the Members scope: the Agents a Human can open a Direct Room with. */
export type GlobalSearchTab =
  | "all"
  | "docs"
  | "messages"
  | "people"
  | "places"
  | "rooms";

export type GroupTab = Exclude<GlobalSearchTab, "all">;

/** Results read content first, then the navigational lists. */
export const GROUP_ORDER: readonly GroupTab[] = [
  "messages",
  "docs",
  "people",
  "rooms",
  "places",
];

export type ScopeText = Message<string> | string;

/** Words a scope text that may be either a catalog message or a literal string. */
export function scopeText(text: ScopeText, t: Translate = translate) {
  return typeof text === "string" ? text : t(text);
}

/** Each scope's texts are messages (or literals for fork-only scopes), worded when they are shown. */
export const SCOPES = {
  messages: {
    hint: m.messagesHint,
    icon: Message01Icon,
    label: m.messagesLabel,
    placeholder: m.messagesPlaceholder,
  },
  people: {
    hint: m.membersHint,
    icon: UserGroupIcon,
    label: m.membersLabel,
    placeholder: m.membersPlaceholder,
  },
  docs: {
    hint: m.docsHint,
    icon: File01Icon,
    label: m.docsLabel,
    placeholder: m.docsPlaceholder,
  },
  rooms: {
    hint: m.roomsHint,
    icon: HashtagIcon,
    label: m.roomsLabel,
    placeholder: m.roomsPlaceholder,
  },
  places: {
    hint: "Pages and settings",
    icon: Compass01Icon,
    label: "Places",
    placeholder: "Search places",
  },
} satisfies Record<
  GroupTab,
  {
    hint: ScopeText;
    icon: IconSvgElement;
    label: ScopeText;
    placeholder: ScopeText;
  }
>;

export const SCOPE_ORDER: readonly GroupTab[] = [
  "messages",
  "people",
  "docs",
  "rooms",
];

/** Keyword queries below this length only filter the cached lists. */
export const MIN_BACKEND_QUERY_LENGTH = 2;
/** Each group shows this many hits until the person scopes into it. */
export const ALL_TAB_GROUP_LIMIT = 3;
export const BACKEND_PAGE_LIMIT = 20;
/** How long the pointer rests on a row before it becomes the active row. */
export const HOVER_SETTLE_MS = 80;
export const SCROLL_SETTLE_MS = 160;
/** A query joins Recent searches once it has shown results for this long. */
export const QUERY_RECORD_DELAY_MS = 800;
/** Longest keyword forwarded to the Room for highlighting. */
export const HIGHLIGHT_MAX_LENGTH = 200;
/** A message row shows a preview, not the whole Message. */
const MESSAGE_PREVIEW_LENGTH = 300;

export type SearchResult =
  | { id: string; kind: "agent"; agent: TeamHubTenantAgent }
  | { id: string; kind: "document"; document: TeamHubDocument }
  | { id: string; kind: "message"; hit: TeamHubMessageSearchHit }
  | { id: string; kind: "place"; place: JumpPlace }
  | { id: string; kind: "room"; room: TeamHubRoomListItem }
  | { id: string; kind: "query"; text: string }
  | { id: string; kind: "scope"; tab: GroupTab };

/** Navigable product pages, Settings sections, and already-loaded meetings. */
export function buildSearchPlaces(
  tenantId: string,
  meetings: readonly TeamHubMemoryEntry[] = [],
): JumpPlace[] {
  const encodedTenant = encodeURIComponent(tenantId);
  const settingsSections: JumpPlace[] = [
    {
      detail: "Settings",
      id: "profile",
      keywords: ["account"],
      path: `/t/${encodedTenant}/settings/account`,
      title: "Profile",
    },
    {
      detail: "Settings",
      id: "security",
      keywords: ["password", "sessions"],
      path: `/t/${encodedTenant}/settings/security`,
      title: "Security",
    },
    {
      detail: "Settings",
      id: "my-rules",
      path: `/t/${encodedTenant}/settings/my-rules`,
      title: "My Rules",
    },
    {
      detail: "Settings",
      id: "shortcuts",
      keywords: ["keyboard", "keys"],
      path: `/t/${encodedTenant}/settings/shortcuts`,
      title: "Shortcuts",
    },
  ];
  const corePlaces = buildCoreProductPlaces(tenantId);
  const settingsIndex = corePlaces.findIndex(
    (place) => place.id === "settings",
  );
  const orderedProductPlaces =
    settingsIndex >= 0
      ? [
          ...corePlaces.slice(0, settingsIndex + 1),
          ...settingsSections,
          ...corePlaces.slice(settingsIndex + 1),
        ]
      : [...corePlaces, ...settingsSections];
  return [
    ...orderedProductPlaces,
    ...buildMeetingJumpPlaces(meetings, tenantId),
  ];
}

type TargetResult = Exclude<SearchResult, { kind: "query" | "scope" }>;

export interface ResultGroup {
  hasMore: boolean;
  items: SearchResult[];
  tab: GroupTab;
}

export interface ResultSection {
  action?: { ariaLabel: string; label: string; onSelect: () => void };
  items: SearchResult[];
  key: string;
  label: string;
  /** Scope cards for the empty field, rows for everything else. */
  layout: "rows" | "scopes";
  /** A backend group still on its way: drawn as skeleton rows. */
  loading?: boolean;
  seeAll?: GroupTab;
}

export interface TargetContext {
  /** Direct Room id by peer Actor id: an Agent's row opens that conversation. */
  directRoomIdByPeer: Map<string, string>;
  roomNames: Map<string, string>;
  tenantId: string;
}

/** The scope a row narrows to with Tab: its own group, or the card's scope. */
export function rowScope(row: SearchResult | undefined): GroupTab | undefined {
  switch (row?.kind) {
    case "scope":
      return row.tab;
    case "message":
      return "messages";
    case "document":
      return "docs";
    case "agent":
      return "people";
    case "place":
      return "places";
    case "room":
      return "rooms";
    default:
      return undefined;
  }
}

export function emptyDetail(
  tab: GlobalSearchTab,
  query: string,
  t: Translate = translate,
) {
  if (query === "") {
    return tab === "messages" ? t(m.emptyMessageHint) : t(m.emptyDocHint);
  }
  if (
    query.length < MIN_BACKEND_QUERY_LENGTH &&
    tab !== "people" &&
    tab !== "places" &&
    tab !== "rooms"
  ) {
    return t(m.emptyTooShort, { min: MIN_BACKEND_QUERY_LENGTH });
  }
  return tab === "all"
    ? t(m.emptyCheckSpelling)
    : t(m.emptyNothingIn, { scope: scopeText(SCOPES[tab].label, t) });
}

export function byName<T>(read: (value: T) => string) {
  return (left: T, right: T) => read(left).localeCompare(read(right));
}

/** 0 when the display name itself contains the query, 1 for a secondary-field match. */
export function matchRank(query: string, name: string) {
  return query && name.toLocaleLowerCase().includes(query) ? 0 : 1;
}

function messageRoomLabel(
  room: TeamHubMessageSearchHit["room"],
  roomNames: Map<string, string>,
) {
  if (room.kind === "thread") {
    const parentName = room.parent_room_id
      ? roomNames.get(room.parent_room_id)
      : undefined;
    return translate(m.threadIn, { name: parentName ?? room.name });
  }
  if (room.kind === "direct") return room.name;
  return `#${room.name}`;
}

function documentLocationLabel(document: TeamHubDocument) {
  if (document.from.length === 0) return translate(m.library);
  return documentSourceLabels(
    document.from,
    translate,
    (binding) => `${binding.binding_kind}:${binding.context_id}`,
  ).join(", ");
}

function threadPath(
  tenantId: string,
  parentRoomId: string,
  rootMessageId: string,
) {
  return `${roomChatPath(tenantId, parentRoomId)}?thread=${encodeURIComponent(rootMessageId)}`;
}

function actorTarget(actor: {
  display_name: string;
  id: string;
  kind: "agent" | "human";
}): SearchTargetActor {
  return { id: actor.id, kind: actor.kind, name: actor.display_name };
}

/** How a spoken request can name a result: its name, file name, or a message's room and text. */
export function voiceResultName(target: SearchTarget) {
  if (target.kind === "message") return `${target.roomLabel}: ${target.text}`;
  if (target.kind === "document") return target.fileName;
  return target.name;
}

/** The render and navigation form of a live hit. */
export function resultTarget(
  result: TargetResult,
  { directRoomIdByPeer, roomNames, tenantId }: TargetContext,
): SearchTarget {
  switch (result.kind) {
    case "message": {
      const { message, room } = result.hit;
      return {
        author: actorTarget(message.author),
        createdAt: message.created_at,
        id: message.id,
        kind: "message",
        path:
          room.kind === "thread" && room.parent_room_id && room.root_message_id
            ? threadPath(tenantId, room.parent_room_id, room.root_message_id)
            : `${roomChatPath(tenantId, room.id)}?message=${encodeURIComponent(message.id)}`,
        roomLabel: messageRoomLabel(room, roomNames),
        text: markdownPlainText(message.raw_message).slice(
          0,
          MESSAGE_PREVIEW_LENGTH,
        ),
      };
    }
    case "document": {
      const { document } = result;
      return {
        fileName: documentFileName(document),
        formatLabel: documentFormatLabel(
          documentRepresentationFormat(document),
        ),
        id: document.id,
        kind: "document",
        location: documentLocationLabel(document),
        ownerName: document.owner.display_name,
        path: documentDetailPath({ documentId: document.id, tenantId }),
        updatedAt: document.updated_at,
      };
    }
    case "agent": {
      const { agent } = result;
      const directRoomId = directRoomIdByPeer.get(agent.actor.id);
      return {
        agentType: agent.agent_type,
        description: agent.description,
        id: agent.actor.id,
        kind: "agent",
        name: agent.actor.display_name,
        ...(directRoomId ? { path: roomChatPath(tenantId, directRoomId) } : {}),
        ...(agent.avatar_key ? { avatarKey: agent.avatar_key } : {}),
      };
    }
    case "place":
      return {
        detail: result.place.detail,
        id: result.place.id,
        kind: "place",
        name: result.place.title,
        path: result.place.path,
      };
    case "room": {
      const { room } = result;
      const isThread =
        room.kind === "thread" && room.parent_room_id && room.root_message_id;
      const parentName = room.parent_room_id
        ? roomNames.get(room.parent_room_id)
        : undefined;
      return {
        id: room.id,
        kind: "room",
        name: room.name,
        path: isThread
          ? threadPath(tenantId, room.parent_room_id!, room.root_message_id!)
          : roomChatPath(tenantId, room.id),
        roomKind: room.kind === "thread" ? "thread" : "room",
        ...(room.description ? { description: room.description } : {}),
        ...(parentName ? { parentName } : {}),
        ...(room.member_preview?.length
          ? {
              members: spokenRoomFace(
                room.member_preview,
                room.latest_message?.author,
              ).map(actorTarget),
            }
          : {}),
      };
    }
  }
}
