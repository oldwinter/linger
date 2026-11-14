import type { TeamHubPersonalProfileDocument } from "@/features/teamhub/teamhub-types";

export type IntroductionLead = "person" | "talk" | "work";

export interface IntroductionLines {
  background: string;
  name: string;
  talk: string;
  work: string;
}

const noteHeading = "How Another Me would introduce you:";

export function introductionPath(tenantId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/introduction`;
}

/** The lines a friend could actually hear, taken from the profile Another Me keeps. */
export function introductionLines(
  profile: TeamHubPersonalProfileDocument,
): IntroductionLines {
  const point = profile.working_style.points[0];
  return {
    background: profile.background.overview.trim(),
    name: profile.name.trim(),
    talk: profile.communication_style.overview.trim(),
    work:
      profile.working_style.overview.trim() ||
      point?.text.trim() ||
      point?.items[0]?.trim() ||
      "",
  };
}

export function introductionParagraphs(
  lines: IntroductionLines,
  lead: IntroductionLead,
): string[] {
  const person = lines.name ? `This is ${lines.name}.` : "";
  const talk = lines.talk
    ? `Talk to ${lines.name || "them"} like this: ${lines.talk}`
    : "";
  const work = lines.work
    ? lines.name
      ? `${lines.name} works like this: ${lines.work}`
      : `They work like this: ${lines.work}`
    : "";
  const ordered =
    lead === "talk"
      ? [talk, person, work]
      : lead === "work"
        ? [work, person, talk]
        : [person, talk, work];
  const paragraphs = ordered.filter(Boolean);
  if (lines.background) paragraphs.push(lines.background);
  return paragraphs;
}

export function introductionNote(paragraphs: readonly string[]) {
  return [noteHeading, "", ...paragraphs].join("\n");
}

/** Today's note with the introduction added once. Empty when it does not fit. */
export function noteWithIntroduction(existing: string, introduction: string) {
  const current = existing.trim();
  if (current.includes(introduction.trim())) return current;
  const next = current ? `${current}\n\n${introduction}` : introduction;
  return next.length <= 20000 ? next : "";
}
