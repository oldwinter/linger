import type { QueryClient } from "@tanstack/react-query";

import { clearAllRecentDocuments } from "@/features/library/recent-documents-storage";
import { clearLastModelsComputer } from "@/features/local-models/last-models-computer";
import { resetMeetingPlaybackSession } from "@/features/memory/meeting-carry";
import { clearAllDismissedBackgroundFailures } from "@/features/rooms/chat/another-me-background-failure-dismissal";
import { clearRoomDrafts } from "@/features/rooms/room-drafts";
import { clearTeamHubQueries } from "@/features/rooms/room-queries";
import { clearGlobalSearchHistory } from "@/features/search/global-search-recent-storage";
import { clearAllRecentWikiPages } from "@/features/wiki/recent-wiki-pages-storage";
import { clearAllWikiDisplayState } from "@/features/wiki/wiki-display-storage";
import { clearAccountPreferenceKeys } from "@/lib/local-preference-keys";

export function clearLocalAuthenticatedStorage() {
  resetMeetingPlaybackSession();
  clearAccountPreferenceKeys();
  clearRoomDrafts();
  clearGlobalSearchHistory();
  clearLastModelsComputer();
  clearAllRecentDocuments();
  clearAllRecentWikiPages();
  clearAllWikiDisplayState();
  clearAllDismissedBackgroundFailures();
}

export function clearLocalAuthenticatedState(queryClient: QueryClient) {
  clearTeamHubQueries(queryClient);
  queryClient.clear();
  clearLocalAuthenticatedStorage();
}
