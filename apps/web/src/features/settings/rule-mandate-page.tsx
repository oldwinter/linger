import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubProactiveMandate } from "@/features/teamhub/teamhub-types";

import { mandateChoices } from "./rule-mandate";
import {
  myRulesQueryKey,
  myRulesQueryOptions,
  runMyRulesCommand,
} from "./my-rules-queries";
import { SettingsPageHeading } from "./settings-page-heading";

/** What an active rule lets Another Me do the next time it applies. */
export function RuleMandatePage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const ruleId = requireRoomRouteParam(useParams().ruleId, "Rule");
  const queryClient = useQueryClient();
  const rules = useQuery(myRulesQueryOptions(client, tenantId));
  const rule = rules.data?.rules.find((item) => item.id === ruleId);
  const [choice, setChoice] = useState<TeamHubProactiveMandate | undefined>();
  const [saved, setSaved] = useState(false);
  const selected = choice ?? rule?.mandate;
  const command = useMutation({
    mutationFn: (mandate: TeamHubProactiveMandate) =>
      runMyRulesCommand(client, tenantId, { kind: "mandate", ruleId, mandate }),
    onSuccess: (book) => {
      queryClient.setQueryData(myRulesQueryKey(tenantId), book);
      setSaved(true);
    },
  });
  const back = `/t/${encodeURIComponent(tenantId)}/settings/my-rules`;
  const acts =
    rules.data?.mandates.filter((item) => item.rule_id === ruleId) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description="This is what Another Me may do the next time the rule applies. Acts already taken stay as they are."
        title="When this rule applies"
      />
      <Link
        className="text-sm text-muted-foreground hover:text-foreground"
        to={back}
      >
        Back to My Rules
      </Link>
      {rules.isPending ? (
        <div aria-busy="true" aria-label="Loading rules" role="status">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : rules.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Rules could not be loaded.
        </p>
      ) : !rule ? (
        <p className="text-sm text-muted-foreground" role="status">
          This rule is not in your book.
        </p>
      ) : rule.status !== "active" ? (
        <p className="text-sm text-muted-foreground" role="status">
          Promote this rule before choosing what Another Me may do beyond
          reminding you.
        </p>
      ) : (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected || selected === rule.mandate || command.isPending)
              return;
            void command.mutateAsync(selected).catch(() => undefined);
          }}
        >
          <h2 className="text-lg text-foreground">{rule.text}</h2>
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">What Another Me may do</legend>
            {mandateChoices.map((item) => (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border px-4 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                htmlFor={`mandate-${item.id}`}
                key={item.id}
              >
                <input
                  checked={selected === item.id}
                  className="mt-1"
                  id={`mandate-${item.id}`}
                  name="mandate"
                  onChange={() => {
                    setChoice(item.id);
                    setSaved(false);
                  }}
                  type="radio"
                  value={item.id}
                />
                <span className="text-sm font-medium text-foreground">
                  {item.title}
                  <span className="mt-1 block font-normal text-muted-foreground">
                    {item.detail}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex items-center gap-3">
            <Button
              disabled={
                !selected || selected === rule.mandate || command.isPending
              }
              tone="primary"
              type="submit"
            >
              {command.isPending ? "Saving" : "Save"}
            </Button>
            {saved ? (
              <p className="text-sm text-foreground" role="status">
                {`Saved. ${mandateChoices.find((item) => item.id === rule.mandate)?.detail ?? ""}`}
              </p>
            ) : null}
          </div>
          {command.isError ? (
            <p className="text-sm text-destructive" role="alert">
              The change was not saved. Try again.
            </p>
          ) : null}
          {acts.length > 0 ? (
            <section
              aria-labelledby="rule-mandate-acts"
              className="flex flex-col gap-2"
            >
              <h3 className="text-sm text-foreground" id="rule-mandate-acts">
                Already done under this rule
              </h3>
              <ul
                aria-label="Actions taken under this rule"
                className="flex flex-col gap-1 text-sm text-muted-foreground"
              >
                {acts.map((act) => (
                  <li key={act.work_item_id}>
                    #{act.number} {act.title}:{" "}
                    {act.strength === "create_and_delegate"
                      ? "created and handed off"
                      : "created"}{" "}
                    for {act.event_source}
                    {act.revoked ? " · mandate revoked" : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </form>
      )}
    </div>
  );
}
