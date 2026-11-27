import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubTaskSubscription,
  TeamHubTaskSubscriptionSourceType,
  TeamHubWorkItem,
} from "@/features/teamhub/teamhub-types";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import { workItemsViewMessages as vm } from "./work-items-view.messages";

const sourceLabel: Record<
  TeamHubTaskSubscriptionSourceType,
  Message<string>
> = {
  github: vm.subscriptionSourceGitHub,
  herdr: vm.subscriptionSourceHerdr,
  mail: vm.subscriptionSourceMail,
};

export function workItemSubscriptionsQueryKey(
  tenantId: string,
  workItemId: string,
) {
  return ["teamhub", tenantId, "work-item-subscriptions", workItemId] as const;
}

export interface WorkItemSubscriptionsSectionProps {
  kind: TeamHubWorkItem["kind"];
  tenantId: string;
  workItemId: string;
}

/**
 * Displays external thread subscriptions attached to a delegated Task and lets
 * the Human owner unsubscribe directly from the Work Item detail drawer.
 */
export function WorkItemSubscriptionsSection({
  kind,
  tenantId,
  workItemId,
}: WorkItemSubscriptionsSectionProps) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [dropError, setDropError] = useState<string | null>(null);
  const queryKey = workItemSubscriptionsQueryKey(tenantId, workItemId);

  const subscriptionsQuery = useQuery({
    enabled: kind === "task",
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/work-items/{workItemId}/subscriptions", {
          params: { path: { workItemId } },
        }),
      ),
    queryKey,
  });

  const dropMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      teamHubData(
        client.api.POST(
          "/v0/work-items/{workItemId}/subscriptions/{subscriptionId}/drop",
          {
            body: {},
            params: { path: { subscriptionId, workItemId } },
          },
        ),
      ),
    onError: () => {
      setDropError(t(vm.unsubscribeFailed));
    },
    onMutate: () => {
      setDropError(null);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<{ items: TeamHubTaskSubscription[] }>(
        queryKey,
        (current) => {
          if (!current) return { items: [updated] };
          return {
            items: current.items.map((entry) =>
              entry.id === updated.id ? updated : entry,
            ),
          };
        },
      );
    },
  });

  if (kind !== "task") return null;

  if (subscriptionsQuery.isError) {
    return (
      <section aria-label={t(vm.subscriptionsTitle)} className="pt-4">
        <p className="text-xs text-destructive" role="alert">
          {t(vm.subscriptionsLoadFailed)}
        </p>
      </section>
    );
  }

  const items = subscriptionsQuery.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="work-item-subscriptions-heading"
      className="space-y-2 border-t border-app-border pt-4"
    >
      <h3
        className="text-xs font-medium text-muted-foreground"
        id="work-item-subscriptions-heading"
      >
        {t(vm.subscriptionsTitle)}
      </h3>
      {dropError ? (
        <p className="text-xs text-destructive" role="alert">
          {dropError}
        </p>
      ) : null}
      <ul className="space-y-2">
        {items.map((sub) => {
          const active = sub.status === "active";
          const dropping =
            dropMutation.isPending && dropMutation.variables === sub.id;
          return (
            <li
              className="flex items-start justify-between gap-2 rounded-lg border border-app-border bg-app-surface px-2.5 py-2 text-xs"
              key={sub.id}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {t(sourceLabel[sub.source_type])}
                  </span>
                  <span
                    className={
                      active
                        ? "text-[11px] font-medium text-foreground"
                        : "text-[11px] text-muted-foreground"
                    }
                  >
                    {active
                      ? t(vm.subscriptionStatusActive)
                      : sub.dropped_by_kind === "another_me"
                        ? t(vm.subscriptionStatusDroppedByAnotherMe)
                        : t(vm.subscriptionStatusDroppedByOwner)}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-app-subtle [overflow-wrap:anywhere]">
                  {sub.display_label || sub.normalized_source_key}
                </p>
              </div>
              {active ? (
                <Button
                  aria-label={`${t(vm.unsubscribe)} ${sub.display_label || sub.normalized_source_key}`}
                  disabled={dropping}
                  onClick={() => dropMutation.mutate(sub.id)}
                  size="compact"
                  tone="ghost"
                >
                  <Icon icon={Cancel01Icon} size={12} />
                  <span>
                    {dropping ? t(vm.unsubscribing) : t(vm.unsubscribe)}
                  </span>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
