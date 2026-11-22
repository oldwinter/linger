import { defineMessages } from "@/i18n/messages";

/** The names and descriptions of TeamHub's built-in Agent templates. */
export const builtinTemplateMessages = defineMessages("builtinTemplates", {
  researchAnalystName: "Research Analyst",
  researchAnalystDescription:
    "Turns questions and source material into sourced, decision-ready briefs.",
  codeReviewerName: "Code Reviewer",
  codeReviewerDescription:
    "Reviews changes for correctness, risk, and clarity, and reports actionable findings.",
});
