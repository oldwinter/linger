import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";

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
        cause instanceof Error
          ? cause.message
          : "This rule could not start deciding.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">What this changes next</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A shadow rule only watches. Letting it decide means the next
            matching thing follows it.
          </p>
        </header>
        {rules.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading this rule.
          </p>
        ) : rules.isError || !rule ? (
          <p className="text-sm text-muted-foreground" role="status">
            This rule is not in your book.
          </p>
        ) : (
          <>
            <h2 className="text-lg text-foreground">{rule.text}</h2>
            {rule.status === "active" ? (
              <p className="text-sm text-foreground" role="status">
                This rule already decides.
              </p>
            ) : (
              <>
                {changes.length ? (
                  <ul
                    aria-label="What changes next"
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
                    Nothing has come up yet where this would have decided
                    differently. The next match follows this rule once it
                    decides.
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
                  {pending ? "Letting it decide" : "Let this rule decide"}
                </Button>
              </>
            )}
          </>
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={rulesPath}
        >
          Back to My Rules
        </Link>
      </div>
    </main>
  );
}
