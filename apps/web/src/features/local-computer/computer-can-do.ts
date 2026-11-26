import { translate, type Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import type { ComputerPermissionAction } from "./computer-permissions-api";
import { computersMessages } from "./computers.messages";

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

const permissionNameMessages: Record<PermissionId, Message<string>> = {
  accessibility: computersMessages.permissionAccessibility,
  screen_recording: computersMessages.permissionScreenRecording,
};

const subjectNameMessages: Record<Subject, Message<string>> = {
  computer_use: computersMessages.subjectComputerUse,
  linger: computersMessages.subjectLinger,
};

const permissionStateMessages: Record<Entry["state"], Message<string>> = {
  denied: computersMessages.permissionDenied,
  granted: computersMessages.permissionGranted,
  not_determined: computersMessages.permissionNotDetermined,
  unknown: computersMessages.permissionUnknown,
};

export function computerPermissionName(
  permission: PermissionId,
  t: Translate = translate,
) {
  return t(permissionNameMessages[permission]);
}

export function computerSubjectName(
  subject: Subject,
  t: Translate = translate,
) {
  return t(subjectNameMessages[subject]);
}

export function computerPermissionStateLabel(
  state: Entry["state"],
  t: Translate = translate,
) {
  return t(permissionStateMessages[state]);
}

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
  t: Translate = translate,
) {
  const permission = action.permission
    ? computerPermissionName(action.permission, t)
    : t(computersMessages.permissionFallbackGrant);
  if (action.action === "relaunch") {
    return t(computersMessages.actionRelaunchPermission, { permission });
  }
  if (action.action === "prompt") {
    return t(computersMessages.actionPromptPermission, { permission });
  }
  return t(computersMessages.actionOpenSettingsPermission, { permission });
}
