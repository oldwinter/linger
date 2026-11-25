import {
  ArrowUp02Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";

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
import { dashboardWorkItemPath } from "@/features/work-items/work-item-routes";
import { commonMessages } from "@/i18n/common.messages";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import { myRulesMessages as m } from "./my-rules.messages";
import {
  myRulesQueryKey,
  myRulesQueryOptions,
  runMyRulesCommand,
  type MyRulesCommand,
} from "./my-rules-queries";
import { ruleNextPath } from "./rule-next";
import { shadowRuleIds } from "./shadow-rule-review";
import { SettingsPageHeading } from "./settings-page-heading";

const actionLabel: Record<TeamHubProactiveAction, Message<string>> = {
  notify: m.actionNotify,
  track: m.actionTrack,
  silent: m.actionSilent,
};

const mandateLabel: Record<TeamHubProactiveMandate, Message<string>> = {
  none: m.mandateNone,
  create: m.mandateCreate,
  create_and_delegate: m.mandateCreateAndDelegate,
};

const leaningLabel = {
  remind_directly: m.actionNotify,
  track_for_follow_up: m.actionTrack,
  stay_silent: m.actionSilent,
} as const;

/** Another Me's rules for one Human: what it learned and what they decided. */
export function MyRulesPage() {
  const t = useT();
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

  async function executeCommand(input: MyRulesCommand): Promise<boolean> {
    try {
      await command.mutateAsync(input);
      return true;
    } catch {
      return false;
    }
  }

  const pendingCommand = command.isPending ? command.variables : undefined;

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading description={t(m.description)} title={t(m.title)} />
      {identity.data ? (
        <section
          aria-labelledby="my-rules-quiet"
          className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-6"
        >
          <h2
            className="text-sm font-medium text-foreground"
            id="my-rules-quiet"
          >
            {t(m.remindersOnComputer)}
          </h2>
          <QuietRemindersControl
            accountId={identity.data.account.id}
            variant="settings"
          />
        </section>
      ) : null}
      {rules.isPending ? (
        <div
          aria-busy="true"
          aria-label={t(m.loadingRules)}
          className="rounded-2xl border border-border bg-background p-6"
          role="status"
        >
          <Skeleton className="h-40 w-full" />
        </div>
      ) : rules.isError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-background p-6">
          <p className="text-sm text-destructive" role="alert">
            {t(m.loadFailed)}
          </p>
          <Button
            onClick={() => void rules.refetch()}
            size="compact"
            tone="secondary"
          >
            {t(commonMessages.tryAgain)}
          </Button>
        </div>
      ) : (
        <RuleBook
          book={rules.data}
          busy={command.isPending}
          commandError={command.isError}
          onCommand={executeCommand}
          pendingCommand={pendingCommand}
          reviewPath={`/t/${encodeURIComponent(tenantId)}/settings/my-rules/review`}
          tenantId={tenantId}
        />
      )}
    </div>
  );
}

