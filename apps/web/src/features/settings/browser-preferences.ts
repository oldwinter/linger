import {
  clearAllRecentDocuments,
  hasRecentDocuments,
} from "@/features/library/recent-documents";
import {
  clearMeetingPlaybackSpeed,
  hasMeetingPlaybackSpeed,
} from "@/features/memory/meeting-playback-speed";
import {
  clearMeetingResume,
  hasMeetingResume,
} from "@/features/memory/meeting-resume";
import {
  clearDesktopNotificationPauses,
  hasDesktopNotificationPauses,
} from "@/features/rooms/desktop-notification-pause";
import { clearLastRooms, hasLastRoom } from "@/features/rooms/last-room";
import { clearRoomDrafts, hasRoomDrafts } from "@/features/rooms/room-drafts";
import {
  clearRoomMentionPreferences,
  hasRoomMentionPreferences,
} from "@/features/rooms/room-mention-snooze";
import { clearRoomSnoozes, hasRoomSnoozes } from "@/features/rooms/room-snooze";
import {
  clearRoomUnreadFilter,
  hasRoomUnreadFilter,
} from "@/features/rooms/room-unread-filter";
import {
  clearGlobalSearchHistory,
  hasGlobalSearchHistory,
} from "@/features/search/global-search-recent";
import {
  clearAllRecentWikiPages,
  hasRecentWikiPages,
} from "@/features/wiki/recent-wiki-pages";

export interface BrowserPreference {
  /** What Clear removes, in the section's own words. */
  label: string;
  /** The feature module that owns the store, relative to `src/`. */
  module: string;
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
    clear: clearLastRooms,
    hasAnything: hasLastRoom,
    label: "Last opened room",
    module: "features/rooms/last-room.ts",
  },
  {
    clear: clearRoomDrafts,
    hasAnything: hasRoomDrafts,
    label: "Composer drafts",
    module: "features/rooms/room-drafts.ts",
  },
  {
    clear: clearRoomMentionPreferences,
    hasAnything: hasRoomMentionPreferences,
    label: "Room mention snoozes and mutes",
    module: "features/rooms/room-mention-snooze.ts",
  },
  {
    clear: clearRoomSnoozes,
    hasAnything: hasRoomSnoozes,
    label: "Snoozed Rooms",
    module: "features/rooms/room-snooze.ts",
  },
  {
    clear: clearRoomUnreadFilter,
    hasAnything: hasRoomUnreadFilter,
    label: "Room list filter",
    module: "features/rooms/room-unread-filter.ts",
  },
  {
    clear: clearDesktopNotificationPauses,
    hasAnything: hasDesktopNotificationPauses,
    label: "Desktop notification pause",
    module: "features/rooms/desktop-notification-pause.ts",
  },
  {
    clear: clearGlobalSearchHistory,
    hasAnything: hasGlobalSearchHistory,
    label: "Recent searches",
    module: "features/search/global-search-recent.ts",
  },
  {
    clear: clearAllRecentDocuments,
    hasAnything: hasRecentDocuments,
    label: "Recently opened documents",
    module: "features/library/recent-documents.ts",
  },
  {
    clear: clearMeetingResume,
    hasAnything: hasMeetingResume,
    label: "Meeting listening positions",
    module: "features/memory/meeting-resume.ts",
  },
  {
    clear: clearMeetingPlaybackSpeed,
    hasAnything: hasMeetingPlaybackSpeed,
    label: "Meeting playback speed",
    module: "features/memory/meeting-playback-speed.ts",
  },
  {
    clear: clearAllRecentWikiPages,
    hasAnything: hasRecentWikiPages,
    label: "Recently opened Wiki pages",
    module: "features/wiki/recent-wiki-pages.ts",
  },
];
