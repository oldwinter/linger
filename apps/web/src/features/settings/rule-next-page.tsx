import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { myRulesMessages as m } from "./my-rules.messages";
import {
  myRulesQueryKey,
  myRulesQueryOptions,
  runMyRulesCommand,
} from "./my-rules-queries";
import { nextTimeChange, ruleFromBook } from "./rule-next";

/**
 * A shadow rule does not decide yet. Letting it decide makes the next
 * matching judgment follow it.
 */
export function RuleNextPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const t = useT();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const ruleId = requireRoomRouteParam(params.ruleId, "Rule");
  const rules = useQuery(myRulesQueryOptions(client, tenantId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const book = rules.data;
  const rule = book ? ruleFromBook(book, ruleId) : undefined;
  const changes = (book?.divergences ?? []).filter(
    (divergence) => divergence.rule_id === ruleId,
  );
  const rulesPath = `/t/${encodeURIComponent(tenantId)}/settings/my-rules`;

  const decide = async () => {
    if (!rule || rule.status !== "shadow" || pending) return;
    setPending(true);
    setError(null);
    try {
      const next = await runMyRulesCommand(client, tenantId, {
        kind: "promote",
        ruleId: rule.id,
      });
      queryClient.setQueryData(myRulesQueryKey(tenantId), next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t(m.ruleNextCouldNotDecide),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-6 pb-4">
      <header>
        <h1 className="text-2xl text-foreground">{t(m.ruleNextTitle)}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t(m.ruleNextSubtitle)}
        </p>
      </header>
      {rules.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.ruleNextLoading)}
        </p>
      ) : rules.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">
            {rules.error instanceof Error && rules.error.message
              ? rules.error.message
              : t(m.ruleNextLoadFailed)}
          </p>
          <Button
            disabled={rules.isFetching}
            onClick={() => void rules.refetch()}
            size="compact"
            tone="secondary"
            type="button"
          >
            {t(commonMessages.tryAgain)}
          </Button>
        </div>
      ) : !rule ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.ruleNextNotInBook)}
        </p>
      ) : (
        <>
          <h2 className="text-lg text-foreground">{rule.text}</h2>
          {rule.status === "active" ? (
            <p className="text-sm text-foreground" role="status">
              {t(m.ruleNextAlreadyDecides)}
            </p>
          ) : (
            <>
              {changes.length ? (
                <ul
                  aria-label={t(m.ruleNextListLabel)}
                  className="flex flex-col gap-3"
                >
                  {changes.map((divergence) => (
                    <li
                      className="rounded-2xl border border-border px-4 py-3 text-sm text-foreground"
                      key={divergence.id}
                    >
                      {nextTimeChange(divergence)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t(m.ruleNextEmpty)}
                </p>
              )}
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                disabled={pending}
                onClick={() => void decide()}
                type="button"
              >
                {t(pending ? m.ruleNextPending : m.ruleNextAction)}
              </Button>
            </>
          )}
        </>
      )}
      <Link
        className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        to={rulesPath}
      >
        {t(m.backToMyRules)}
      </Link>
    </div>
  );
}