function RuleBook({
  book,
  busy,
  commandError,
  onCommand,
  pendingCommand,
  reviewPath,
  tenantId,
}: {
  book: TeamHubProactiveRuleBook;
  busy: boolean;
  commandError: boolean;
  onCommand: (input: MyRulesCommand) => Promise<boolean>;
  pendingCommand?: MyRulesCommand;
  reviewPath: string;
  tenantId: string;
}) {
  const t = useT();
  const [armedRuleId, setArmedRuleId] = useState<string | null>(null);
  const shadowCount = shadowRuleIds(book).length;
  return (
    <>
      <section
        aria-labelledby="my-rules-rules"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            className="text-sm font-medium text-foreground"
            id="my-rules-rules"
          >
            {t(m.rulesHeading)}
          </h2>
          {shadowCount > 0 ? (
            <Link
              className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={reviewPath}
            >
              {t(m.reviewNewRulesCount, { count: shadowCount })}
            </Link>
          ) : null}
        </div>
        {commandError ? (
          <p className="text-sm text-destructive" role="alert">
            {t(m.changeNotSaved)}
          </p>
        ) : null}
        {book.rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(m.noRulesYet)}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {book.rules.map((rule) => (
              <RuleRow
                armed={armedRuleId === rule.id}
                busy={busy}
                divergences={book.divergences.filter(
                  (divergence) => divergence.rule_id === rule.id,
                )}
                key={rule.id}
                mandates={book.mandates.filter(
                  (mandate) => mandate.rule_id === rule.id,
                )}
                onArm={() => setArmedRuleId(rule.id)}
                onCommand={onCommand}
                onDisarm={() =>
                  setArmedRuleId((current) =>
                    current === rule.id ? null : current,
                  )
                }
                pendingAction={
                  pendingCommand?.ruleId === rule.id
                    ? pendingCommand.kind
                    : undefined
                }
                rule={rule}
                tenantId={tenantId}
              />
            ))}
          </ul>
        )}
      </section>
      <section
        aria-labelledby="my-rules-clues"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-6"
      >
        <div>
          <h2
            className="text-sm font-medium text-foreground"
            id="my-rules-clues"
          >
            {t(m.cluesHeading)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(m.cluesDescription)}
          </p>
        </div>
        {book.clues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(m.noClues)}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {book.clues.map((clue) => (
              <li
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-1 last:pb-0 text-sm"
                key={`${clue.matter}\u0000${clue.kind}`}
              >
                <span className="text-foreground">{clue.matter}</span>
                <span className="text-muted-foreground">
                  {[clue.kind, clue.time].filter(Boolean).join(", ")}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {t(m.clueLeaningSeen, {
                    count: clue.seen,
                    leaning: t(leaningLabel[clue.leaning]),
                  })}
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
  armed,
  busy,
  divergences,
  mandates,
  onArm,
  onCommand,
  onDisarm,
  pendingAction,
  rule,
  tenantId,
}: {
  armed: boolean;
  busy: boolean;
  divergences: TeamHubProactiveRuleBook["divergences"];
  mandates: TeamHubProactiveRuleBook["mandates"];
  onArm: () => void;
  onCommand: (input: MyRulesCommand) => Promise<boolean>;
  onDisarm: () => void;
  pendingAction?: MyRulesCommand["kind"];
  rule: TeamHubProactiveRule;
  tenantId: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const savingRef = useRef(false);
  const shadow = rule.status === "shadow";
  const save = async () => {
    if (busy || savingRef.current) return;
    const text = draft?.trim() ?? "";
    if (!text) return;
    savingRef.current = true;
    try {
      if (await onCommand({ kind: "edit", ruleId: rule.id, text })) {
        setDraft(null);
      }
    } finally {
      savingRef.current = false;
    }
  };
  const cancelEdit = () => {
    if (!busy && !savingRef.current) setDraft(null);
  };
  // The page reports a failed command, so the confirmation closes either way.
  const confirmDelete = () => {
    void onCommand({ kind: "delete", ruleId: rule.id }).finally(onDisarm);
  };

  return (
    <li
      aria-label={rule.text}
      className="flex flex-col gap-2 py-3 first:pt-1 last:pb-0"
    >
      {draft === null ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="w-full min-w-0 text-sm break-words text-foreground sm:flex-1">
            {rule.text}
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <StatusPill tone={shadow ? "warning" : "success"}>
              {shadow ? t(m.statusShadow) : t(m.statusActive)}
            </StatusPill>
            {rule.pinned ? <StatusPill>{t(m.statusPinned)}</StatusPill> : null}
            {rule.source === "user" ? (
              <StatusPill>{t(m.statusEditedByYou)}</StatusPill>
            ) : null}
            <span className="flex flex-wrap items-center gap-1 sm:gap-0.5">
              {shadow ? (
                <Link
                  className="text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  to={ruleNextPath(tenantId, rule.id)}
                >
                  {t(m.whatThisChangesNext)}
                </Link>
              ) : null}
              {shadow ? (
                <Button
                  disabled={busy}
                  loading={pendingAction === "promote"}
                  onClick={() =>
                    void onCommand({ kind: "promote", ruleId: rule.id })
                  }
                  size="compact"
                  tone="subtle"
                >
                  {pendingAction === "promote" ? null : (
                    <Icon icon={ArrowUp02Icon} size={14} />
                  )}
                  {t(m.promote)}
                </Button>
              ) : null}
              <Button
                aria-label={rule.pinned ? t(m.unpinRule) : t(m.pinRule)}
                disabled={busy}
                loading={pendingAction === "pin"}
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
                aria-label={t(m.editRule)}
                disabled={busy}
                onClick={() => setDraft(rule.text)}
                size="compactIcon"
                tone="ghost"
              >
                <Icon icon={PencilEdit02Icon} size={14} />
              </Button>
              <Button
                aria-label={t(m.deleteRule)}
                data-voice-risk="never"
                disabled={busy}
                onClick={onArm}
                size="compactIcon"
                tone="ghost"
              >
                <Icon icon={Delete02Icon} size={14} />
              </Button>
            </span>
          </div>
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
            aria-label={t(m.ruleTextLabel)}
            className="min-h-16 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={busy}
            maxLength={200}
            onChange={(event) => {
              if (!busy && !savingRef.current) setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancelEdit();
                return;
              }
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                !busy &&
                draft.trim()
              ) {
                event.preventDefault();
                void save();
              }
            }}
            value={draft}
          />
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={cancelEdit} tone="ghost">
              {t(commonMessages.cancel)}
            </Button>
            <Button
              disabled={busy || !draft.trim()}
              loading={pendingAction === "edit"}
              tone="primary"
              type="submit"
            >
              {t(commonMessages.save)}
            </Button>
          </div>
        </form>
      )}
      {armed && draft === null ? (
        <div
          aria-label={t(m.confirmRuleDeletion)}
          className="flex flex-wrap items-center gap-2"
          role="group"
        >
          <span className="text-sm text-foreground">
            {t(m.deleteRuleQuestion)}
          </span>
          <Button
            aria-label={t(m.confirmDeleteRule)}
            data-voice-risk="never"
            disabled={busy}
            loading={pendingAction === "delete"}
            onClick={confirmDelete}
            size="compact"
            tone="danger"
          >
            {t(m.confirm)}
          </Button>
          <Button
            disabled={busy}
            onClick={onDisarm}
            size="compact"
            tone="ghost"
          >
            {t(commonMessages.cancel)}
          </Button>
        </div>
      ) : null}
      {shadow ? null : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t(m.mandatePrefix)}</span>
          <Select
            aria-label={t(m.mandateLabel)}
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
                  {t(mandateLabel[mandate])}
                </SelectItem>
              ),
            )}
          </Select>
        </div>
      )}
      {mandates.length > 0 ? (
        <ul
          aria-label={t(m.actionsTakenUnderRule)}
          className="flex flex-col gap-1 text-xs text-muted-foreground"
        >
          {mandates.map((mandate) => (
            <li key={mandate.work_item_id}>
              <Link
                className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                to={dashboardWorkItemPath(tenantId, mandate.work_item_id)}
              >
                #{mandate.number} {mandate.title}
              </Link>
              :{" "}
              {t(m.mandateForSource, {
                action: t(
                  mandate.strength === "create_and_delegate"
                    ? m.mandateCreatedAndDelegated
                    : m.mandateCreated,
                ),
                source: mandate.event_source,
              })}
              {mandate.revoked ? t(m.mandateRevoked) : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {shadow && divergences.length > 0 ? (
        <ul
          aria-label={t(m.divergencesLabel)}
          className="flex flex-col gap-1 text-xs text-muted-foreground"
        >
          {divergences.map((divergence) => (
            <li key={divergence.id}>
              {t(m.divergenceLine, {
                matter: divergence.matter,
                shadow: t(actionLabel[divergence.shadow_action]).toLowerCase(),
                taken: t(actionLabel[divergence.taken_action]).toLowerCase(),
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
