import {
  notifyPreferenceChange,
  removePreferenceKeys,
} from "@/lib/local-preference-keys";

export const GLOBAL_SEARCH_RECENT_PREFIX = "global-search-recent.v2:";
export const SEARCH_HISTORY_CHANGED = "global-search-history-changed";

export function clearGlobalSearchHistory(): void {
  removePreferenceKeys([GLOBAL_SEARCH_RECENT_PREFIX]);
  notifyPreferenceChange(SEARCH_HISTORY_CHANGED);
}
