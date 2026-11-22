import { teamHubCatalogText } from "@/features/teamhub/teamhub-catalog-text";
import type { TeamHubWebSearchBackend } from "@/features/teamhub/teamhub-types";
import type { Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { webSearchBackendTextMessages as m } from "./web-search-backend-text.messages";

type BackendId = TeamHubWebSearchBackend["id"];

const descriptions: Partial<Record<BackendId, Message<string>>> = {
  tavily: m.descriptionTavily,
  brave: m.descriptionBrave,
  firecrawl: m.descriptionFirecrawl,
  exa: m.descriptionExa,
  you: m.descriptionYou,
  duckduckgo: m.descriptionDuckDuckGo,
  direct: m.descriptionDirect,
};

const freeTiers: Partial<Record<BackendId, Message<string>>> = {
  tavily: m.freeTierTavily,
  brave: m.freeTierBrave,
  firecrawl: m.freeTierFirecrawl,
  exa: m.freeTierExa,
  you: m.freeTierYou,
};

const freeUses: Partial<Record<BackendId, Message<string>>> = {
  you: m.freeUseYou,
  duckduckgo: m.freeUseDuckDuckGo,
};

function worded(
  table: Partial<Record<BackendId, Message<string>>>,
  id: string,
  sent: string | undefined,
  t: Translate,
) {
  // Only text TeamHub sent is worded, so a backend without it shows none.
  if (!sent) return sent;
  const message = Object.hasOwn(table, id) ? table[id as BackendId] : undefined;
  return teamHubCatalogText(sent, message, t);
}

type Backend = Pick<
  TeamHubWebSearchBackend,
  "description" | "free_tier" | "id" | "tier_text"
>;

/** The provider's one-line description; an unknown backend keeps TeamHub's. */
export function webSearchBackendDescription(backend: Backend, t: Translate) {
  return worded(descriptions, backend.id, backend.description, t) ?? "";
}

/** What a key's free plan gives, when TeamHub says. */
export function webSearchBackendFreeTier(backend: Backend, t: Translate) {
  return worded(freeTiers, backend.id, backend.free_tier, t);
}

/** What the keyless free use allows, when TeamHub says. */
export function webSearchBackendFreeUse(backend: Backend, t: Translate) {
  return worded(freeUses, backend.id, backend.tier_text, t);
}
