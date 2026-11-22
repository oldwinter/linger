import { useId, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";

import type {
  TeamHubMessage,
  TeamHubMessageReactionId,
} from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { useTranslation } from "@/i18n/use-translation";

import { chatMessages } from "../chat.messages";

import { reactionName, useReactionCatalog } from "./reaction-catalog";
import { animateTransform, animationsEnabled } from "./reaction-motion";

/**
 * Public Reaction chips under the Message bubble, left aligned; right after a
 * bubble they straddle its bottom edge. A Reaction added while the Message is
 * on screen springs in once the picker folds away; removing the last reactor
 * shrinks the chip out before the toggle. Each chip toggles only
 * the current Actor's Reaction; hover or focus lists who reacted.
 */
export function MessageReactionBar({
  actorDisplayNames,
  actorKinds,
  currentActorId,
  error,
  message,
  onToggle,
}: {
  actorDisplayNames: Readonly<Record<string, string>>;
  actorKinds: Readonly<Record<string, "human" | "agent">>;
  currentActorId?: string;
  error: boolean;
  message: TeamHubMessage;
  onToggle?: (reactionId: TeamHubMessageReactionId) => void;
}) {
  const { language, t } = useTranslation();
  const catalog = useReactionCatalog();
  const reactions = catalog ? (message.reactions ?? []) : [];
  const tooltipBaseId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  // Reactions already shown; null until the first render with the catalog.
  const shownRef = useRef<Set<string> | null>(null);
  const reactionKey = reactions.map((reaction) => reaction.reaction_id).join();

  useLayoutEffect(() => {
    if (!catalog) return;
    const ids = new Set(reactionKey ? reactionKey.split(",") : []);
    const shown = shownRef.current;
    shownRef.current = ids;
    const row = rowRef.current;
    if (!shown || !row) return;
    for (const id of ids) {
      if (shown.has(id)) continue;
      const chip = row.querySelector<HTMLElement>(
        `[data-reaction-id="${CSS.escape(id)}"]`,
      );
      if (!chip || !animationsEnabled(chip)) continue;
      animateTransform(chip, ["scale(0)", "scale(1)"], [0, 1], {
        delay: 160,
        duration: 500,
        easing: "spring",
        fadeDuration: 180,
      });
    }
  }, [catalog, reactionKey]);

  function toggle(reactionId: TeamHubMessageReactionId, chip: HTMLElement) {
    if (!onToggle) return;
    const leaving =
      chip.getAttribute("aria-pressed") === "true" &&
      chip.dataset.reactorCount === "1";
    if (!leaving || !animationsEnabled(chip)) {
      onToggle(reactionId);
      return;
    }
    chip.style.pointerEvents = "none";
    const done = () => {
      chip.style.pointerEvents = "";
      onToggle(reactionId);
    };
    void animateTransform(chip, ["scale(1)", "scale(0)"], [1, 0], {
      duration: 280,
      easing: "out",
      fadeDuration: 200,
    }).finished.then(done);
  }

  if (!reactions.length && !error) return null;
  return (
    <div
      className={cn(
        "mt-1.5 flex flex-col items-start gap-1",
        reactions.length > 0 && "message-reactions",
      )}
    >
      {reactions.length ? (
        <div
          ref={rowRef}
          aria-label={t(chatMessages.reactions)}
          className="flex flex-wrap justify-start gap-1"
          role="group"
        >
          {reactions.map((reaction) => {
            const entry = catalog?.byId.get(reaction.reaction_id);
            if (!entry) return null;
            const own = Boolean(
              currentActorId && reaction.actor_ids.includes(currentActorId),
            );
            const reactors = reaction.actor_ids
              .map((actorId) => {
                const name =
                  actorId === currentActorId
                    ? t(commonMessages.you)
                    : (actorDisplayNames[actorId] ??
                      t(chatMessages.formerMember));
                return actorKinds[actorId] === "agent"
                  ? t(chatMessages.agentReactor, { name })
                  : name;
              })
              .join(t(chatMessages.listSeparator));
            const count = reaction.actor_ids.length;
            const tooltipId = `${tooltipBaseId}-${reaction.reaction_id}`;
            return (
              <span
                className="group/reaction relative inline-flex"
                key={reaction.reaction_id}
              >
                <button
                  aria-describedby={tooltipId}
                  aria-label={t(chatMessages.reactionSummary, {
                    count,
                    emoji: reactionName(entry, language),
                    names: reactors,
                  })}
                  aria-pressed={own}
                  className="message-reaction-chip flex h-6 items-center gap-1 rounded-full border border-app-border bg-app-surface px-2 text-xs leading-none text-app-ink tabular-nums focus-visible:outline-2 focus-visible:outline-app-focus disabled:cursor-default"
                  data-own-reaction={own || undefined}
                  data-reaction-id={reaction.reaction_id}
                  data-reactor-count={count}
                  disabled={!onToggle}
                  onClick={(event) =>
                    toggle(reaction.reaction_id, event.currentTarget)
                  }
                  title={`${reactionName(entry, language)}: ${reactors}`}
                  type="button"
                >
                  <span aria-hidden="true" className="text-sm">
                    {entry.glyph}
                  </span>
                  {count > 1 ? <span aria-hidden="true">{count}</span> : null}
                </button>
                <span
                  className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-56 -translate-x-1/2 rounded-md bg-primary px-2 py-1 text-center text-xs leading-[18px] text-primary-foreground opacity-0 shadow-sm transition-opacity duration-150 group-hover/reaction:opacity-100 group-focus-within/reaction:opacity-100 motion-reduce:transition-none"
                  id={tooltipId}
                  role="tooltip"
                >
                  {reactors}
                </span>
              </span>
            );
          })}
        </div>
      ) : null}
      {error ? (
        <p className="text-xs text-app-danger" role="alert">
          {t(chatMessages.reactionNotSaved)}
        </p>
      ) : null}
    </div>
  );
}
