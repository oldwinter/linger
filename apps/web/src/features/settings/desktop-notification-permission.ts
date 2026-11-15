/** How the Desktop notifications section reports what this browser can do. */
export type DesktopNotificationPermission =
  | NotificationPermission
  | "unsupported";

interface NotificationApi {
  permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
}

function notificationApi(): NotificationApi | undefined {
  return typeof Notification === "undefined" ? undefined : Notification;
}

/** What this browser reports right now, before any prompt of ours. */
export function desktopNotificationPermission(): DesktopNotificationPermission {
  return notificationApi()?.permission ?? "unsupported";
}

/**
 * Asks this browser for permission. A request that throws has changed nothing,
 * so the answer is the permission the browser still reports.
 */
export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  const api = notificationApi();
  if (!api) return "unsupported";
  try {
    return await api.requestPermission();
  } catch {
    return api.permission;
  }
}
