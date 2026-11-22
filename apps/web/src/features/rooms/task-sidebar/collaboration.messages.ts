import { defineMessages } from "@/i18n/messages";

/**
 * The Collaboration panel of the Room side panel: the graph drawn from the
 * Room's team.md, its legend and the detail of the selected Agent. The file
 * name `team.md` and everything written in it are shown as they are.
 */
export const collaborationMessages = defineMessages("collaboration", {
  roomCollaboration: "Room collaboration",
  agentCount: { one: "{count} Agent", other: "{count} Agents" },
  refresh: "Refresh collaboration",
  accessLost: "You no longer have access to this collaboration.",
  loadFailed: "Could not load collaboration.",
  emptyTitle: "No collaboration plan yet",
  emptyBody:
    "When an Agent publishes team.md for this Room, its team and relationships appear here.",
  // The collaboration patterns of team.md.
  patternClassifyAndAct: "Classify and act",
  patternFanOutAndSynthesize: "Fan out and synthesize",
  patternCrossVerification: "Cross verification",
  patternTournament: "Tournament",
  patternIterateUntilDone: "Iterate until done",
  // What an Agent is in the pattern, shown under its name.
  coordinator: "Coordinator",
  specialist: "Specialist",
  verifier: "Verifier",
  judge: "Judge",
  contender: "Contender",
  synthesizer: "Synthesizer",
  researcher: "Researcher",
  worker: "Worker",
  // The graph.
  graph: "Agent collaboration graph",
  agentIdentity: "{name} · {identity}",
  decides: "Decides",
  collects: "Collects",
  repeatUntilDone: "Repeat until done",
  legend: "Relationship legend",
  handoff: "Handoff",
  report: "Report",
  // The detail of the selected Agent.
  selectAgent:
    "Select an Agent to see its responsibility and who it works with.",
  noResponsibility: "No responsibility specified in team.md.",
  nameInTeamMd: "Name in team.md",
  receivesFrom: "Receives from",
  sendsTo: "Sends to",
  reportTag: "report",
  none: "None",
  // The team.md source under the graph.
  sourceRevision: "team.md · Revision {revision}",
  viewSource: "View source",
  hideSource: "Hide source",
});
