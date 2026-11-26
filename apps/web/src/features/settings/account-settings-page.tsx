import {
  ComputerIcon,
  Moon02Icon,
  Sun02Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useParams } from "react-router";

import { useTheme, type ThemePreference } from "@/app/theme";
import { themeMessages } from "@/app/theme.messages";
import { Icon } from "@/components/ui/icon";
import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { AccountProfileSettings } from "./account-profile-settings";
import { BrowserPreferencesSettings } from "./browser-preferences-settings";
import { DesktopNotificationsSettings } from "./desktop-notifications-settings";
import { SettingsPageHeading } from "./settings-page-heading";
import { settingsMessages } from "./settings.messages";

const THEME_OPTIONS = [
  { value: "system", label: themeMessages.system, icon: ComputerIcon },
  { value: "light", label: themeMessages.light, icon: Sun02Icon },
  { value: "dark", label: themeMessages.dark, icon: Moon02Icon },
] as const satisfies ReadonlyArray<{
  readonly value: ThemePreference;
  readonly label: (typeof themeMessages)[keyof typeof themeMessages];
  readonly icon: typeof ComputerIcon;
}>;

export function AccountSettingsPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  // The shell already read the identity, so this names the Account for its
  // browser-local settings without another request.
  const accountId = useQuery(teamHubIdentityQueryOptions(client)).data?.account
    .id;

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading title={t(settingsMessages.profile)} />

      <AccountProfileSettings client={client} tenantId={tenantId} />

      <AppearanceSettings />

      <DesktopNotificationsSettings accountId={accountId} />

      <BrowserPreferencesSettings />
    </div>
  );
}

function AppearanceSettings() {
  const t = useT();
  const headingId = useId();
  const { preference, setPreference } = useTheme();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-border bg-background p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground" id={headingId}>
            {t(themeMessages.appearance)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(themeMessages.appearanceHint)}
          </p>
        </div>
        <div
          aria-labelledby={headingId}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted p-1"
          role="radiogroup"
        >
          {THEME_OPTIONS.map((option) => {
            const active = preference === option.value;
            return (
              <button
                aria-checked={active}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={option.value}
                onClick={() => setPreference(option.value)}
                role="radio"
                type="button"
              >
                <Icon icon={option.icon} size={14} />
                <span>{t(option.label)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
