import { translate, type Translate } from "@/i18n/language";

import { roomActionsMessages as m } from "./room-actions.messages";

export interface AwakeAgent {
  actorId: string;
  label: string;
  name: string;
  online: boolean;
  roomId?: string;
}

export function whoIsAwakePath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/awake`;
}

export function arrangeAwakeAgents(agents: readonly AwakeAgent[]) {
  return [...agents].sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function awakeSummary(
  agents: readonly AwakeAgent[],
  t: Translate = translate,
) {
  const online = agents.filter((agent) => agent.online).length;
  if (online === 0) return t(m.whoIsAwakeNone);
  return t(m.whoIsAwakeCount, { count: online });
}
