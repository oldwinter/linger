import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopNotificationsSettings } from "./desktop-notifications-settings";

function stubNotification(
  permission: NotificationPermission,
  requestPermission?: () => Promise<NotificationPermission>,
) {
  vi.stubGlobal("Notification", { permission, requestPermission });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Desktop notifications setting", () => {
  it("says the browser cannot show notifications and offers nothing", () => {
    vi.stubGlobal("Notification", undefined);

    render(<DesktopNotificationsSettings />);

    expect(
      screen.getByRole("heading", { name: "Desktop notifications" }),
    ).toBeVisible();
    expect(
      screen.getByText(/cannot show desktop notifications/u),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("offers Enable until the browser has decided", () => {
    stubNotification("default");

    render(<DesktopNotificationsSettings />);

    expect(screen.getByText(/Notifications are off/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Enable" })).toBeVisible();
  });

  it("says notifications are on once granted and offers no action", () => {
    stubNotification("granted");

    render(<DesktopNotificationsSettings />);

    expect(screen.getByText("Notifications are on.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("explains how to allow blocked notifications without a dead action", () => {
    stubNotification("denied");

    render(<DesktopNotificationsSettings />);

    expect(
      screen.getByText(/Allow notifications for this site/u),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("asks for permission and shows the answer in place", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    stubNotification("default", requestPermission);

    render(<DesktopNotificationsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    expect(await screen.findByText("Notifications are on.")).toBeVisible();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("keeps Enable when the browser refuses to answer", async () => {
    const requestPermission = vi.fn(() =>
      Promise.reject(new Error("blocked by policy")),
    );
    stubNotification("default", requestPermission);

    render(<DesktopNotificationsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Enable" })).toBeVisible();
    expect(screen.getByText(/Notifications are off/u)).toBeVisible();
  });
});
