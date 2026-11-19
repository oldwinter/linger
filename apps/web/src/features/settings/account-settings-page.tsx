import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { AccountProfileSettings } from "./account-profile-settings";
import { BrowserPreferencesSettings } from "./browser-preferences-settings";
import { DesktopNotificationsSettings } from "./desktop-notifications-settings";
import { SettingsPageHeading } from "./settings-page-heading";

export function AccountSettingsPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  // The shell already read the identity, so this names the Account for its
  // browser-local settings without another request.
  const accountId = useQuery(teamHubIdentityQueryOptions(client)).data?.account
    .id;

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description="Photo, name, bio, notifications, and browser preferences for this space."
        title="Profile"
      />

      <AccountProfileSettings client={client} tenantId={tenantId} />

      <DesktopNotificationsSettings accountId={accountId} />

      <BrowserPreferencesSettings />
    </div>
  );
}
