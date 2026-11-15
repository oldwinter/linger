import type {
  TeamHubProactiveAction,
  TeamHubProactiveRuleBook,
} from "@/features/teamhub/teamhub-types";

const actionLabel: Record<TeamHubProactiveAction, string> = {
  notify: "tell now",
  track: "follow up later",
  silent: "stay silent",
};

export type ShadowDivergence = TeamHubProactiveRuleBook["divergences"][number];

/** Shadow rules in rule-book order. Newly learned rules wait here until promoted. */
export function shadowRuleIds(book: TeamHubProactiveRuleBook): string[] {
  return book.rules
    .filter((rule) => rule.status === "shadow")
    .map((rule) => rule.id);
}

/** Divergences are newest first, so the first match is the latest difference. */
export function newestShadowDivergence(
  book: TeamHubProactiveRuleBook,
  ruleId: string,
): ShadowDivergence | undefined {
  return book.divergences.find((item) => item.rule_id === ruleId);
}

export function shadowDivergenceLine(divergence: ShadowDivergence): string {
  return `${divergence.matter}: would ${actionLabel[divergence.shadow_action]}, Another Me chose to ${actionLabel[divergence.taken_action]}`;
}

/** The closing line after every shadow rule in the walk has been seen. */
export function reviewResultCopy(promoted: number, left: number): string {
  if (promoted === 0) {
    return left === 1
      ? "You left 1 rule in shadow."
      : `You left ${left} rules in shadow.`;
  }
  const promotedLine =
    promoted === 1 ? "You promoted 1 rule." : `You promoted ${promoted} rules.`;
  const leftLine =
    left === 0
      ? "None stay in shadow."
      : left === 1
        ? "1 stays in shadow."
        : `${left} stay in shadow.`;
  return `${promotedLine} ${leftLine}`;
}
