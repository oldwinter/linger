import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import {
  clearDesktopNotificationPauses,
  setDesktopNotificationPause,
} from "@/features/rooms/desktop-notification-pause";

import { DesktopNotificationsSettings } from "./desktop-notifications-settings";

function stubNotification(
  permission: NotificationPermission,
  requestPermission?: () => Promise<NotificationPermission>,
) {
  vi.stubGlobal("Notification", { permission, requestPermission });
}

beforeEach(() => {
  localStorage.clear();
});

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

const pauseEnd = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(iso));

describe("Desktop notifications pause", () => {
  it("pauses for an hour and says when the pause ends", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 15, 9, 30));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    stubNotification("granted");

    render(<DesktopNotificationsSettings accountId="account-a" />);
    expect(
      screen.getByRole("button", { name: "Pause until tomorrow morning" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Pause for 1 hour" }));

    const until = new Date(2026, 10, 15, 10, 30).toISOString();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(`Paused until ${pauseEnd(until)}.`);
    expect(within(status).getByText(pauseEnd(until))).toHaveAttribute(
      "datetime",
      until,
    );
    expect(screen.getByRole("button", { name: "Resume now" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Pause for 1 hour" }),
    ).toBeNull();
  });

  it("shows a stored pause on open and resumes it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 15, 9, 30));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    stubNotification("granted");
    setDesktopNotificationPause("account-a", new Date(2026, 10, 15, 10, 30));

    render(<DesktopNotificationsSettings accountId="account-a" />);

    expect(screen.getByRole("status")).toHaveTextContent("Paused until");
    fireEvent.click(screen.getByRole("button", { name: "Resume now" }));

    expect(
      screen.getByRole("button", { name: "Pause for 1 hour" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume now" })).toBeNull();
    expect(
      localStorage.getItem("desktop-notification-pause.v1:account-a"),
    ).toBeNull();
  });

  it("returns to unpaused when this browser's preferences are cleared", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 15, 9, 30));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    stubNotification("granted");
    setDesktopNotificationPause("account-a", new Date(2026, 10, 15, 10, 30));

    render(<DesktopNotificationsSettings accountId="account-a" />);
    expect(screen.getByRole("button", { name: "Resume now" })).toBeVisible();

    act(() => clearDesktopNotificationPauses());

    expect(
      screen.getByRole("button", { name: "Pause for 1 hour" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume now" })).toBeNull();
    expect(
      localStorage.getItem("desktop-notification-pause.v1:account-a"),
    ).toBeNull();
  });
});
