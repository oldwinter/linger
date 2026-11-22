import type { TeamHubExternalAppKey } from "@/features/teamhub/teamhub-types";
import type { Translate } from "@/i18n/language";

import { accountSettingsMessages } from "./account-settings.messages";

type ProfileSourceSelection = "fixed" | "optional" | "required" | "unsupported";

const PROFILE_SOURCE_SELECTION: Record<
  TeamHubExternalAppKey,
  ProfileSourceSelection
> = {
  discord: "required",
  facebook: "unsupported",
  github: "optional",
  gmail: "fixed",
  outlook: "fixed",
  google_calendar: "required",
  google_meet: "unsupported",
  notion: "required",
  slack: "required",
};

export function profileSourcePolicy(provider: string): {
  selection: ProfileSourceSelection;
} {
  return {
    selection: PROFILE_SOURCE_SELECTION[provider] ?? "unsupported",
  };
}

export function profileSourceSubmitLabel(
  provider: string,
  count: number,
  t: Translate,
) {
  switch (provider) {
    case "github":
      return count === 0
        ? t(accountSettingsMessages.addGitHubProfile)
        : t(accountSettingsMessages.addGitHubProfileAndRepositories, {
            count,
          });
    case "google_calendar":
      return t(accountSettingsMessages.addCalendars, { count });
    case "notion":
      return t(accountSettingsMessages.addNotionItems, { count });
    case "slack":
      return t(accountSettingsMessages.addSlackChannels, { count });
    case "discord":
      return t(accountSettingsMessages.addDiscordChannels, { count });
    default:
      return t(accountSettingsMessages.add);
  }
}

export function providerDisplayName(provider: string) {
  if (provider === "google_calendar") return "Google Calendar";
  if (provider === "github") return "GitHub";
  return `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
}
