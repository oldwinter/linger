import {
  AiChipIcon,
  ArrowRight01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Button, buttonClassName } from "@/components/ui/button";
import { teamHubDone } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { accountSettingsMessages } from "./account-settings.messages";
import { ApiKeysSettings } from "./api-keys-settings";
import { ChangePasswordDialog } from "./change-password-dialog";
import { SettingsPageHeading } from "./settings-page-heading";
import { settingsMessages } from "./settings.messages";

export function SecuritySettingsPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const { tenantId } = useParams();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const modelsHref = tenantId
    ? `/t/${encodeURIComponent(tenantId)}/settings/models`
    : "../models";

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading title={t(settingsMessages.security)} />

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
