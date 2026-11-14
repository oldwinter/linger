import {
  clearAllRecentDocuments,
  hasRecentDocuments,
} from "@/features/library/recent-documents";
import { clearRoomDrafts, hasRoomDrafts } from "@/features/rooms/room-drafts";
import {
  clearRoomMentionPreferences,
  hasRoomMentionPreferences,
} from "@/features/rooms/room-mention-snooze";
import {
  clearRoomUnreadFilter,
  hasRoomUnreadFilter,
} from "@/features/rooms/room-unread-filter";
import {
  clearGlobalSearchHistory,
  hasGlobalSearchHistory,
} from "@/features/search/global-search-recent";

export interface BrowserPreference {
  /** What Clear removes, in the section's own words. */
  label: string;
  hasAnything: () => boolean;
  clear: () => void;
}

/**
 * Every preference this app stores only in this browser. Session, token, and
 * identity keys stay out, so this list can never sign anyone out or change
 * what TeamHub holds.
 */
export const browserPreferences: readonly BrowserPreference[] = [
  {
    clear: clearRoomDrafts,
    hasAnything: hasRoomDrafts,
    label: "Composer drafts",
  },
  {
    clear: clearRoomMentionPreferences,
    hasAnything: hasRoomMentionPreferences,
    label: "Room mention snoozes and mutes",
  },
  {
    clear: clearRoomUnreadFilter,
    hasAnything: hasRoomUnreadFilter,
    label: "Unread-only Room list",
  },
  {
    clear: clearGlobalSearchHistory,
    hasAnything: hasGlobalSearchHistory,
    label: "Recent searches",
  },
  {
    clear: clearAllRecentDocuments,
    hasAnything: hasRecentDocuments,
    label: "Recently opened documents",
  },
];
