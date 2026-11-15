import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  myRulesQueryKey,
  myRulesQueryOptions,
  runMyRulesCommand,
} from "./my-rules-queries";
import {
  newestShadowDivergence,
  reviewResultCopy,
  shadowDivergenceLine,
  shadowRuleIds,
} from "./shadow-rule-review";
import { SettingsPageHeading } from "./settings-page-heading";

/**
 * Walks newly learned shadow rules one at a time. Promote makes the rule
 * active. Leave keeps it in shadow and moves on; coming back starts from
 * whatever is still waiting.
 */
export function ShadowRuleReviewPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const queryClient = useQueryClient();
  const rules = useQuery(myRulesQueryOptions(client, tenantId));
  const command = useMutation({
    mutationFn: (ruleId: string) =>
      runMyRulesCommand(client, tenantId, { kind: "promote", ruleId }),
    onSuccess: (book) =>
      queryClient.setQueryData(myRulesQueryKey(tenantId), book),
  });
  const [visit, setVisit] = useState<string[] | undefined>();
  const [index, setIndex] = useState(0);
  const [promoted, setPromoted] = useState<string[]>([]);
  const started = useRef(false);
  const rulesPath = `/t/${encodeURIComponent(tenantId)}/settings/my-rules`;

  useEffect(() => {
    if (started.current || !rules.data) return;
    started.current = true;
    setVisit(shadowRuleIds(rules.data));
  }, [rules.data]);

  async function promote(ruleId: string) {
    try {
      await command.mutateAsync(ruleId);
    } catch {
      // Stay on this rule so the person can try the promotion again.
      return;
    }
    setPromoted((ids) => [...ids, ruleId]);
    setIndex((current) => current + 1);
  }

  const currentId = visit?.[index];
  const current = rules.data?.rules.find((rule) => rule.id === currentId);
  const finished = visit !== undefined && (visit.length === 0 || !currentId);
  const divergence =
    rules.data && currentId
      ? newestShadowDivergence(rules.data, currentId)
      : undefined;
  const difference = divergence
    ? shadowDivergenceLine(divergence)
    : "Another Me has not differed from you on this rule yet.";

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description="A newly learned rule waits in shadow until you promote it. Only then does it decide what Another Me does."
        title={
          finished && visit && visit.length > 0
            ? "Review finished"
            : "Review new rules"
        }
      />
      <Link
        className="text-sm text-muted-foreground hover:text-foreground"
        to={rulesPath}
      >
        Back to My Rules
      </Link>
      {rules.isPending || (rules.data && visit === undefined) ? (
        <div aria-busy="true" aria-label="Loading rules" role="status">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : rules.isError || !rules.data || !visit ? (
        <p className="text-sm text-destructive" role="alert">
          Rules could not be loaded.
        </p>
      ) : finished ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl text-foreground">
            {visit.length === 0
              ? "No new rules to review."
              : reviewResultCopy(
                  promoted.length,
                  visit.length - promoted.length,
                )}
          </h2>
          {promoted.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-foreground">
              {promoted.map((ruleId) => (
                <li key={ruleId}>
                  {rules.data.rules.find((rule) => rule.id === ruleId)?.text ??
                    ruleId}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <section
          aria-label={current?.text ?? "Rule"}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted-foreground">
            {index + 1} of {visit.length}
          </p>
          <h2 className="text-xl text-foreground">{current?.text}</h2>
          <p className="text-sm text-muted-foreground">{difference}</p>
          <div className="flex items-center gap-3">
            <Button
              disabled={command.isPending || !current}
              onClick={() => {
                if (currentId) void promote(currentId);
              }}
              size="compact"
              tone="primary"
            >
              Promote
            </Button>
            <Button
              disabled={command.isPending}
              onClick={() => setIndex((value) => value + 1)}
              size="compact"
              tone="ghost"
            >
              Leave in shadow
            </Button>
          </div>
          {command.isError ? (
            <p className="text-sm text-destructive" role="alert">
              The change was not saved. Try again.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
