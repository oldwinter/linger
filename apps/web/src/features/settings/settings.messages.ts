import { defineMessages } from "@/i18n/messages";

export const settingsMessages = defineMessages("settings", {
  navigation: "Settings navigation",
  title: "Settings",
  sections: "Settings sections",
  profile: "Profile",
  security: "Security",
  myRules: "My Rules",
  shortcuts: "Shortcuts",
  computers: "Computers",
  models: "Models",
  system: "System",
  language: "Language",
  profilePageDescription:
    "Photo, name, bio, notifications, and browser preferences for this space.",
  securityPageDescription: "Manage your sign-in password and server API keys.",
  loadingComputers: "Loading Computers",
  loadingContent: "Loading content",
  interfaceLanguage: "Interface language",
  interfaceLanguageHint: "Saved on this device.",
  languageUnavailable:
    "That language could not be loaded. Check your connection and try again.",
  saveDiagnostics: "Save diagnostics…",
  saveDiagnosticsFailed: "Diagnostics could not be saved. Try again.",
});
