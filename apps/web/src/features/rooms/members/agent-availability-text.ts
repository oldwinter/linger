import type { TeamHubTenantAgentAvailabilitySnapshot } from "@/features/teamhub/teamhub-types";
import type { Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { agentAvailabilityMessages } from "./agent-availability.messages";
import { agentInfoMessages } from "./agent-info.messages";

type Availability = TeamHubTenantAgentAvailabilitySnapshot["availability"];
type AvailabilityReason = NonNullable<Availability["reason"]>;

// TeamHub words the same states in English in `label` and the summary.
const labels: Record<AvailabilityReason, Message<string>> = {
  online: agentInfoMessages.online,
  status_unavailable: agentAvailabilityMessages.statusUnavailable,
  reconnecting: agentAvailabilityMessages.reconnecting,
  authentication_required: agentAvailabilityMessages.offline,
  waiting_for_computer: agentAvailabilityMessages.offline,
  runtime_not_installed: agentAvailabilityMessages.needsAttention,
  runtime_incompatible: agentAvailabilityMessages.needsAttention,
  runtime_error: agentAvailabilityMessages.needsAttention,
};

// `runtime_error` keeps the Runtime's own diagnostic, as TeamHub sent it.
const summaries: Partial<Record<AvailabilityReason, Message<string>>> = {
  authentication_required: agentAvailabilityMessages.authenticationRequired,
  waiting_for_computer: agentAvailabilityMessages.waitingForComputer,
  runtime_not_installed: agentAvailabilityMessages.runtimeNotInstalled,
  runtime_incompatible: agentAvailabilityMessages.runtimeIncompatible,
};

function knownReason(reason: string | undefined) {
  return reason !== undefined && Object.hasOwn(labels, reason)
    ? (reason as AvailabilityReason)
    : undefined;
}

/**
 * The status label. A reason this client does not know, or a TeamHub that
 * sends none, falls back to the English label TeamHub sent.
 */
export function availabilityLabel(
  availability: Pick<Availability, "label" | "reason" | "status">,
  t: Translate,
): string {
  const reason = knownReason(availability.reason);
  if (reason) return t(labels[reason]);
  return availability.status === "online"
    ? t(agentInfoMessages.online)
    : availability.label;
}

/** Why the Agent has its status, falling back to TeamHub's English summary. */
export function availabilitySummary(
  availability: Pick<Availability, "current_activity" | "reason">,
  t: Translate,
): string | undefined {
  const reason = knownReason(availability.reason);
  const message = reason ? summaries[reason] : undefined;
  return message ? t(message) : availability.current_activity?.summary;
}
