import { defineMessages } from "@/i18n/messages";

/** Screen reader names of the shared color palette's two sliders. */
export const uiExtrasMessages = defineMessages("uiExtras", {
  notifications: "Notifications",
  // {name} is the palette's own name, such as Avatar background color.
  paletteField: "{name} saturation and brightness",
  paletteFieldValue: "{saturation}% saturation, {brightness}% brightness",
  paletteHue: "{name} hue",
});
