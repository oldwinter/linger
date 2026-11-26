import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { tenantAgentsQueryOptions } from "@/features/rooms/room-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { skillBindingsKey } from "./agent-can-do";
import { agentCanDoMessages as m } from "./agent-can-do.messages";

/** Turns one of an agent's skills on or off. The next time they work, that skill is or is not available. */
export function AgentCanDoPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const t = useT();
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
  const allSkills = agent?.skill_bindings ?? [];
  const names = new Map(allSkills.map((skill) => [skill.skill_id, skill.name]));
  const explicitIds = new Set(
    (bindings.data?.items ?? []).map((item) => item.skill.skill_id),
  );
  const defaultSkills = allSkills.filter(
    (skill) => skill.is_default && !explicitIds.has(skill.skill_id),
  );
  const toggle = useMutation({
    mutationFn: async (skillId: string) => {
      const current = bindings.data;
      const binding = current?.items.find(
        (item) => item.skill.skill_id === skillId,
      );
      if (!current || !binding) throw new Error(t(m.reloadFirst));
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
  const name = agent?.actor.display_name ?? t(m.defaultAgentName);
  const configurableItems = bindings.data?.items ?? [];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">{t(m.title, { name })}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t(m.subtitle)}</p>
        </header>
        {bindings.isPending || agents.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.loading)}
          </p>
        ) : bindings.isError || agents.isError ? (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm text-destructive">{t(m.loadFailed)}</p>
            <Button
              onClick={() => {
                if (bindings.isError) void bindings.refetch();
                if (agents.isError) void agents.refetch();
              }}
              size="compact"
              tone="secondary"
              type="button"
            >
              {t(commonMessages.tryAgain)}
            </Button>
          </div>
        ) : configurableItems.length === 0 && defaultSkills.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.noSkills)}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t(m.configurableHeading)}
              </h2>
              {configurableItems.length > 0 ? (
                <ul
                  aria-label={t(m.skillsList)}
                  className="flex flex-col gap-2"
                >
                  {configurableItems.map((binding) => {
                    const skillName =
                      names.get(binding.skill.skill_id) ??
                      binding.skill.skill_id;
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
                            {t(on ? m.on : m.off)}
                          </span>
                        </span>
                        <Button
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate(binding.skill.skill_id)}
                          type="button"
                        >
                          {t(on ? m.turnOff : m.turnOn, { name: skillName })}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground" role="status">
                  {t(m.noConfigurableSkills)}
                </p>
              )}
            </section>
            {defaultSkills.length > 0 ? (
              <section className="flex flex-col gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t(m.includedByDefaultHeading)}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(m.includedByDefaultSummary, {
                      count: defaultSkills.length,
                    })}
                  </p>
                </div>
                <ul
                  aria-label={t(m.includedByDefaultHeading)}
                  className="flex flex-col gap-2"
                >
                  {defaultSkills.map((skill) => (
                    <li
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-muted/30 px-4 py-2.5"
                      key={skill.skill_id}
                    >
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {skill.name}
                      </span>
                      <span className="shrink-0 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground">
                        {t(m.alwaysOn)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
        {toggle.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {t(m.changeFailed)}
          </p>
        ) : null}
        {toggle.isSuccess ? (
          <p className="text-sm text-foreground" role="status">
            {t(m.saved)}
          </p>
        ) : null}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/t/${encodeURIComponent(tenantId)}/rooms`}
        >
          {t(m.backToMessages)}
        </Link>
      </div>
    </main>
  );
}
