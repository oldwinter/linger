import { afterEach, describe, expect, it, vi } from "vitest";

import { IPC } from "../shared/api.js";

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown,
    ) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));

const { DesktopIpcModule } = await import("./desktop-ipc.js");
const { stubModule, testHost } = await import("./test-support.js");

const SERVER = "http://localhost:3000";
const PASSWORD = "a-private-password";

const fixture = async (
  localServer: {
    servesWindow?: () => Promise<boolean>;
    signInWithAccount?: () => Promise<void>;
  } = {},
  badge?: { setBadgeCount: (count: number) => boolean },
  tray?: { setUnreadCount: (count: number) => void },
) => {
  const local = {
    ...stubModule("LocalServer"),
    servesWindow: vi.fn(localServer.servesWindow ?? (async () => true)),
    signInWithAccount: vi.fn(localServer.signInWithAccount ?? (async () => {})),
  };
  const host = testHost(
    [
      stubModule("Enrollment"),
      stubModule("PowerGuard"),
      stubModule("ComputerDaemon"),
      stubModule("WindowManager"),
      stubModule("WorkspaceGrants"),
      stubModule("Tray"),
      local as never,
      new DesktopIpcModule({
        defaultDisplayName: "Desk",
        ...(badge ? { badge } : {}),
        ...(tray ? { tray } : {}),
      }),
    ],
    { serverUrl: SERVER },
  );
  await host.start();
  const invoke = (channel: string, origin = SERVER, ...args: unknown[]) =>
    handlers.get(channel)!({ senderFrame: { origin } }, ...args);
  return { host, local, invoke };
};

afterEach(() => handlers.clear());

describe("DesktopIpcModule local account", () => {
  it("offers the account only for the installed server", async () => {
    const f = await fixture({ servesWindow: async () => false });
    expect(await f.invoke(IPC.localAccountAvailable)).toBe(false);
    f.local.servesWindow.mockResolvedValue(true);
    expect(await f.invoke(IPC.localAccountAvailable)).toBe(true);
    await f.host.stop("quit");
  });

  it("rejects pages from any other origin", async () => {
    const f = await fixture();
    expect(() =>
      f.invoke(IPC.localAccountSignIn, "https://evil.example.com"),
    ).toThrow("Not allowed");
    expect(() =>
      f.invoke(IPC.localAccountAvailable, "https://evil.example.com"),
    ).toThrow("Not allowed");
    expect(f.local.signInWithAccount).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });

  it("signs in and returns no account data to the page", async () => {
    const f = await fixture();
    expect(await f.invoke(IPC.localAccountSignIn)).toEqual({ ok: true });
    expect(f.local.signInWithAccount).toHaveBeenCalledOnce();
    await f.host.stop("quit");
  });

  it("returns why signing in failed", async () => {
    const f = await fixture({
      signInWithAccount: async () => {
        throw new Error(
          "The local account file must be private and owned by the current user (chmod 600).",
        );
      },
    });
    const result = await f.invoke(IPC.localAccountSignIn);
    expect(result).toEqual({
      ok: false,
      message:
        "The local account file must be private and owned by the current user (chmod 600).",
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    await f.host.stop("quit");
  });
});

describe("DesktopIpcModule unread badge", () => {
  it("sets and clears the app badge through the fake app", async () => {
    const app = { setBadgeCount: vi.fn(() => true) };
    const f = await fixture({}, app);

    await f.invoke(IPC.notificationsBadge, SERVER, 7);
    expect(app.setBadgeCount).toHaveBeenLastCalledWith(7);

    await f.invoke(IPC.notificationsBadge, SERVER, 0);
    expect(app.setBadgeCount).toHaveBeenLastCalledWith(0);
    expect(app.setBadgeCount).toHaveBeenCalledTimes(2);
    await f.host.stop("quit");
  });

  it("names the same count in the app badge and the tray tooltip", async () => {
    const app = { setBadgeCount: vi.fn(() => true) };
    const tray = { setUnreadCount: vi.fn() };
    const f = await fixture({}, app, tray);

    await f.invoke(IPC.notificationsBadge, SERVER, 5);

    expect(app.setBadgeCount).toHaveBeenLastCalledWith(5);
    expect(tray.setUnreadCount).toHaveBeenLastCalledWith(5);
    await f.host.stop("quit");
  });

  it("names the count in the tray where the platform has no count badge", async () => {
    const tray = { setUnreadCount: vi.fn() };
    const f = await fixture({}, undefined, tray);

    await f.invoke(IPC.notificationsBadge, SERVER, 4);

    expect(tray.setUnreadCount).toHaveBeenLastCalledWith(4);
    await f.host.stop("quit");
  });

  it("rejects another origin and counts that are not badge counts", async () => {
    const app = { setBadgeCount: vi.fn(() => true) };
    const tray = { setUnreadCount: vi.fn() };
    const f = await fixture({}, app, tray);

    expect(() =>
      f.invoke(IPC.notificationsBadge, "https://evil.example.com", 3),
    ).toThrow("Not allowed");
    for (const count of [-1, 1.5, "3", null]) {
      expect(() => f.invoke(IPC.notificationsBadge, SERVER, count)).toThrow();
    }
    expect(app.setBadgeCount).not.toHaveBeenCalled();
    expect(tray.setUnreadCount).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });

  it("does nothing where the platform has no count badge", async () => {
    const f = await fixture();
    expect(await f.invoke(IPC.notificationsBadge, SERVER, 3)).toBeUndefined();
    await f.host.stop("quit");
  });

  it("reports a persisted identity conflict in computerStatus before the daemon emits", async () => {
    const host = testHost(
      [
        stubModule("Enrollment"),
        { ...stubModule("PowerGuard"), active: () => false } as never,
        {
          ...stubModule("ComputerDaemon"),
          connection: () => "disconnected",
          state: () => "stopped",
          running: () => 0,
          connectionError: () => undefined,
        } as never,
        stubModule("WindowManager"),
        stubModule("WorkspaceGrants"),
        stubModule("Tray"),
        stubModule("LocalServer"),
        new DesktopIpcModule({ defaultDisplayName: "Desk" }),
      ],
      { serverUrl: SERVER, computerId: "cmp_1", identityConflict: true },
    );
    await host.start();
    const result = await handlers.get(IPC.computerStatus)!({
      senderFrame: { origin: SERVER },
    });
    expect(result).toMatchObject({
      computerId: "cmp_1",
      connectionError: "daemon_identity_conflict",
    });
    await host.stop("quit");
  });
});
