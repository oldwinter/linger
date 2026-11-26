import { defineMessages } from "@/i18n/messages";

/** My Rules, Shadow Rule Review, and What This Changes Next (lazy Settings routes). */
export const myRulesMessages = defineMessages("myRules", {
  // MyRulesPage
  title: "My Rules",
  description:
    "How Another Me decides what to tell you, learned from your replies. Only active rules decide; a newly learned rule waits in shadow until you promote it. Another Me acts beyond reminding only where you allow it on an active rule.",
  remindersOnComputer: "Reminders on this computer",
  loadingRules: "Loading rules",
  loadFailed: "Rules could not be loaded.",
  rulesHeading: "Rules",
  reviewNewRulesCount: {
    one: "Review {count} new rule",
    other: "Review {count} new rules",
  },
  changeNotSaved: "The change was not saved. Try again.",
  noRulesYet:
    "No rules yet. When you tell Another Me how you want a kind of thing handled, it learns a rule that night.",
  cluesHeading: "Clues",
  cluesDescription:
    "Hints from single replies. A clue never decides; once the same kind shows up again, it becomes a rule.",
  noClues: "No clues right now.",
  clueLeaningSeen: "{leaning} · seen {count}",
  actionNotify: "Tell now",
  actionTrack: "Follow up later",
  actionSilent: "Stay silent",
  mandateNone: "Only remind",
  mandateCreate: "Create a Work Item",
  mandateCreateAndDelegate: "Create and delegate",
  statusShadow: "Shadow",
  statusActive: "Active",
  statusPinned: "Pinned",
  statusEditedByYou: "Edited by you",
  whatThisChangesNext: "What this changes next",
  promote: "Promote",
  pinRule: "Pin rule",
  unpinRule: "Unpin rule",
  editRule: "Edit rule",
  deleteRule: "Delete rule",
  ruleTextLabel: "Rule text",
  confirmRuleDeletion: "Confirm rule deletion",
  deleteRuleQuestion: "Delete rule?",
  confirmDeleteRule: "Confirm delete rule",
  confirm: "Confirm",
  mandatePrefix: "When this rule applies, Another Me may",
  mandateLabel: "Mandate",
  actionsTakenUnderRule: "Actions taken under this rule",
  mandateCreatedAndDelegated: "created and delegated",
  mandateCreated: "created",
  mandateForSource: "{action} for {source}",
  mandateRevoked: " · mandate revoked",
  divergencesLabel: "Where this rule would have decided differently",
  divergenceLine: "{matter}: would {shadow}, Another Me chose to {taken}",

  // ShadowRuleReviewPage
  reviewTitle: "Review new rules",
  reviewFinishedTitle: "Review finished",
  reviewDescription:
    "A newly learned rule waits in shadow until you promote it. Only then does it decide what Another Me does.",
  noNewRulesToReview: "No new rules to review.",
  ruleProgress: "{current} of {total}",
  ruleFallbackLabel: "Rule",
  noDifferenceYet: "Another Me has not differed from you on this rule yet.",
  leaveInShadow: "Leave in shadow",
  deleteRuleConfirmBody:
    "This learned rule will be permanently removed and will not guide Another Me.",
  deletedSummary: {
    one: "You deleted {count} rule.",
    other: "You deleted {count} rules.",
  },
  promotedSummary: {
    one: "You promoted {count} rule.",
    other: "You promoted {count} rules.",
  },
  leftInShadowSummary: {
    one: "{count} stays in shadow.",
    other: "{count} stay in shadow.",
  },
  deletedCountSuffix: "{count} deleted.",

  // RuleNextPage
  ruleNextTitle: "What this changes next",
  ruleNextSubtitle:
    "A shadow rule only watches. Letting it decide means the next matching thing follows it.",
  ruleNextLoading: "Loading this rule.",
  ruleNextLoadFailed: "This rule could not be loaded right now.",
  ruleNextNotInBook: "This rule is not in your book.",
  ruleNextAlreadyDecides: "This rule already decides.",
  ruleNextListLabel: "What changes next",
  ruleNextEmpty:
    "Nothing has come up yet where this would have decided differently. The next match follows this rule once it decides.",
  ruleNextCouldNotDecide: "This rule could not start deciding.",
  ruleNextPending: "Letting it decide",
  ruleNextAction: "Let this rule decide",
  backToMyRules: "Back to My Rules",
});
