import {
  ArrowUp02Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import { QuietRemindersControl } from "@/features/rooms/another-me-quiet-control";
import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Select, SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubProactiveAction,
  TeamHubProactiveMandate,
  TeamHubProactiveRule,
  TeamHubProactiveRuleBook,
} from "@/features/teamhub/teamhub-types";

import {
  myRulesQueryKey,
  myRulesQueryOptions,
  runMyRulesCommand,
  type MyRulesCommand,
} from "./my-rules-queries";
import { SettingsPageHeading } from "./settings-page-heading";

const actionLabel: Record<TeamHubProactiveAction, string> = {
  notify: "Tell now",
  track: "Follow up later",
  silent: "Stay silent",
};

const mandateLabel: Record<TeamHubProactiveMandate, string> = {
  none: "Only remind",
  create: "Create a Work Item",
  create_and_delegate: "Create and delegate",
};

const leaningLabel = {
  remind_directly: "Tell now",
  track_for_follow_up: "Follow up later",
  stay_silent: "Stay silent",
} as const;

/** Another Me's rules for one Human: what it learned and what they decided. */
export function MyRulesPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const queryClient = useQueryClient();
  const rules = useQuery(myRulesQueryOptions(client, tenantId));
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const command = useMutation({
    mutationFn: (input: MyRulesCommand) =>
      runMyRulesCommand(client, tenantId, input),
    onSuccess: (book) =>
      queryClient.setQueryData(myRulesQueryKey(tenantId), book),
  });

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description="How Another Me decides what to tell you, learned from your replies. Only active rules decide; a newly learned rule waits in shadow until you promote it. Another Me acts beyond reminding only where you allow it on an active rule."
        title="My Rules"
      />
      {identity.data ? (
        <section
          aria-labelledby="my-rules-quiet"
          className="flex flex-col gap-3"
        >
          <h2 className="text-sm text-foreground" id="my-rules-quiet">
            Reminders on this computer
          </h2>
          <QuietRemindersControl
            accountId={identity.data.account.id}
            variant="settings"
          />
        </section>
      ) : null}
      {rules.isPending ? (
        <div aria-busy="true" aria-label="Loading rules" role="status">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : rules.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Rules could not be loaded.
        </p>
      ) : (
        <RuleBook
          book={rules.data}
          busy={command.isPending}
          onCommand={(input) => command.mutateAsync(input)}
        />
      )}
      {command.isError ? (
        <p className="text-sm text-destructive" role="alert">
          The change was not saved. Try again.
        </p>
      ) : null}
    </div>
  );
}

