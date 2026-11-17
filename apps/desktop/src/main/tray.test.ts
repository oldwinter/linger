import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  toolTips: [] as string[],
  menus: [] as Array<Array<{ label?: string; click?: () => void }>>,
  response: 1,
}));

vi.mock("electron", () => ({
  app: { commandLine: { getSwitchValue: () => "" } },
  dialog: {
    showMessageBox: async () => ({ response: fake.response }),
  },
  Menu: {
    buildFromTemplate: (
      template: Array<{ label?: string; click?: () => void }>,
    ) => {
      fake.menus.push(template);
      return {};
    },
  },
  Tray: class {
    setToolTip(value: string): void {
      fake.toolTips.push(value);
    }
    setImage(): void {}
    setContextMenu(): void {}
    on(): void {}
    destroy(): void {}
  },
  nativeImage: {
    createEmpty: () => ({
      addRepresentation: () => {},
      setTemplateImage: () => {},
    }),
  },
}));

vi.mock("./tray-icon.js", () => ({ renderTrayIcon: () => Buffer.alloc(0) }));

const { TrayModule } = await import("./tray.js");
const { EventBus } = await import("./modules.js");
const { stubModule, testHost } = await import("./test-support.js");

const startTray = async () => {
  const status = { label: "Online · Idle", tone: "online" as const };
  const bus = new EventBus();
  const tray = new TrayModule({ quit: () => {} });
  const host = testHost(
    [
      { ...stubModule("Status"), current: () => ({ ...status }) } as never,
      { ...stubModule("PowerGuard"), alwaysOn: () => false } as never,
      stubModule("WindowManager"),
      stubModule("Enrollment"),
      { ...stubModule("SetupWindow"), showApp: () => {} } as never,
      stubModule("QuickNote"),
      {
        ...stubModule("Updater"),
        state: () => ({ kind: "idle" as const }),
      } as never,
      { ...stubModule("Diagnostics"), uploadUrl: () => undefined } as never,
      tray,
    ],
    {},
    bus,
  );
  await host.start();
  return {
    bus,
    host,
    status,
    tray,
    toolTip: () => fake.toolTips.at(-1),
  };
};

describe("TrayModule tooltip", () => {
  it("keeps the status alone while nothing is unread", async () => {
    const f = await startTray();

    expect(f.toolTip()).toBe("Linger · Online · Idle");
    f.tray.setUnreadCount(0);
    expect(f.toolTip()).toBe("Linger · Online · Idle");
    await f.host.stop("quit");
  });

  it("names one unread and a large count", async () => {
    const f = await startTray();

    f.tray.setUnreadCount(1);
    expect(f.toolTip()).toBe("Linger · Online · Idle · 1 unread mention");
    f.tray.setUnreadCount(1_234);
    expect(f.toolTip()).toBe("Linger · Online · Idle · 1234 unread mentions");
    f.tray.setUnreadCount(0);
    expect(f.toolTip()).toBe("Linger · Online · Idle");
    await f.host.stop("quit");
  });

  it("follows status updates while nothing is unread", async () => {
    const f = await startTray();

    f.status.label = "Running 2 Tasks";
    f.bus.emit("status.changed", { tone: "busy", label: f.status.label });

    expect(f.toolTip()).toBe("Linger · Running 2 Tasks");
    await f.host.stop("quit");
  });

  it("keeps both parts when the status changes after a count", async () => {
    const f = await startTray();
    f.tray.setUnreadCount(3);

    f.status.label = "Running 2 Tasks";
    f.bus.emit("status.changed", { tone: "busy", label: f.status.label });

    expect(f.toolTip()).toBe("Linger · Running 2 Tasks · 3 unread mentions");
    await f.host.stop("quit");
  });

  it("offers Set Up Again on identity conflict and triggers reset when confirmed", async () => {
    const bus = new EventBus();
    const tray = new TrayModule({ quit: () => {} });
    const reset = vi.fn();
    bus.on("local-server.reset", reset);
    const host = testHost(
      [
        {
          ...stubModule("Status"),
          current: () => ({
            tone: "error" as const,
            label: "Identity Conflict · Set Up Again",
          }),
        } as never,
        { ...stubModule("PowerGuard"), alwaysOn: () => false } as never,
        { ...stubModule("WindowManager"), window: () => undefined } as never,
        stubModule("Enrollment"),
        { ...stubModule("SetupWindow"), showApp: () => {} } as never,
        stubModule("QuickNote"),
        {
          ...stubModule("Updater"),
          state: () => ({ kind: "idle" as const }),
        } as never,
        { ...stubModule("Diagnostics"), uploadUrl: () => undefined } as never,
        tray,
      ],
      { computerId: "cmp_1", identityConflict: true },
      bus,
    );
    await host.start();
    const item = fake.menus
      .at(-1)
      ?.find((entry) => entry.label === "Set Up Again…");
    expect(item?.click).toBeTypeOf("function");

    fake.response = 0;
    item!.click!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reset).not.toHaveBeenCalled();

    fake.response = 1;
    item!.click!();
    await vi.waitFor(() => expect(reset).toHaveBeenCalledOnce());
    await host.stop("quit");
  });
});
