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
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import { accountSettingsMessages as m } from "./account-settings.messages";

const statusCopy: Record<DesktopNotificationPermission, Message<string>> = {
  denied: m.notificationsDenied,
  default: m.notificationsDefault,
  granted: m.notificationsGranted,
  unsupported: m.notificationsUnsupported,
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
  const t = useT();
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
          {t(m.desktopNotifications)}
        </h2>
        {permission === "default" ? (
          <Button
            loading={requesting}
            onClick={() => void enable()}
            size="compact"
            tone="secondary"
          >
            {t(m.enable)}
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {t(statusCopy[permission])}
      </p>
      {permission === "granted" ? (
        pausedUntil ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-sm text-foreground" role="status">
              {t(m.pausedUntil)}{" "}
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
              {t(m.resumeNow)}
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t(m.pauseNotifications)}
            </span>
            <Button
              onClick={() => pause("hour")}
              size="compact"
              tone="secondary"
            >
              {t(m.pauseForHour)}
            </Button>
            <Button
              onClick={() => pause("morning")}
              size="compact"
              tone="secondary"
            >
              {t(m.pauseUntilMorning)}
            </Button>
          </div>
        )
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        {t(m.desktopNotificationsFooter)}
      </p>
    </section>
  );
}
