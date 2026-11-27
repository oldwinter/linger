import {
  notifyPreferenceChange,
  removePreferenceKeys,
} from "@/lib/local-preference-keys";

export const RECENT_WIKI_PAGES_PREFIX = "wiki-recent-pages.v1:";
export const RECENT_WIKI_PAGES_CHANGED = "wiki-recent-pages-changed";

/** Clears the list for every Account in this browser. */
export function clearAllRecentWikiPages(): void {
  removePreferenceKeys([RECENT_WIKI_PAGES_PREFIX]);
  notifyPreferenceChange(RECENT_WIKI_PAGES_CHANGED);
}
