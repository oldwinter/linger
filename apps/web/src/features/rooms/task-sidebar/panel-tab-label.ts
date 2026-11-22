import { type Translate, translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { roomSurfaceMessages } from "../room-surface.messages";
import {
  isPanelCollectionTab,
  type PanelTab,
  type PanelTabKind,
} from "./panel-tab-types";
import { sidePanelMessages as m } from "./side-panel.messages";

/** Collection tabs are named after their kind, so the name follows the language. */
const collectionTitles: Partial<Record<PanelTabKind, Message>> = {
  file: m.filesTab,
  roomSettings: roomSurfaceMessages.roomSettings,
  roomInfo: m.roomInfo,
  collaboration: m.collaboration,
};

// Tabs saved by earlier versions carry the English wording in their title.
const savedAgentPrefix = /^Agent · /;
const savedActivityPrefix = /^Activity · /;
const savedUntitled = "Untitled";

/**
 * Words a saved tab for the screen. A tab is saved with a name only (an
 * Agent, a Document, a page, the start of a Message), never with wording, so
 * a saved tab reads in the language on screen.
 *
 * `label` is the full name of the tab; `name` is the short text beside its
 * icon, which already tells an Agent tab from an Activity tab.
 */
export function panelTabText(
  tab: PanelTab,
  t: Translate = translate,
): { label: string; name: string } {
  if (tab.kind === "agentInfo" || tab.kind === "agentActivity") {
    const agent = tab.kind === "agentInfo";
    const name =
      tab.title.replace(agent ? savedAgentPrefix : savedActivityPrefix, "") ||
      t(m.agentFallbackName);
    return { label: t(agent ? m.agentTab : m.activityTab, { name }), name };
  }
  const collection = isPanelCollectionTab(tab)
    ? collectionTitles[tab.kind]
    : undefined;
  const label = collection
    ? t(collection)
    : !tab.title || (tab.kind === "thread" && tab.title === savedUntitled)
      ? t(m.untitledTab)
      : tab.title;
  return { label, name: label };
}
