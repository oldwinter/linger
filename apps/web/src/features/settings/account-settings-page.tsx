import {
  AiChipIcon,
  ArrowRight01Icon,
  ComputerIcon,
  Moon02Icon,
  Sun02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";

import { useTheme, type ThemePreference } from "@/app/theme";
import { themeMessages } from "@/app/theme.messages";
import { Button, buttonClassName } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubDone } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { AccountProfileHero } from "./account-profile-hero";
import { accountProfileQueryOptions } from "./account-profile-queries";
import { accountSettingsMessages } from "./account-settings.messages";
import { ApiKeysSettings } from "./api-keys-settings";
import { BrowserPreferencesSettings } from "./browser-preferences-settings";
import { ChangePasswordDialog } from "./change-password-dialog";
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

/** Settings › Account: the profile card, password, API keys, appearance, notifications, and browser preferences. */
export function AccountSettingsPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  // The shell already read the identity, so this names the Account for its
  // browser-local settings without another request.
  const accountId = useQuery(teamHubIdentityQueryOptions(client)).data?.account
    .id;
  const accountQuery = useQuery(accountProfileQueryOptions(client, tenantId));
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const modelsHref = `/t/${encodeURIComponent(tenantId)}/settings/models`;

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading title={t(settingsMessages.account)} />

      {accountQuery.isPending ? (
        <div
          aria-busy="true"
          aria-label={t(accountSettingsMessages.loadingAccountProfile)}
          className="rounded-2xl border border-border p-6"
          role="status"
        >
          <span className="sr-only">
            {t(accountSettingsMessages.loadingAccountProfileStatus)}
          </span>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-5 h-40 w-full" />
        </div>
      ) : accountQuery.error ? (
        <p
          className="rounded-xl border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] p-4 text-sm text-app-danger"
          role="alert"
        >
          {accountQuery.error.message}
        </p>
      ) : (
        <AccountProfileHero
          account={accountQuery.data}
          client={client}
          tenantId={tenantId}
        />
      )}

      <section className="rounded-2xl border border-border bg-background p-6">
        <div className="flex flex-col justify-center gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">
            {t(accountSettingsMessages.password)}
          </p>
          <Button
            onClick={() => {
              setPasswordChanged(false);
              setChangePasswordOpen(true);
            }}
          >
            {t(accountSettingsMessages.changePassword)}
          </Button>
        </div>
      </section>

      {passwordChanged ? (
        <p
          className="flex items-center gap-2 text-sm text-app-success"
          role="status"
        >
          <Icon icon={Tick02Icon} size={16} />
          {t(accountSettingsMessages.passwordChanged)}
        </p>
      ) : null}

      <ApiKeysSettings />

      <section
        aria-label={t(accountSettingsMessages.byokKeysTitle)}
        className="rounded-2xl border border-border bg-background p-6"
      >
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
              <Icon icon={AiChipIcon} size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">
                {t(accountSettingsMessages.byokKeysTitle)}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(accountSettingsMessages.byokKeysDescription)}
              </p>
            </div>
          </div>
          <Link
            className={buttonClassName({
              className: "self-start sm:self-center",
              size: "compact",
              tone: "secondary",
            })}
            to={modelsHref}
          >
            <span>{t(accountSettingsMessages.openModelsSettings)}</span>
            <Icon icon={ArrowRight01Icon} size={14} />
          </Link>
        </div>
      </section>

      <AppearanceSettings />

      <DesktopNotificationsSettings accountId={accountId} />

      <BrowserPreferencesSettings />

      {changePasswordOpen ? (
        <ChangePasswordDialog
          changePassword={({ currentPassword, newPassword }) =>
            teamHubDone(
              client.api.POST("/v0/account/password", {
                body: {
                  current_password: currentPassword,
                  new_password: newPassword,
                },
              }),
            )
          }
          onChanged={() => setPasswordChanged(true)}
          onClose={() => setChangePasswordOpen(false)}
        />
      ) : null}
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
