import type { Message } from "@/i18n/messages";

import type { PanelTabKind } from "./panel-tab-types";
import { routinesMessages } from "./routines.messages";
import { sidePanelMessages as m } from "./side-panel.messages";

const ALL_PANEL_CREATE_ITEMS = [
  {
    kind: "file",
    label: m.documents,
  },
  {
    kind: "agentInfo",
    label: m.agentInfo,
  },
  {
    kind: "roomInfo",
    label: m.roomInfo,
  },
  {
    kind: "routines",
    label: routinesMessages.routines,
  },
  {
    kind: "collaboration",
    label: m.collaboration,
  },
] as const satisfies { kind: PanelTabKind; label: Message<string> }[];

export type PanelCreateChoice = (typeof ALL_PANEL_CREATE_ITEMS)[number]["kind"];

/** Keep the general launcher focused on Documents; Agent info is DM-scoped. */
export const PANEL_HIDDEN_CREATE_KINDS = new Set<PanelCreateChoice>([
  "roomInfo",
]);

export function panelCreateItems(includeAgentInfo = false) {
  return ALL_PANEL_CREATE_ITEMS.filter((item) =>
    isPanelCreateChoiceEnabled(item.kind, includeAgentInfo),
  );
}

export function isPanelCreateChoiceEnabled(
  choice: PanelCreateChoice,
  includeAgentInfo = false,
) {
  return (
    !PANEL_HIDDEN_CREATE_KINDS.has(choice) &&
    (choice !== "agentInfo" || includeAgentInfo)
  );
}
