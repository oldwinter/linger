import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { tenantAgentsQueryOptions } from "@/features/rooms/room-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { skillBindingsKey } from "./agent-can-do";

/** Turns one of an agent's skills on or off. The next time they work, that skill is or is not available. */
export function AgentCanDoPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const agentId = requireRoomRouteParam(useParams().agentId, "Agent");
  const agents = useQuery(tenantAgentsQueryOptions(client, tenantId));
  const bindings = useQuery({
    queryKey: skillBindingsKey(tenantId, agentId),
    queryFn: () =>
      teamHubData(
        client.api.GET(
          "/v0/tenants/{tenantId}/agents/{agentId}/skill-bindings",
          { params: { path: { tenantId, agentId } } },
        ),
      ),
  });
  const agent = agents.data?.items.find((item) => item.actor.id === agentId);
  const names = new Map(
    (agent?.skill_bindings ?? []).map((skill) => [skill.skill_id, skill.name]),
  );
  const toggle = useMutation({
    mutationFn: async (skillId: string) => {
      const current = bindings.data;
      const binding = current?.items.find(
        (item) => item.skill.skill_id === skillId,
      );
      if (!current || !binding) throw new Error("Reload skills first.");
      return teamHubData(
        client.api.PUT(
          "/v0/tenants/{tenantId}/agents/{agentId}/skill-bindings/{skillId}",
          {
            params: { path: { tenantId, agentId, skillId } },
            body: {
              config: binding.config,
              enabled: !binding.enabled,
              expected_binding_version: current.binding_version,
              manifest_version: binding.skill.manifest_version,
            },
          },
        ),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: skillBindingsKey(tenantId, agentId),
      });
    },
  });
  const name = agent?.actor.display_name ?? "This agent";

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">{`What ${name} can do`}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Turn a skill off and it will not be used. Turn it on and it is
            available again.
          </p>
        </header>
        {bindings.isPending || agents.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading skills.
          </p>
        ) : bindings.isError || agents.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Skills could not be loaded.
          </p>
        ) : bindings.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            This agent has no skills to turn on or off.
          </p>
        ) : (
          <ul aria-label="Skills" className="flex flex-col gap-2">
            {bindings.data.items.map((binding) => {
              const skillName =
                names.get(binding.skill.skill_id) ?? binding.skill.skill_id;
              const on = binding.enabled;
              return (
                <li
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
                  key={binding.skill.skill_id}
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">
                      {skillName}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {on ? "On" : "Off"}
                    </span>
                  </span>
                  <Button
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(binding.skill.skill_id)}
                    type="button"
                  >
                    {on ? `Turn off ${skillName}` : `Turn on ${skillName}`}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {toggle.isError ? (
          <p className="text-sm text-destructive" role="alert">
            That skill did not change.
          </p>
        ) : null}
        {toggle.isSuccess ? (
          <p className="text-sm text-foreground" role="status">
            Saved. The next time this agent works, that is what they can do.
          </p>
        ) : null}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/t/${encodeURIComponent(tenantId)}/rooms`}
        >
          Back to messages
        </Link>
      </div>
    </main>
  );
}
