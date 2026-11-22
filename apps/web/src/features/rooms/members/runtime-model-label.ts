import { getLanguage, SOURCE_LANGUAGE, type Translate } from "@/i18n/language";

import { runtimeModelMessages } from "./runtime-model.messages";

// TeamHub's stand-in ids and the short app names its labels use, from
// defaultLocalRuntimeModels: "Claude default", not "Claude Code default".
const hostDefaults: Readonly<Record<string, string>> = {
  "claude-default": "Claude",
  "codex-default": "Codex",
  "pi-default": "Pi",
  "antigravity-default": "Antigravity",
};

/**
 * A Runtime model's name. TeamHub's stand-in for "the app's own default
 * model" is worded here by its id for languages other than English; every
 * other model keeps the label its Runtime reported.
 */
export function runtimeModelLabel(
  model: { readonly id: string; readonly label: string },
  t: Translate,
): string {
  const app = Object.hasOwn(hostDefaults, model.id)
    ? hostDefaults[model.id]
    : undefined;
  // As with teamHubCatalogText, the copy is only a translation: English
  // keeps the label TeamHub sent.
  if (!app || getLanguage() === SOURCE_LANGUAGE) return model.label;
  return t(runtimeModelMessages.hostDefault, { app });
}
