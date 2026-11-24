import { startsMentionToken } from "@/features/teamhub/mention-boundary";
import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";
import {
  findTeamHubMessageTokenMatches,
  formatTeamHubMentionToken,
  teamHubMentionTokenAliases,
} from "@/features/teamhub/teamhub-message-content";

export interface MessageMentionQuery {
  end: number;
  query: string;
  start: number;
}

export function formatMentionToken(actor: TeamHubActorRef) {
  return formatTeamHubMentionToken(actor);
}

export function findMessageMentionQuery(
  body: string,
  cursor: number,
): MessageMentionQuery | null {
  const boundedCursor = Math.max(0, Math.min(cursor, body.length));
  const beforeCursor = body.slice(0, boundedCursor);
  // Chinese, Japanese and Korean prose has no spaces, so `@` after a Han
  // character still starts a mention; a word in a script that does use spaces,
  // a number, or a path or address character before it keeps the `@` literal.
  const match = beforeCursor.match(/@([\p{L}\p{N}_-]*)$/u);

  if (!match || !startsMentionToken(beforeCursor, match.index!)) {
    return null;
  }

  const query = match[1] ?? "";
  return { end: boundedCursor, query, start: match.index! };
}

export function findMessageMentionCandidates(
  query: MessageMentionQuery | null,
  options: TeamHubActorRef[],
) {
  if (!query) {
    return [];
  }

  const normalizedQuery = query.query.toLocaleLowerCase();
  const matcher = new RegExp(escapeRegExp(normalizedQuery), "u");
  return options.filter((actor) => matcher.test(mentionSearchText(actor)));
}

export function replaceMessageMention(
  body: string,
  query: MessageMentionQuery,
  actor: TeamHubActorRef,
) {
  const suffix = body.slice(query.end);
  const separator = !suffix || !/^[\s.,!?;:()[\]{}]/.test(suffix) ? " " : "";
  const replacement = `${formatMentionToken(actor)}${separator}`;
  return {
    body: `${body.slice(0, query.start)}${replacement}${suffix}`,
    cursor: query.start + replacement.length,
  };
}

/**
 * Drops mentions of people who are no longer in the room, and lifts their
 * tokens out of the unsent text. A name that is still a member stays.
 * `caret` is mapped onto the text that remains.
 */
export function omitDepartedMentions(
  body: string,
  mentions: readonly TeamHubActorRef[],
  memberIds: ReadonlySet<string>,
  caret = body.length,
): { body: string; caret: number; mentions: TeamHubActorRef[] } {
  const departed = mentions.filter((actor) => !memberIds.has(actor.id));
  if (departed.length === 0) {
    return { body, caret, mentions: [...mentions] };
  }
  const matches = findTeamHubMessageTokenMatches(
    body,
    departed.flatMap((actor) => teamHubMentionTokenAliases(actor)),
  );
  let next = body;
  let cursor = caret;
  for (const match of [...matches].reverse()) {
    const end = match.index + match.token.length;
    next = `${next.slice(0, match.index)}${next.slice(end)}`;
    cursor = mapCaret(cursor, match.index, end);
    const joined = tidyJoin(next, match.index);
    if (joined.removed > 0) {
      next = joined.body;
      cursor = mapCaret(cursor, joined.at, joined.at + joined.removed);
    }
  }
  return {
    body: next,
    caret: cursor,
    mentions: mentions.filter((actor) => memberIds.has(actor.id)),
  };
}

function mapCaret(caret: number, start: number, end: number) {
  if (caret >= end) return caret - (end - start);
  if (caret > start) return start;
  return caret;
}

/** One space where a lifted token left a gap, including before punctuation. */
function tidyJoin(body: string, at: number) {
  if (body[at - 1] === " " && body[at] === " ") {
    return {
      at,
      body: `${body.slice(0, at)}${body.slice(at + 1)}`,
      removed: 1,
    };
  }
  if (at === 0 && body[0] === " ") {
    return { at: 0, body: body.slice(1), removed: 1 };
  }
  if (body[at - 1] === " " && /^[.,!?;:]/u.test(body[at] ?? "")) {
    return {
      at: at - 1,
      body: `${body.slice(0, at - 1)}${body.slice(at)}`,
      removed: 1,
    };
  }
  return { at, body, removed: 0 };
}

export function activeMessageMentions(
  body: string,
  mentions: TeamHubActorRef[],
) {
  const actorsByToken = new Map(
    mentions.flatMap((actor) =>
      teamHubMentionTokenAliases(actor).map((token) => [token, actor] as const),
    ),
  );
  const orderedActors: TeamHubActorRef[] = [];
  const seen = new Set<string>();

  for (const match of findTeamHubMessageTokenMatches(
    body,
    actorsByToken.keys(),
  )) {
    const actor = actorsByToken.get(match.token);
    if (!actor || seen.has(actor.id)) {
      continue;
    }
    orderedActors.push(actor);
    seen.add(actor.id);
  }

  return orderedActors;
}

function mentionSearchText(actor: TeamHubActorRef) {
  return formatMentionToken(actor).slice(1).toLocaleLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
