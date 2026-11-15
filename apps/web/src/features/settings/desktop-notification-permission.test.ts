import { afterEach, describe, expect, it, vi } from "vitest";

import {
  desktopNotificationPermission,
  requestDesktopNotificationPermission,
} from "./desktop-notification-permission";

function stubNotification(
  permission: NotificationPermission,
  requestPermission?: () => Promise<NotificationPermission>,
) {
  vi.stubGlobal("Notification", { permission, requestPermission });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Desktop notification permission", () => {
  it("reports unsupported when the browser has no Notification global", async () => {
    vi.stubGlobal("Notification", undefined);

    expect(desktopNotificationPermission()).toBe("unsupported");
    await expect(requestDesktopNotificationPermission()).resolves.toBe(
      "unsupported",
    );
  });

  it.each<NotificationPermission>(["default", "granted", "denied"])(
    "reports the browser's %s permission",
    (permission) => {
      stubNotification(permission);

      expect(desktopNotificationPermission()).toBe(permission);
    },
  );

  it("asks once and returns the answer", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    stubNotification("default", requestPermission);

    await expect(requestDesktopNotificationPermission()).resolves.toBe(
      "granted",
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("keeps the current permission when the request throws", async () => {
    const requestPermission = vi.fn(() =>
      Promise.reject(new Error("blocked by policy")),
    );
    stubNotification("default", requestPermission);

    await expect(requestDesktopNotificationPermission()).resolves.toBe(
      "default",
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});
