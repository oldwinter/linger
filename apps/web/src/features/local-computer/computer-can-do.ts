import type { ComputerPermissionAction } from "./computer-permissions-api";

type Subject = ComputerPermissionAction["subject"];
type PermissionId = NonNullable<ComputerPermissionAction["permission"]>;
interface Entry {
  id: PermissionId;
  prompt: "available" | "settings_only";
  relaunch_required: boolean;
  state: "granted" | "denied" | "not_determined" | "unknown";
}

export function computerCanDoPath(tenantId: string, computerId: string) {
  return `/t/${encodeURIComponent(tenantId)}/settings/computers/${encodeURIComponent(computerId)}/can-do`;
}

export const computerPermissionNames: Record<PermissionId, string> = {
  accessibility: "Accessibility",
  screen_recording: "Screen Recording",
};

export const computerSubjectNames: Record<Subject, string> = {
  computer_use: "Computer use",
  linger: "Linger",
};

export const computerPermissionStates: Record<Entry["state"], string> = {
  denied: "Not allowed",
  granted: "Granted",
  not_determined: "Not requested yet",
  unknown: "Unknown",
};

/** The one step that moves a permission forward. Granted permissions wait. */
export function nextComputerPermissionStep(
  subject: Subject,
  entry: Entry,
): ComputerPermissionAction | undefined {
  if (entry.state === "granted" && !entry.relaunch_required) return undefined;
  if (entry.relaunch_required) {
    return { action: "relaunch", permission: entry.id, subject };
  }
  if (entry.prompt === "available") {
    return { action: "prompt", permission: entry.id, subject };
  }
  return { action: "open_settings", permission: entry.id, subject };
}

export function computerPermissionActionLabel(
  action: ComputerPermissionAction,
) {
  const permission = action.permission
    ? computerPermissionNames[action.permission]
    : "the grant";
  if (action.action === "relaunch") return `Relaunch so ${permission} applies`;
  if (action.action === "prompt") return `Ask macOS for ${permission}`;
  return `Open Settings for ${permission}`;
}
