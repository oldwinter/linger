export function agentCanDoPath(tenantId: string, agentId: string) {
  return `/t/${encodeURIComponent(tenantId)}/agents/${encodeURIComponent(agentId)}/can-do`;
}

export function skillBindingsKey(tenantId: string, agentId: string) {
  return ["teamhub", "agent-skills", tenantId, agentId] as const;
}
