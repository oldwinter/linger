import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import type { Translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";

import { myRulesMessages as m } from "./my-rules.messages";
import {
  myRulesQueryKey,
  myRulesQueryOptions,
  runMyRulesCommand,
  type MyRulesCommand,
} from "./my-rules-queries";
import {
  newestShadowDivergence,
  reviewResultCopy,
  shadowDivergenceLine,
  shadowRuleIds,
} from "./shadow-rule-review";
import { SettingsPageHeading } from "./settings-page-heading";

function formatReviewSummary(
  promoted: number,
  left: number,
  deleted: number,
  t: Translate,
): string {
  if (deleted === 0) {
    return reviewResultCopy(promoted, left);
  }
  if (promoted === 0 && left === 0) {
    return t(m.deletedSummary, { count: deleted });
  }
  if (promoted === 0) {
    return `${reviewResultCopy(0, left)} ${t(m.deletedCountSuffix, { count: deleted })}`;
  }
  const promotedLine = t(m.promotedSummary, { count: promoted });
  if (left === 0) {
    return `${promotedLine} ${t(m.deletedCountSuffix, { count: deleted })}`;
  }
  const leftLine = t(m.leftInShadowSummary, { count: left });
  return `${promotedLine} ${leftLine} ${t(m.deletedCountSuffix, { count: deleted })}`;
}

/**
 * Walks newly learned shadow rules one at a time. Promote makes the rule
 * active, Edit adjusts its wording in place, Delete removes it after
 * confirmation, and Leave keeps it in shadow and moves on; coming back starts
 * from whatever is still waiting.
 */
export function ShadowRuleReviewPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const queryClient = useQueryClient();
  const rules = useQuery(myRulesQueryOptions(client, tenantId));
  const command = useMutation({
    mutationFn: (input: MyRulesCommand) =>
      runMyRulesCommand(client, tenantId, input),
    onSuccess: (book) =>
      queryClient.setQueryData(myRulesQueryKey(tenantId), book),
  });
  const [visit, setVisit] = useState<string[] | undefined>();
  const [index, setIndex] = useState(0);
  const [promoted, setPromoted] = useState<string[]>([]);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const started = useRef(false);
  const rulesPath = `/t/${encodeURIComponent(tenantId)}/settings/my-rules`;
  const pendingKind = command.isPending ? command.variables?.kind : null;

  useEffect(() => {
    if (started.current || !rules.data) return;
    started.current = true;
    setVisit(shadowRuleIds(rules.data));
  }, [rules.data]);

  async function promote(ruleId: string) {
    try {
      await command.mutateAsync({ kind: "promote", ruleId });
    } catch {
      // Stay on this rule so the person can try the promotion again.
      return;
    }
    setDraft(null);
    setDeleteConfirmOpen(false);
    setPromoted((ids) => [...ids, ruleId]);
    setIndex((current) => current + 1);
  }

  async function saveEdit(ruleId: string) {
    const text = draft?.trim() ?? "";
    if (!text || command.isPending) return;
    try {
      await command.mutateAsync({ kind: "edit", ruleId, text });
    } catch {
      // Keep the draft open so the person can fix or retry saving it.
      return;
    }
    setDraft(null);
  }

  async function removeRule(ruleId: string) {
    if (command.isPending) return;
    try {
      await command.mutateAsync({ kind: "delete", ruleId });
    } catch {
      setDeleteConfirmOpen(false);
      return;
    }
    setDeleteConfirmOpen(false);
    setDraft(null);
    setDeleted((ids) => [...ids, ruleId]);
    setIndex((current) => current + 1);
  }

  const currentId = visit?.[index];
  const current = rules.data?.rules.find((rule) => rule.id === currentId);
  const finished = visit !== undefined && (visit.length === 0 || !currentId);
  const leftInShadow =
    visit !== undefined
      ? Math.max(0, visit.length - promoted.length - deleted.length)
      : 0;
  const divergence =
    rules.data && currentId
      ? newestShadowDivergence(rules.data, currentId)
      : undefined;
  const difference = divergence
    ? shadowDivergenceLine(divergence)
    : t(m.noDifferenceYet);

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description={t(m.reviewDescription)}
        title={
          finished && visit && visit.length > 0
            ? t(m.reviewFinishedTitle)
            : t(m.reviewTitle)
        }
      />
      <Link
        className="text-sm text-muted-foreground hover:text-foreground"
        to={rulesPath}
      >
        {t(m.backToMyRules)}
      </Link>
      {rules.isPending || (rules.data && visit === undefined) ? (
        <div aria-busy="true" aria-label={t(m.loadingRules)} role="status">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : rules.isError || !rules.data || !visit ? (
        <div className="flex flex-wrap items-center gap-3">
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
      ) : finished ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl text-foreground">
            {visit.length === 0
              ? t(m.noNewRulesToReview)
              : formatReviewSummary(
                  promoted.length,
                  leftInShadow,
                  deleted.length,
                  t,
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
          aria-label={current?.text ?? t(m.ruleFallbackLabel)}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted-foreground">
            {t(m.ruleProgress, { current: index + 1, total: visit.length })}
          </p>
          {draft !== null ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (currentId) void saveEdit(currentId);
              }}
            >
              <textarea
                aria-label={t(m.ruleTextLabel)}
                className="min-h-20 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={command.isPending}
                maxLength={200}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229)
                    return;
                  if (event.key === "Escape") {
                    event.preventDefault();
                    if (!command.isPending) setDraft(null);
                    return;
                  }
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter" &&
                    !command.isPending &&
                    draft.trim() &&
                    currentId
                  ) {
                    event.preventDefault();
                    void saveEdit(currentId);
                  }
                }}
                value={draft}
              />
              <p className="text-sm text-muted-foreground">{difference}</p>
              <div className="flex items-center gap-3">
                <Button
                  disabled={command.isPending || !draft.trim() || !current}
                  loading={pendingKind === "edit"}
                  size="compact"
                  tone="primary"
                  type="submit"
                >
                  {t(commonMessages.save)}
                </Button>
                <Button
                  disabled={command.isPending}
                  onClick={() => {
                    command.reset();
                    setDraft(null);
                  }}
                  size="compact"
                  tone="ghost"
                >
                  {t(commonMessages.cancel)}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <h2 className="text-xl text-foreground">{current?.text}</h2>
              <p className="text-sm text-muted-foreground">{difference}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={command.isPending || !current}
                  loading={pendingKind === "promote"}
                  onClick={() => {
                    if (currentId) void promote(currentId);
                  }}
                  size="compact"
                  tone="primary"
                >
                  {t(m.promote)}
                </Button>
                <Button
                  disabled={command.isPending || !current}
                  onClick={() => {
                    if (!current) return;
                    command.reset();
                    setDeleteConfirmOpen(false);
                    setDraft(current.text);
                  }}
                  size="compact"
                  tone="secondary"
                >
                  {t(commonMessages.edit)}
                </Button>
                <Button
                  data-voice-risk="never"
                  disabled={command.isPending}
                  onClick={() => {
                    command.reset();
                    setDeleteConfirmOpen(false);
                    setIndex((value) => value + 1);
                  }}
                  size="compact"
                  tone="ghost"
                >
                  {t(m.leaveInShadow)}
                </Button>
                <Button
                  data-voice-risk="never"
                  disabled={command.isPending || !current}
                  onClick={() => {
                    command.reset();
                    setDeleteConfirmOpen(true);
                  }}
                  size="compact"
                  tone="danger"
                >
                  {t(commonMessages.delete)}
                </Button>
              </div>
            </>
          )}
          {command.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {t(m.changeNotSaved)}
            </p>
          ) : null}
          {deleteConfirmOpen && current ? (
            <ModalDialog
              closeOnBackdrop={!command.isPending}
              description={t(m.deleteRuleConfirmBody)}
              footer={
                <>
                  <Button
                    disabled={command.isPending}
                    onClick={() => setDeleteConfirmOpen(false)}
                    tone="secondary"
                  >
                    {t(commonMessages.cancel)}
                  </Button>
                  <Button
                    data-voice-risk="never"
                    disabled={command.isPending}
                    loading={pendingKind === "delete"}
                    onClick={() => {
                      if (currentId) void removeRule(currentId);
                    }}
                    tone="danger"
                  >
                    {t(m.deleteRule)}
                  </Button>
                </>
              }
              onClose={() => {
                if (!command.isPending) setDeleteConfirmOpen(false);
              }}
              size="sm"
              title={t(m.deleteRuleQuestion)}
            >
              {null}
            </ModalDialog>
          ) : null}
        </section>
      )}
    </div>
  );
}
