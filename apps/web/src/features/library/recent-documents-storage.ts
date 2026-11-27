import {
  notifyPreferenceChange,
  removePreferenceKeys,
} from "@/lib/local-preference-keys";

export const RECENT_DOCUMENTS_PREFIX = "library-recent-documents.v1:";
export const RECENT_DOCUMENTS_CHANGED = "library-recent-documents-changed";

/** Clears the list for every Account in this browser. */
export function clearAllRecentDocuments(): void {
  removePreferenceKeys([RECENT_DOCUMENTS_PREFIX]);
  notifyPreferenceChange(RECENT_DOCUMENTS_CHANGED);
}
