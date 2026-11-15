import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigStore } from "./config.js";
import type { Logger } from "./log.js";
import { EventBus, ModuleHost, type Module } from "./modules.js";
import { tempDirectory } from "./test-support.js";

const fake = vi.hoisted(() => {
  const callbacks = new Map<string, () => void>();
  return {
    callbacks,
    getSwitchValue: vi.fn(() => ""),
    register: vi.fn((accelerator: string, callback: () => void) => {
      callbacks.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      callbacks.delete(accelerator);
    }),
  };
});

vi.mock("electron", () => ({
  app: { commandLine: { getSwitchValue: fake.getSwitchValue } },
  globalShortcut: {
    register: fake.register,
    unregister: fake.unregister,
  },
}));

const { GlobalShortcutModule, QUICK_NOTE_ACCELERATOR } =
  await import("./global-shortcut.js");

beforeEach(() => {
  vi.clearAllMocks();
  fake.callbacks.clear();
  fake.getSwitchValue.mockReturnValue("");
});

const setup = () => {
  const show = vi.fn();
  const logs: { event: string; fields?: Record<string, unknown> }[] = [];
  const log: Logger = {
    info: () => {},
    warn: (event, fields) => logs.push({ event, fields }),
    error: () => {},
  };
  const quickNote: Module & { show: () => void } = {
    name: "QuickNote",
    dependsOn: [],
    start: async () => {},
    stop: async () => {},
    show,
  };
  const module = new GlobalShortcutModule();
  const host = new ModuleHost([quickNote, module], {
    config: new ConfigStore(path.join(tempDirectory(), "config.json")),
    log,
    bus: new EventBus(),
  });
  return { host, logs, module, show };
};

describe("GlobalShortcut module", () => {
  it("registers the quick note accelerator and opens the note from it", async () => {
    const { host, show } = setup();

    await host.start();

    expect(QUICK_NOTE_ACCELERATOR).toBe("CommandOrControl+Shift+N");
    expect(fake.register).toHaveBeenCalledWith(
      QUICK_NOTE_ACCELERATOR,
      expect.any(Function),
    );
    fake.callbacks.get(QUICK_NOTE_ACCELERATOR)!();
    expect(show).toHaveBeenCalledTimes(1);

    await host.stop("quit");
  });

  it("skips registration without a display", async () => {
    fake.getSwitchValue.mockReturnValue("headless");
    const { host } = setup();

    await host.start();
    await host.stop("quit");

    expect(fake.getSwitchValue).toHaveBeenCalledWith("ozone-platform");
    expect(fake.register).not.toHaveBeenCalled();
    expect(fake.unregister).not.toHaveBeenCalled();
  });

  it("logs once and keeps running when registration is refused", async () => {
    fake.register.mockReturnValueOnce(false);
    const { host, logs, show } = setup();

    await expect(host.start()).resolves.toBeUndefined();

    expect(logs).toEqual([
      {
        event: "global_shortcut.unavailable",
        fields: { accelerator: QUICK_NOTE_ACCELERATOR },
      },
    ]);
    expect(show).not.toHaveBeenCalled();
    await expect(host.stop("quit")).resolves.toBeUndefined();
    expect(fake.unregister).not.toHaveBeenCalled();
  });

  it("unregisters its shortcut, and stopping twice is safe", async () => {
    const { host, module } = setup();
    await host.start();

    await module.stop();
    await module.stop();

    expect(fake.unregister.mock.calls).toEqual([[QUICK_NOTE_ACCELERATOR]]);
  });
});
