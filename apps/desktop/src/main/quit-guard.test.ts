import { describe, expect, it, vi } from "vitest";

import { createQuitGuard, type QuitGuardOptions } from "./quit-guard.js";

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function setup(
  overrides: Partial<{
    busy: boolean;
    automatic: boolean;
    confirm: () => Promise<boolean>;
    stopHost: (reason: "quit" | "update") => Promise<void>;
  }> = {},
) {
  const state = {
    busy: overrides.busy ?? false,
    automatic: overrides.automatic ?? false,
  };
  const confirmBusyQuit = vi.fn(overrides.confirm ?? (async () => true));
  const prepareQuit = vi.fn();
  const stopHost = vi.fn(
    overrides.stopHost ?? (async (_reason: "quit" | "update") => {}),
  );
  const relaunchIfNeeded = vi.fn();
  const exitApp = vi.fn();
  const requestAppQuit = vi.fn(() => {
    guard.handleBeforeQuit({ preventDefault: vi.fn() });
  });
  const options: QuitGuardOptions = {
    isBusy: () => state.busy,
    isAutomaticQuit: () => state.automatic,
    confirmBusyQuit,
    prepareQuit,
    stopHost,
    requestAppQuit,
    relaunchIfNeeded,
    exitApp,
  };
  const guard = createQuitGuard(options);
  return {
    state,
    guard,
    confirmBusyQuit,
    prepareQuit,
    stopHost,
    requestAppQuit,
    relaunchIfNeeded,
    exitApp,
  };
}

describe("createQuitGuard", () => {
  it("intercepts Cmd+Q / before-quit when tasks are running and aborts cleanly when cancelled", async () => {
    const f = setup({ busy: true, confirm: async () => false });
    const event = { preventDefault: vi.fn() };

    f.guard.handleBeforeQuit(event);
    await flush();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.confirmBusyQuit).toHaveBeenCalledOnce();
    expect(f.prepareQuit).not.toHaveBeenCalled();
    expect(f.requestAppQuit).not.toHaveBeenCalled();
    expect(f.stopHost).not.toHaveBeenCalled();
    expect(f.exitApp).not.toHaveBeenCalled();

    // Pressing Cmd+Q again later prompts again cleanly.
    const secondEvent = { preventDefault: vi.fn() };
    f.guard.handleBeforeQuit(secondEvent);
    await flush();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(f.confirmBusyQuit).toHaveBeenCalledTimes(2);
    expect(f.exitApp).not.toHaveBeenCalled();
  });

  it("proceeds without looping when Cmd+Q / before-quit is confirmed during running tasks", async () => {
    const f = setup({ busy: true, confirm: async () => true });
    const event = { preventDefault: vi.fn() };

    f.guard.handleBeforeQuit(event);
    await flush();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.confirmBusyQuit).toHaveBeenCalledOnce();
    expect(f.requestAppQuit).toHaveBeenCalledOnce();
    expect(f.prepareQuit).toHaveBeenCalledOnce();
    expect(f.stopHost).toHaveBeenCalledExactlyOnceWith("quit");
    expect(f.relaunchIfNeeded).toHaveBeenCalledOnce();
    expect(f.exitApp).toHaveBeenCalledOnce();
  });

  it("quits immediately without confirmation when idle", async () => {
    const f = setup({ busy: false });
    const event = { preventDefault: vi.fn() };

    f.guard.handleBeforeQuit(event);
    await flush();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.confirmBusyQuit).not.toHaveBeenCalled();
    expect(f.prepareQuit).toHaveBeenCalledOnce();
    expect(f.stopHost).toHaveBeenCalledExactlyOnceWith("quit");
    expect(f.exitApp).toHaveBeenCalledOnce();
  });

  it("deduplicates repeated Cmd+Q or Tray quit attempts while confirmation is open", async () => {
    let resolveConfirm!: (value: boolean) => void;
    const f = setup({
      busy: true,
      confirm: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    });
    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };

    f.guard.handleBeforeQuit(first);
    f.guard.handleBeforeQuit(second);
    void f.guard.requestQuit();

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(f.confirmBusyQuit).toHaveBeenCalledOnce();

    resolveConfirm(true);
    await flush();
    expect(f.stopHost).toHaveBeenCalledExactlyOnceWith("quit");
    expect(f.exitApp).toHaveBeenCalledOnce();
  });

  it("funnels Tray requestQuit through the same confirmation without double prompting", async () => {
    const f = setup({ busy: true, confirm: async () => true });

    await f.guard.requestQuit();
    await flush();

    expect(f.confirmBusyQuit).toHaveBeenCalledOnce();
    expect(f.requestAppQuit).toHaveBeenCalledOnce();
    expect(f.prepareQuit).toHaveBeenCalledOnce();
    expect(f.stopHost).toHaveBeenCalledExactlyOnceWith("quit");
    expect(f.exitApp).toHaveBeenCalledOnce();
  });

  it("bypasses confirmation for automatic updater or installer --quit exits even while busy", async () => {
    const f = setup({ busy: true, automatic: true });
    const event = { preventDefault: vi.fn() };

    f.guard.handleBeforeQuit(event);
    await flush();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.confirmBusyQuit).not.toHaveBeenCalled();
    expect(f.prepareQuit).toHaveBeenCalledOnce();
    expect(f.stopHost).toHaveBeenCalledExactlyOnceWith("update");
    expect(f.relaunchIfNeeded).toHaveBeenCalledOnce();
    expect(f.exitApp).toHaveBeenCalledOnce();
  });

  it("prevents a second before-quit from cutting off an in-flight shutdown", async () => {
    let finishStop!: () => void;
    const f = setup({
      busy: false,
      stopHost: () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    });
    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };

    f.guard.handleBeforeQuit(first);
    f.guard.handleBeforeQuit(second);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(f.stopHost).toHaveBeenCalledOnce();
    expect(f.exitApp).not.toHaveBeenCalled();

    finishStop();
    await flush();
    expect(f.exitApp).toHaveBeenCalledOnce();
  });
});
