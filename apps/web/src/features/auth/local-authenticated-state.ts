import type { QueryClient } from "@tanstack/react-query";

import { clearAllRecentDocuments } from "@/features/library/recent-documents";
import { clearLastModelsComputer } from "@/features/local-models/last-models-computer";
import { resetMeetingPlaybackSession } from "@/features/memory/meeting-carry";
import { clearRoomDrafts } from "@/features/rooms/room-drafts";
import { clearTeamHubQueries } from "@/features/rooms/room-queries";
import { clearGlobalSearchHistory } from "@/features/search/global-search-recent";
import { clearAllRecentWikiPages } from "@/features/wiki/recent-wiki-pages";
import { clearAllWikiDisplayState } from "@/features/wiki/wiki-display-state";

export function clearLocalAuthenticatedState(queryClient: QueryClient) {
  resetMeetingPlaybackSession();
  clearTeamHubQueries(queryClient);
  clearRoomDrafts();
  clearGlobalSearchHistory();
  clearLastModelsComputer();
  clearAllRecentDocuments();
  clearAllRecentWikiPages();
  clearAllWikiDisplayState();
}
