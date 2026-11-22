import type { TeamHubTenantAgentAvailabilitySnapshot } from "@/features/teamhub/teamhub-types";
import { type Translate, translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";

import { agentInfoMessages } from "./agent-info.messages";
import {
  availabilityLabel,
  availabilitySummary,
} from "./agent-availability-text";

type AgentAvailability = TeamHubTenantAgentAvailabilitySnapshot["availability"];

const dotClasses: Record<AgentAvailability["status"], string> = {
  online: "bg-[var(--app-status-success-text)]",
  error: "bg-[var(--app-status-danger-text)]",
  offline: "bg-app-subtle",
  unknown: "bg-[var(--app-status-warning-text)]",
};

function agentStatusDetail(
  availability: AgentAvailability,
  t: Translate = translate,
) {
  const activeTaskCount = availability.active_task_count ?? 0;
  return activeTaskCount > 0
    ? t(agentInfoMessages.tasksInProgress, { count: activeTaskCount })
    : availability.status !== "online"
      ? availabilitySummary(availability, t)
      : undefined;
}

/** The status as a dot alone, worn on the corner of an avatar. */
export function AgentStatusDot({
  availability,
  className = "",
}: {
  availability: AgentAvailability;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block size-2.5 rounded-full ring-2 ring-card ${dotClasses[availability.status]} ${className}`}
    />
  );
}

export function AgentStatus({
  availability,
  showDetails = false,
}: {
  availability: AgentAvailability;
  showDetails?: boolean;
}) {
  const t = useT();
  const status = availability.status;
  const label = availabilityLabel(availability, t);
  const detail = agentStatusDetail(availability, t);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${dotClasses[status]}`}
      />
      <span className="min-w-0 truncate">
        <span className="font-medium text-app-body">{label}</span>
        {showDetails && detail ? (
          <span className="text-app-subtle">
            {" · "}
            {detail}
          </span>
        ) : null}
      </span>
    </span>
  );
}
