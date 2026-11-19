import { useMutation, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { tenantLocalModelsQueryKey } from "@/features/local-models/local-models-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { type TeamHubClient } from "@/features/teamhub/teamhub-client";
import type {
  TeamHubAgentReasoningEffort,
  TeamHubTenantAgent,
} from "@/features/teamhub/teamhub-types";
import type { AgentRuntimeUpdateInput } from "../members/edit-agent-runtime-dialog";
const EditAgentRuntimeDialog = lazy(async () => ({
  default: (await import("../members/edit-agent-runtime-dialog"))
    .EditAgentRuntimeDialog,
}));
import { useResolvedAgentModelLabel } from "../members/use-agent-model-selection";
import { tenantAgentsQueryKey } from "../room-queries";
import "./direct-agent-model-switch.css";

const EFFORT_LABEL: Record<TeamHubAgentReasoningEffort, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
  ultra: "Ultra",
};

interface Props {
  client: TeamHubClient;
  currentActorId?: string;
  registration: TeamHubTenantAgent;
  tenantId: string;
  busy?: boolean;
}

export function DirectAgentModelSwitch(props: Props) {
  const { currentActorId, registration } = props;
  if (!currentActorId || registration.created_by.id !== currentActorId)
    return null;
  return <RuntimeSettingsEntry {...props} />;
}

function RuntimeSettingsEntry({ client, registration, tenantId, busy }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const effort = registration.runtime.reasoning_effort;
  const label = useResolvedAgentModelLabel(
    client,
    tenantId,
    registration.runtime,
  );
  const update = useMutation({
    mutationFn: (input: AgentRuntimeUpdateInput) =>
      teamHubData(
        client.api.PATCH("/v0/tenants/{tenantId}/agents/{agentId}", {
          params: { path: { tenantId, agentId: registration.actor.id } },
          body: {
            ...input,
            expected_configuration_revision:
              registration.configuration_revision,
          },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        tenantAgentsQueryKey(tenantId),
        (current: { items: TeamHubTenantAgent[] } | undefined) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.actor.id === updated.actor.id
                    ? { ...item, ...updated }
                    : item,
                ),
              }
            : current,
      );
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: tenantAgentsQueryKey(tenantId),
        }),
        queryClient.invalidateQueries({
          queryKey: tenantLocalModelsQueryKey(tenantId),
        }),
      ]);
      setOpen(false);
    },
  });
  return (
    <div className="agent-model-switch">
      <button
        className="agent-model-switch-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          update.reset();
          setOpen(true);
        }}
      >
        <span className="agent-model-switch-trigger-label">{label}</span>
        {/* A long model label shortens with an ellipsis; the effort stays. */}
        {effort ? (
          <>
            {" "}
            <span className="agent-model-switch-trigger-effort">
              {EFFORT_LABEL[effort]}
            </span>
          </>
        ) : null}
      </button>
      {open ? (
        <Suspense
          fallback={
            <span role="status" className="text-xs text-app-muted">
              Loading settings…
            </span>
          }
        >
          <EditAgentRuntimeDialog
            client={client}
            registration={registration}
            tenantId={tenantId}
            busy={busy}
            isPending={update.isPending}
            error={update.error?.message}
            onClose={() => {
              if (!update.isPending) setOpen(false);
            }}
            onSave={(input) => update.mutate(input)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
