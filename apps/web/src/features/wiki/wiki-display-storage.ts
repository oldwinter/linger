import { removePreferenceKeys } from "@/lib/local-preference-keys";

export const WIKI_DISPLAY_PREFIX = "linger:wiki-display:v1:";

export function clearAllWikiDisplayState(): void {
  removePreferenceKeys([WIKI_DISPLAY_PREFIX]);
}
