import { getLanguage, SOURCE_LANGUAGE, type Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

/**
 * Catalog text TeamHub sends in English, such as a provider's free tier, in
 * the interface language. The client's copy is only a translation: in English
 * TeamHub's own text shows, so a change on the server shows at once, and the
 * copy is used for other languages only.
 */
export function teamHubCatalogText(
  sent: string,
  copy: Message<string> | undefined,
  t: Translate,
): string {
  return copy && getLanguage() !== SOURCE_LANGUAGE ? t(copy) : sent;
}
