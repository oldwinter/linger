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

export function awakeSummary(agents: readonly AwakeAgent[]) {
  const online = agents.filter((agent) => agent.online).length;
  if (online === 0) return "Everyone is quiet.";
  if (online === 1) return "1 is awake.";
  return `${online} are awake.`;
}
