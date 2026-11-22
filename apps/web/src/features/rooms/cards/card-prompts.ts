import { webSearchBackendName } from "@/features/web-search/web-search-backends";
import type { Translate } from "@/i18n/language";

import { cardPromptsMessages as m } from "./card-prompts.messages";
import { connectedAppDisplayName } from "./connected-app-names";
import type { DecisionMessageCard } from "./decision-card";

/**
 * The heading of a card TeamHub posted for an Agent, worded from its kind and
 * fields so it follows the interface language. A kind this client does not
 * word, or a card without the fields it needs, keeps the title TeamHub sent.
 * `app` is the app's name from the catalog, when the view has loaded it.
 */
export function decisionCardHeading(
  card: DecisionMessageCard,
  t: Translate,
  names: { readonly app?: string } = {},
): string {
  switch (card.kind) {
    case "profile_setup_apps":
      return t(m.profileSetupApps);
    case "profile_setup_sources":
      return t(m.profileSetupSources);
    case "connection_auth": {
      const view = card.connection_auth;
      if (!view?.app_key) break;
      const app = names.app ?? connectedAppDisplayName(view.app_key);
      return view.account
        ? t(m.connectionAuthAccount, { account: view.account, app })
        : t(m.connectionAuth, { app });
    }
    case "provider_key": {
      const appKey = card.provider_key?.app_key;
      return appKey
        ? t(m.providerKeyApp, {
            app: names.app ?? connectedAppDisplayName(appKey),
          })
        : t(m.providerKey);
    }
    case "search_key": {
      const view = card.search_key;
      if (!view) break;
      const backend = webSearchBackendName(view.backend);
      if (!backend) break;
      switch (view.reason) {
        case "missing":
          return t(m.searchKeyMissing, { backend });
        case "rejected":
          return t(m.searchKeyRejected, { backend });
        case "free_limit":
          return view.origin === "suggested"
            ? t(m.searchKeyFreeLimitSuggested, { backend })
            : t(m.searchKeyFreeLimit, { backend });
      }
      break;
    }
    case "browser_connection":
      return t(m.browserConnection);
    case "computer_permission":
      return t(m.computerPermission);
    case "room_creation":
      if (card.room_creation?.name)
        return t(m.roomCreation, { name: card.room_creation.name });
      break;
    case "agent_change":
      if (card.agent_change)
        return t(
          card.agent_change.action === "create" ? m.agentCreate : m.agentChange,
          { name: card.agent_change.agent_name },
        );
      break;
  }
  return card.title;
}
