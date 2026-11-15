import type { TeamHubPersonalProfileDocument } from "@/features/teamhub/teamhub-types";

const sections = [
  ["Background", "background"],
  ["Communication style", "communication_style"],
  ["Working style", "working_style"],
  ["Preferences", "preferences"],
  ["Writing style", "writing_style"],
] as const;

/**
 * The furthest section whose words changed, which is where a downward write
 * has reached. An unchanged profile has nothing to follow.
 */
export function profileSectionBeingWritten(
  previous: TeamHubPersonalProfileDocument | undefined,
  current: TeamHubPersonalProfileDocument,
): string | undefined {
  let writing: string | undefined;
  for (const [label, key] of sections) {
    if (sectionText(current[key]) === sectionText(previous?.[key])) continue;
    writing = label;
  }
  return writing;
}

export function profileSectionDomId(section: string) {
  return `profile-section-${section.toLowerCase().replace(/\s+/gu, "-")}`;
}

function sectionText(
  module:
    | TeamHubPersonalProfileDocument["background"]
    | TeamHubPersonalProfileDocument["preferences"]
    | undefined,
): string {
  if (!module) return "";
  const timeline = "timeline" in module ? module.timeline : [];
  const hasWords =
    module.overview.trim().length > 0 ||
    module.points.length > 0 ||
    timeline.length > 0;
  if (!hasWords) return "";
  return JSON.stringify({
    overview: module.overview,
    points: module.points,
    timeline,
  });
}
