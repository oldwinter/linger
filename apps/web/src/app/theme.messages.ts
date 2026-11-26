import { defineMessages } from "@/i18n/messages";

/** Appearance mode selector shared by Settings and the account menu. */
export const themeMessages = defineMessages("theme", {
  appearance: "Appearance",
  appearanceHint:
    "Choose how Linger looks on this device, or match your system setting.",
  system: "System",
  light: "Light",
  dark: "Dark",
});
