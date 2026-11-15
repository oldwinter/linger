import type {
  TeamHubProactiveAction,
  TeamHubProactiveRuleBook,
} from "@/features/teamhub/teamhub-types";

const nextPhrase: Record<TeamHubProactiveAction, string> = {
  notify: "tell you now",
  silent: "stay silent",
  track: "follow up later",
};

export function ruleNextPath(tenantId: string, ruleId: string) {
  return `/t/${encodeURIComponent(tenantId)}/settings/rule-changes/${encodeURIComponent(ruleId)}`;
}

/** What changes the next time this matter comes up, once the shadow rule decides. */
export function nextTimeChange(divergence: {
  matter: string;
  shadow_action: TeamHubProactiveAction;
  taken_action: TeamHubProactiveAction;
}) {
  return `On ${divergence.matter}, Another Me chose to ${nextPhrase[divergence.taken_action]}. From the next time this rule decides, it will ${nextPhrase[divergence.shadow_action]}.`;
}

export function ruleFromBook(book: TeamHubProactiveRuleBook, ruleId: string) {
  return book.rules.find((rule) => rule.id === ruleId);
}
