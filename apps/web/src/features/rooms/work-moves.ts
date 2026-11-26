import type { TeamHubTeamMdDocument } from "@/features/teamhub/teamhub-types";
import { translate, type Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { roomActionsMessages as m } from "./room-actions.messages";
import { patternTitles } from "./task-sidebar/team-graph";

export interface WorkMove {
  kind: "start" | "handoff" | "report";
  who: string;
  other?: string;
  role?: string;
}

/** What the pattern means for the people in the room, beyond the graph's title. */
export const patternAccounts: Record<
  TeamHubTeamMdDocument["collaborate_pattern"],
  string
> = {
  "classify-and-act":
    "Work is sorted first, then the person who owns that kind of work does it.",
  "fan-out-and-synthesize":
    "The same question goes out to several people, and one person gathers what comes back.",
  "adversarial-verification":
    "One person prepares the work. Another checks it and sends the findings back.",
  tournament:
    "Several people try the same task, and the strongest result is the one that remains.",
  "loop-until-done":
    "The work goes around again until the goal is actually met.",
};

const patternAccountMessages: Record<
  TeamHubTeamMdDocument["collaborate_pattern"],
  Message<string>
> = {
  "classify-and-act": m.workMovesPatternClassify,
  "fan-out-and-synthesize": m.workMovesPatternFanOut,
  "adversarial-verification": m.workMovesPatternAdversarial,
  tournament: m.workMovesPatternTournament,
  "loop-until-done": m.workMovesPatternLoop,
};

export function patternAccountMessage(
  pattern: TeamHubTeamMdDocument["collaborate_pattern"],
) {
  return patternAccountMessages[pattern];
}

export function patternTitle(
  pattern: TeamHubTeamMdDocument["collaborate_pattern"],
) {
  return patternTitles[pattern];
}

export function workMovesPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/how-work-moves`;
}

/**
 * The collaboration document as a reading order: who starts, who receives a
 * handoff, and who the result is reported to. The graph draws the same
 * relationships; this is the sequence.
 */
export function workMoves(document: TeamHubTeamMdDocument): WorkMove[] {
  const steps: WorkMove[] = [
    {
      kind: "start",
      who: document.orchestrator.name,
      ...(document.orchestrator.role
        ? { role: document.orchestrator.role }
        : {}),
    },
  ];
  for (const person of document.members) {
    for (const from of person.receive_from) {
      steps.push({
        kind: "handoff",
        who: from,
        other: person.name,
        ...(person.role ? { role: person.role } : {}),
      });
    }
    for (const to of person.report_to) {
      steps.push({
        kind: "report",
        who: person.name,
        other: to,
        ...(person.role ? { role: person.role } : {}),
      });
    }
  }
  return steps;
}

export function formatWorkMove(step: WorkMove, t: Translate) {
  if (step.kind === "start") {
    return t(m.workMovesStepStart, { who: step.who });
  }
  if (step.kind === "handoff") {
    return t(m.workMovesStepHandoff, {
      other: step.other ?? "",
      who: step.who,
    });
  }
  return t(m.workMovesStepReport, {
    other: step.other ?? "",
    who: step.who,
  });
}

export function workMoveText(step: WorkMove) {
  return formatWorkMove(step, translate);
}
