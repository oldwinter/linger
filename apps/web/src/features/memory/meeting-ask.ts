import { EMPTY_SECTION_TEXT } from "@linger/knowledge-format/sections";

import {
  readRoomComposerDraft,
  writeRoomComposerDraft,
  type RoomComposerDraft,
} from "@/features/rooms/room-drafts";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { parseMeetingSummary } from "./meeting-overview";
import { formatMeetingWhen, meetingWhen } from "./meetings-calendar";

const followUpLimit = 5;

/** The composer text that asks Another Me to follow up on one meeting. */
export function meetingAskPrompt(label: string, followUps: string[]): string {
  const lines = followUps.slice(0, followUpLimit);
  const detail = lines.length
    ? lines.map((line) => `- ${line}`).join("\n")
    : "I just read it. What should I do next?";
  return `Help me follow up on ${label}.\n\n${detail}`;
}

/**
 * Decisions and action items the Session page already parsed, in page order.
 * Empty sections stay out so the draft does not ask about "None observed."
 */
export function followUpsFromMeeting(content: string): string[] {
  const markdown = content.replace(/^#[ \t]+[^\n]*\n?/mu, "");
  return parseMeetingSummary(markdown).flatMap((block) =>
    block.kind === "outcomes"
      ? block.outcomes
          .map((item) => item.text)
          .filter((text) => text.length > 0 && text !== EMPTY_SECTION_TEXT)
      : [],
  );
}

/** Keeps an unsent composer draft and adds the meeting ask once. */
export function withMeetingAsk(current: string, prompt: string): string {
  const trimmed = current.replace(/\s+$/u, "");
  if (!trimmed) return prompt;
  if (trimmed.includes(prompt)) return trimmed;
  return `${trimmed}\n\n${prompt}`;
}

export function meetingAskLabel(entry: TeamHubMemoryEntry): string {
  const when = meetingWhen(entry.path);
  return when
    ? `Meeting ${formatMeetingWhen(when.date, when.time)}`
    : entry.title;
}

/**
 * Writes the meeting ask into Another Me's room composer and returns the
 * chat location that should open with the composer focused.
 */
export function askAnotherMeAboutMeeting(input: {
  accountId: string;
  entry: TeamHubMemoryEntry;
  roomId: string;
  tenantId: string;
}): { body: string; state: { focusComposer: true }; to: string } {
  const prompt = meetingAskPrompt(
    meetingAskLabel(input.entry),
    followUpsFromMeeting(input.entry.content),
  );
  const scope = {
    accountId: input.accountId,
    roomId: input.roomId,
    tenantId: input.tenantId,
  };
  const current = readRoomComposerDraft(scope);
  const body = withMeetingAsk(current.body, prompt);
  const next: RoomComposerDraft = { ...current, body };
  writeRoomComposerDraft(scope, next);
  return {
    body,
    state: { focusComposer: true },
    to: `/t/${encodeURIComponent(input.tenantId)}/rooms/${encodeURIComponent(input.roomId)}/chat`,
  };
}
