import { defineMessages } from "@/i18n/messages";

/** What an Agent can do: toggling custom skills and viewing built-in defaults. */
export const agentCanDoMessages = defineMessages("agentCanDo", {
  defaultAgentName: "This agent",
  title: "What {name} can do",
  subtitle:
    "Turn a skill off and it will not be used. Turn it on and it is available again.",
  loading: "Loading skills.",
  loadFailed: "Skills could not be loaded.",
  reloadFirst: "Reload skills first.",
  noSkills: "This agent has no skills to turn on or off.",
  configurableHeading: "Custom / configurable skills",
  noConfigurableSkills:
    "No custom skills added yet. Add custom skills in Agent Info to turn them on or off here.",
  includedByDefaultHeading: "Included by default",
  includedByDefaultSummary: {
    one: "{count} built-in skill is always enabled for this agent.",
    other: "{count} built-in skills are always enabled for this agent.",
  },
  alwaysOn: "Always on",
  skillsList: "Skills",
  on: "On",
  off: "Off",
  turnOff: "Turn off {name}",
  turnOn: "Turn on {name}",
  changeFailed: "That skill did not change.",
  saved: "Saved. The next time this agent works, that is what they can do.",
  backToMessages: "Back to messages",
});
