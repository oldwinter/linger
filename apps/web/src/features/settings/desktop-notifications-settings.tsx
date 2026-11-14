import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  clearDesktopNotificationPause,
  desktopNotificationPauseUntil,
  isDesktopNotificationPaused,
  setDesktopNotificationPause,
  useDesktopNotificationPause,
  type DesktopNotificationPauseChoice,
} from "@/features/rooms/desktop-notification-pause";

import {
  desktopNotificationPermission,
  type DesktopNotificationPermission,
  requestDesktopNotificationPermission,
} from "./desktop-notification-permission";

const statusCopy: Record<DesktopNotificationPermission, string> = {
  denied:
    "Notifications are blocked. Allow notifications for this site in your browser or system settings, then reload this page.",
  default:
    "Notifications are off. Enable them to be told about unread mentions while this window is in the background.",
  granted: "Notifications are on.",
  unsupported:
    "This browser cannot show desktop notifications, so mentions stay in the Room list.",
};

const pauseEndFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});

/**
 * The one place in the app that asks for notification permission, so the
 * browser prompt appears when the person chooses it instead of on first load.
 * The pause choice sits beside it and is stored per Account in this browser.
 */
export function DesktopNotificationsSettings({
  accountId,
}: {
  accountId?: string;
}) {
  const [permission, setPermission] = useState<DesktopNotificationPermission>(
    desktopNotificationPermission,
  );
  const [requesting, setRequesting] = useState(false);
  const pauseUntil = useDesktopNotificationPause(accountId);
  const pausedUntil =
    pauseUntil && isDesktopNotificationPaused(pauseUntil, new Date())
      ? pauseUntil
      : undefined;

  async function enable() {
    setRequesting(true);
    try {
      setPermission(await requestDesktopNotificationPermission());
    } finally {
      setRequesting(false);
    }
  }

  function pause(choice: DesktopNotificationPauseChoice) {
    setDesktopNotificationPause(
      accountId,
      desktopNotificationPauseUntil(choice, new Date()),
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-background p-6">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">
          Desktop notifications
        </h2>
        {permission === "default" ? (
          <Button
            loading={requesting}
            onClick={() => void enable()}
            size="compact"
            tone="secondary"
          >
            Enable
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {statusCopy[permission]}
      </p>
      {pausedUntil ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-foreground" role="status">
            Paused until{" "}
            <time dateTime={pausedUntil}>
              {pauseEndFormat.format(new Date(pausedUntil))}
            </time>
            .
          </p>
          <Button
            onClick={() => clearDesktopNotificationPause(accountId)}
            size="compact"
            tone="secondary"
          >
            Resume now
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Pause notifications:
          </span>
          <Button onClick={() => pause("hour")} size="compact" tone="secondary">
            Pause for 1 hour
          </Button>
          <Button
            onClick={() => pause("morning")}
            size="compact"
            tone="secondary"
          >
            Pause until tomorrow morning
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Unread mentions in Rooms you are not looking at appear while this window
        is in the background, unless that Room’s mentions are snoozed. The
        desktop app also shows the unread mention count on its icon.
      </p>
    </section>
  );
}
