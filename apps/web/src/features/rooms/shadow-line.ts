import type { TeamHubProactiveAction } from "@/features/teamhub/teamhub-types";

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const actionPhrase: Record<TeamHubProactiveAction, string> = {
  notify: "tell now",
  silent: "stay silent",
  track: "follow up later",
};

/**
 * The newest shadow difference from the last two weeks, as one line.
 * Divergences arrive newest first. An older one stays on My Rules.
 */
export function latestShadowLine(
  divergences: readonly {
    created_at: string;
    matter: string;
    shadow_action: TeamHubProactiveAction;
    taken_action: TeamHubProactiveAction;
  }[],
  now: number,
): string | undefined {
  const latest = divergences[0];
  if (!latest) return;
  const at = Date.parse(latest.created_at);
  if (!Number.isFinite(at) || at > now || now - at > WINDOW_MS) return;
  return `${latest.matter}: a shadow rule would ${actionPhrase[latest.shadow_action]}; Another Me chose to ${actionPhrase[latest.taken_action]}`;
}
