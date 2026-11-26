import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { AccountProfileSettings } from "./account-profile-settings";
import { BrowserPreferencesSettings } from "./browser-preferences-settings";
import { DesktopNotificationsSettings } from "./desktop-notifications-settings";
import { SettingsPageHeading } from "./settings-page-heading";
import { settingsMessages } from "./settings.messages";

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

      <DesktopNotificationsSettings accountId={accountId} />

      <BrowserPreferencesSettings />
    </div>
  );
}