function RuleBook({
  book,
  busy,
  onCommand,
}: {
  book: TeamHubProactiveRuleBook;
  busy: boolean;
  onCommand: (input: MyRulesCommand) => Promise<unknown>;
}) {
  return (
    <>
      <section aria-labelledby="my-rules-rules" className="flex flex-col gap-3">
        <h2 className="text-sm text-foreground" id="my-rules-rules">
          Rules
        </h2>
        {book.rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules yet. When you tell Another Me how you want a kind of thing
            handled, it learns a rule that night.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-background">
            {book.rules.map((rule) => (
              <RuleRow
                busy={busy}
                divergences={book.divergences.filter(
                  (divergence) => divergence.rule_id === rule.id,
                )}
                key={rule.id}
                mandates={book.mandates.filter(
                  (mandate) => mandate.rule_id === rule.id,
                )}
                onCommand={onCommand}
                rule={rule}
              />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="my-rules-clues" className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm text-foreground" id="my-rules-clues">
            Clues
          </h2>
          <p className="text-sm text-muted-foreground">
            Hints from single replies. A clue never decides; once the same kind
            shows up again, it becomes a rule.
          </p>
        </div>
        {book.clues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clues right now.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-background">
            {book.clues.map((clue) => (
              <li
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
                key={`${clue.matter}\u0000${clue.kind}`}
              >
                <span className="text-foreground">{clue.matter}</span>
                <span className="text-muted-foreground">
                  {[clue.kind, clue.time].filter(Boolean).join(", ")}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {leaningLabel[clue.leaning]} · seen {clue.seen}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RuleRow({
  busy,
  divergences,
  mandates,
  onCommand,
  rule,
}: {
  busy: boolean;
  divergences: TeamHubProactiveRuleBook["divergences"];
  mandates: TeamHubProactiveRuleBook["mandates"];
  onCommand: (input: MyRulesCommand) => Promise<unknown>;
  rule: TeamHubProactiveRule;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shadow = rule.status === "shadow";
  const save = async () => {
    const text = draft?.trim() ?? "";
    if (!text) return;
    await onCommand({ kind: "edit", ruleId: rule.id, text });
    setDraft(null);
  };

  return (
    <li aria-label={rule.text} className="flex flex-col gap-2 px-4 py-3">
      {draft === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-sm break-words text-foreground">
            {rule.text}
          </span>
          <StatusPill tone={shadow ? "warning" : "success"}>
            {shadow ? "Shadow" : "Active"}
          </StatusPill>
          {rule.pinned ? <StatusPill>Pinned</StatusPill> : null}
          {rule.source === "user" ? (
            <StatusPill>Edited by you</StatusPill>
          ) : null}
          <span className="flex items-center gap-0.5">
            {shadow ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void onCommand({ kind: "promote", ruleId: rule.id })
                }
                size="compact"
                tone="subtle"
              >
                <Icon icon={ArrowUp02Icon} size={14} />
                Promote
              </Button>
            ) : null}
            <Button
              aria-label={rule.pinned ? "Unpin rule" : "Pin rule"}
              disabled={busy}
              onClick={() =>
                void onCommand({
                  kind: "pin",
                  ruleId: rule.id,
                  pinned: !rule.pinned,
                })
              }
              size="compactIcon"
              tone="ghost"
            >
              <Icon icon={rule.pinned ? PinOffIcon : PinIcon} size={14} />
            </Button>
            <Button
              aria-label="Edit rule"
              disabled={busy}
              onClick={() => setDraft(rule.text)}
              size="compactIcon"
              tone="ghost"
            >
              <Icon icon={PencilEdit02Icon} size={14} />
            </Button>
            <Button
              aria-label="Delete rule"
              disabled={busy}
              onClick={() =>
                void onCommand({ kind: "delete", ruleId: rule.id })
              }
              size="compactIcon"
              tone="ghost"
            >
              <Icon icon={Delete02Icon} size={14} />
            </Button>
          </span>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <textarea
            aria-label="Rule text"
            className="min-h-16 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDraft(null)} tone="ghost">
              Cancel
            </Button>
            <Button
              disabled={busy || !draft.trim()}
              tone="primary"
              type="submit"
            >
              Save
            </Button>
          </div>
        </form>
      )}
      {shadow ? null : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>When this rule applies, Another Me may</span>
          <Select
            aria-label="Mandate"
            disabled={busy}
            onValueChange={(mandate) =>
              void onCommand({
                kind: "mandate",
                ruleId: rule.id,
                mandate: mandate as TeamHubProactiveMandate,
              })
            }
            value={rule.mandate}
            variant="pill"
          >
            {(["none", "create", "create_and_delegate"] as const).map(
              (mandate) => (
                <SelectItem key={mandate} value={mandate}>
                  {mandateLabel[mandate]}
                </SelectItem>
              ),
            )}
          </Select>
        </div>
      )}
      {mandates.length > 0 ? (
        <ul
          aria-label="Actions taken under this rule"
          className="flex flex-col gap-1 text-xs text-muted-foreground"
        >
          {mandates.map((mandate) => (
            <li key={mandate.work_item_id}>
              #{mandate.number} {mandate.title}:{" "}
              {mandate.strength === "create_and_delegate"
                ? "created and delegated"
                : "created"}{" "}
              for {mandate.event_source}
              {mandate.revoked ? " · mandate revoked" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {shadow && divergences.length > 0 ? (
        <ul
          aria-label="Where this rule would have decided differently"
          className="flex flex-col gap-1 text-xs text-muted-foreground"
        >
          {divergences.map((divergence) => (
            <li key={divergence.id}>
              {divergence.matter}: would{" "}
              {actionLabel[divergence.shadow_action].toLowerCase()}, Another Me
              chose to {actionLabel[divergence.taken_action].toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
