// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Language } from "../i18n/language.js";
import zhCN from "../i18n/locales/zh-CN.json" with { type: "json" };
import { localizePage } from "../i18n/page.js";
import type {
  LingerMobileCompanionApi,
  MobileCompanionCommand,
  MobileCompanionState,
} from "../shared/mobile-companion.js";
import { mobileCompanionMessages } from "./mobile-companion.messages.js";

const shellFile = (name: string): string =>
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), name),
    "utf8",
  );

const rawPage = shellFile("mobile-companion.html");
const messagesRuntime = shellFile("messages.html");

const SAMPLE_QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#ffffff"/><path fill="#1a1a16" d="M4 4h7v1h-7z"/></svg>';

function makeState(
  overrides: Partial<MobileCompanionState> = {},
): MobileCompanionState {
  const now = Date.now();
  return {
    running: true,
    hostId: "host_1",
    hostName: "Studio Mac",
    desktopVersion: "0.16.20",
    tlsFingerprint: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE",
    shortFingerprint: "A1B2-C3D4-E5F6-0718",
    addresses: {
      lan: ["192.168.1.42"],
      tailscale: ["100.64.12.8"],
    },
    listenPort: 48210,
    mdnsActive: true,
    config: {
      enabled: true,
      port: 48210,
      advertiseMdns: true,
      tls: true,
      customHost: "mac.tailnet.ts.net",
    },
    pairing: {
      pairId: "pair_1",
      pin: "482910",
      pairingUri:
        "lingerx://pair?v=1&host=mac.tailnet.ts.net&port=48210&tls=1&fp=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE&code=secret",
      qrSvg: SAMPLE_QR_SVG,
      expiresAt: now + 5 * 60 * 1000,
    },
    devices: [
      {
        deviceId: "dev_1",
        deviceName: "Alex's iPhone 16 Pro",
        platform: "ios",
        appVersion: "1.2.0",
        createdAt: new Date(now - 3_600_000).toISOString(),
        lastSeenAt: new Date(now - 10_000).toISOString(),
        sessionMode: "dedicated",
        activeSse: true,
        activeConnections: 1,
      },
      {
        deviceId: "dev_2",
        deviceName: "Pixel 9",
        platform: "android",
        appVersion: "1.2.0",
        createdAt: new Date(now - 7_200_000).toISOString(),
        lastSeenAt: new Date(now - 180_000).toISOString(),
        sessionMode: "delegated",
        activeSse: false,
        activeConnections: 0,
      },
    ],
    ...overrides,
  };
}

interface MountedPage {
  readonly run: ReturnType<typeof vi.fn>;
  readonly getState: ReturnType<typeof vi.fn>;
  readonly pushState: (state: MobileCompanionState) => void;
  readonly clipboardWrite: ReturnType<typeof vi.fn>;
}

async function mountPage(
  options: {
    readonly language?: Language;
    readonly initialState?: MobileCompanionState;
    readonly runImpl?: (
      command: MobileCompanionCommand,
    ) => Promise<MobileCompanionState>;
    readonly getStateImpl?: () => Promise<MobileCompanionState>;
    readonly clipboardImpl?: (text: string) => Promise<void>;
  } = {},
): Promise<MountedPage> {
  const language = options.language ?? "en";
  let current = options.initialState ?? makeState();
  let stateListener: ((state: MobileCompanionState) => void) | undefined;

  const getState = vi.fn(options.getStateImpl ?? (async () => current));
  const run = vi.fn(
    options.runImpl ??
      (async (command: MobileCompanionCommand) => {
        if (command.op === "device.revoke") {
          current = {
            ...current,
            devices: current.devices.filter(
              (device) => device.deviceId !== command.deviceId,
            ),
          };
        } else if (command.op === "device.revokeAll") {
          current = { ...current, devices: [] };
        } else if (command.op === "pairing.close") {
          const { pairing: _removed, ...rest } = current;
          current = rest;
        } else if (command.op === "pairing.open") {
          current = {
            ...current,
            pairing: {
              pairId: "pair_new",
              pin: "654321",
              pairingUri: "lingerx://pair?v=1&host=mac.tailnet.ts.net",
              qrSvg: SAMPLE_QR_SVG,
              expiresAt: Date.now() + 5 * 60 * 1000,
            },
          };
        } else if (command.op === "config.update") {
          const customHost =
            command.patch.customHost === undefined
              ? current.config.customHost
              : command.patch.customHost || undefined;
          const enabled = command.patch.enabled ?? current.config.enabled;
          current = {
            ...current,
            running: enabled,
            listenPort: command.patch.port ?? current.config.port,
            config: {
              enabled,
              port: command.patch.port ?? current.config.port,
              tls: command.patch.tls ?? current.config.tls,
              advertiseMdns:
                command.patch.advertiseMdns ?? current.config.advertiseMdns,
              ...(customHost ? { customHost } : {}),
            },
          };
        }
        return current;
      }),
  );

  const api: LingerMobileCompanionApi = {
    getState,
    onState: (listener) => {
      stateListener = listener;
      return () => {
        if (stateListener === listener) stateListener = undefined;
      };
    },
    run,
  };
  (
    window as unknown as { lingerMobileCompanion: LingerMobileCompanionApi }
  ).lingerMobileCompanion = api;

  const clipboardWrite = vi.fn(options.clipboardImpl ?? (async () => {}));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite },
  });

  const page = localizePage(
    rawPage,
    messagesRuntime,
    mobileCompanionMessages,
    language,
  );
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/u.exec(page);
  expect(bodyMatch).not.toBeNull();
  const body = bodyMatch![1]!;
  const jsonMatch =
    /<script type="application\/json" id="linger-messages">([\s\S]*?)<\/script>/u.exec(
      body,
    );
  expect(jsonMatch).not.toBeNull();

  const scriptMatch = /<script>([\s\S]*)<\/script>/u.exec(body);
  expect(scriptMatch).not.toBeNull();

  document.body.innerHTML = body.replace(/<script[\s\S]*<\/script>/u, "");
  const json = document.createElement("script");
  json.type = "application/json";
  json.id = "linger-messages";
  json.textContent = jsonMatch![1]!;
  document.body.appendChild(json);

  new Function(scriptMatch![1]!)();

  await Promise.resolve();
  await Promise.resolve();

  return {
    run,
    getState,
    clipboardWrite,
    pushState: (next) => {
      current = next;
      stateListener?.(next);
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T12:00:00.000Z"));
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mobile-companion.html UX, accessibility, security, and dark mode", () => {
  it("requires explicit inline confirmation for Revoke and Revoke All, supports Cancel and Escape, and manages focus", async () => {
    const mounted = await mountPage();

    const revokeBtn = document.querySelector<HTMLButtonElement>(
      'button[data-revoke-device-id="dev_1"]',
    )!;
    expect(revokeBtn).not.toBeNull();
    revokeBtn.click();

    // First click must never revoke immediately.
    expect(mounted.run).not.toHaveBeenCalled();
    const confirmGroup = document.querySelector(".device-confirm");
    expect(confirmGroup?.textContent).toContain("Revoke Alex's iPhone 16 Pro?");
    const cancelBtn = document.querySelector<HTMLButtonElement>(
      'button[data-confirm-cancel="device"]',
    )!;
    expect(document.activeElement).toBe(cancelBtn);

    // Clicking Cancel sends no command and restores focus to the device Revoke trigger.
    cancelBtn.click();
    expect(mounted.run).not.toHaveBeenCalled();
    expect(document.querySelector(".device-confirm")).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector('button[data-revoke-device-id="dev_1"]'),
    );

    // Re-open confirmation and cancel via Escape key.
    document
      .querySelector<HTMLButtonElement>(
        'button[data-revoke-device-id="dev_1"]',
      )!
      .click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(mounted.run).not.toHaveBeenCalled();
    expect(document.querySelector(".device-confirm")).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector('button[data-revoke-device-id="dev_1"]'),
    );

    // Confirm Revoke executes device.revoke.
    document
      .querySelector<HTMLButtonElement>(
        'button[data-revoke-device-id="dev_1"]',
      )!
      .click();
    document
      .querySelector<HTMLButtonElement>(
        'button[data-confirm-revoke-device-id="dev_1"]',
      )!
      .click();
    await flushMicrotasks();
    expect(mounted.run).toHaveBeenCalledWith({
      op: "device.revoke",
      deviceId: "dev_1",
    });

    // Revoke All names the exact remaining count (1 -> singular) and requires confirmation.
    const revokeAllBtn = document.getElementById(
      "revoke-all-btn",
    ) as HTMLButtonElement;
    revokeAllBtn.click();
    expect(mounted.run).toHaveBeenCalledTimes(1);
    const revokeAllConfirm = document.getElementById("revoke-all-confirm")!;
    expect(revokeAllConfirm.classList.contains("hidden")).toBe(false);
    expect(
      document.getElementById("revoke-all-confirm-text")?.textContent,
    ).toBe("Revoke 1 paired device? It will lose access immediately.");
    expect(document.activeElement).toBe(
      document.getElementById("cancel-revoke-all-btn"),
    );

    // Escape cancels Revoke All and restores focus to Revoke All button.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(revokeAllConfirm.classList.contains("hidden")).toBe(true);
    expect(document.activeElement).toBe(revokeAllBtn);
    expect(mounted.run).toHaveBeenCalledTimes(1);

    // Confirm Revoke All executes device.revokeAll.
    revokeAllBtn.click();
    document.getElementById("confirm-revoke-all-btn")!.click();
    await flushMicrotasks();
    expect(mounted.run).toHaveBeenLastCalledWith({ op: "device.revokeAll" });
    expect(document.getElementById("devices-count")?.textContent).toBe("0");
  });

  it("locks controls with busy copy during in-flight commands and restores enabled state in finally even on rejection", async () => {
    let rejectRun!: (reason: Error) => void;
    const mounted = await mountPage({
      runImpl: () =>
        new Promise<MobileCompanionState>((_resolve, reject) => {
          rejectRun = reject;
        }),
    });

    // Make settings dirty so Save Settings is enabled.
    const portInput = document.getElementById("input-port") as HTMLInputElement;
    portInput.value = "48215";
    portInput.dispatchEvent(new Event("input"));

    const saveBtn = document.getElementById(
      "save-settings-btn",
    ) as HTMLButtonElement;
    const openPairBtn = document.getElementById(
      "open-pair-btn",
    ) as HTMLButtonElement;
    const toggle = document.getElementById(
      "toggle-enabled",
    ) as HTMLInputElement;

    saveBtn.click();
    expect(mounted.run).toHaveBeenCalledTimes(1);
    expect(saveBtn.disabled).toBe(true);
    expect(saveBtn.textContent).toBe("Saving\u2026");
    expect(openPairBtn.disabled).toBe(true);
    expect(toggle.disabled).toBe(true);
    expect(portInput.disabled).toBe(true);

    // Conflicting concurrent clicks are ignored while in flight.
    openPairBtn.click();
    expect(mounted.run).toHaveBeenCalledTimes(1);

    // Rejecting the IPC promise restores controls and surfaces error without discarding edits.
    rejectRun(new Error("Port already in use"));
    await flushMicrotasks();

    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.textContent).toBe("Save Settings");
    expect(openPairBtn.disabled).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(portInput.disabled).toBe(false);
    expect(portInput.value).toBe("48215");
    expect(document.getElementById("error-banner")?.textContent).toBe(
      "Port already in use",
    );
    expect(
      document.getElementById("unsaved-badge")?.classList.contains("hidden"),
    ).toBe(false);
  });

  it("reverts gateway switch state cleanly when toggle command rejects", async () => {
    await mountPage({
      runImpl: async () => {
        throw new Error("Gateway failed to stop");
      },
    });

    const toggle = document.getElementById(
      "toggle-enabled",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await flushMicrotasks();

    expect(toggle.checked).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(false);
    expect(document.getElementById("error-banner")?.textContent).toBe(
      "Gateway failed to stop",
    );
  });

  it("provides one-click Copy PIN, Copy TLS Pin, and Copy Pairing Link with Copied feedback, aria-live announcements, and failure handling", async () => {
    const mounted = await mountPage();
    const liveStatus = document.getElementById("live-status")!;
    const copyPinBtn = document.getElementById(
      "copy-pin-btn",
    ) as HTMLButtonElement;
    const copyTlsBtn = document.getElementById(
      "copy-tls-pin-btn",
    ) as HTMLButtonElement;
    const copyUriBtn = document.getElementById(
      "copy-uri-btn",
    ) as HTMLButtonElement;

    // Copy PIN writes raw 6-digit PIN without space and announces politely.
    copyPinBtn.click();
    await flushMicrotasks();
    expect(mounted.clipboardWrite).toHaveBeenCalledWith("482910");
    expect(copyPinBtn.textContent).toBe("Copied");
    expect(liveStatus.textContent).toBe("Pairing PIN copied to clipboard.");

    vi.advanceTimersByTime(1600);
    expect(copyPinBtn.textContent).toBe("Copy PIN");

    // Copy TLS Pin writes displayed shortFingerprint.
    copyTlsBtn.click();
    await flushMicrotasks();
    expect(mounted.clipboardWrite).toHaveBeenLastCalledWith(
      "A1B2-C3D4-E5F6-0718",
    );
    expect(copyTlsBtn.textContent).toBe("Copied");
    expect(liveStatus.textContent).toBe("TLS Pin copied to clipboard.");

    vi.advanceTimersByTime(1600);
    expect(copyTlsBtn.textContent).toBe("Copy TLS Pin");

    // Copy Pairing Link succeeds through IPC.
    copyUriBtn.click();
    await flushMicrotasks();
    expect(mounted.run).toHaveBeenCalledWith({ op: "pairing.copyUri" });
    expect(copyUriBtn.textContent).toBe("Copied");
    expect(liveStatus.textContent).toBe("Pairing link copied to clipboard.");

    // Clipboard failure shows error banner and does NOT flash Copied.
    mounted.clipboardWrite.mockRejectedValueOnce(new Error("denied"));
    copyPinBtn.click();
    await flushMicrotasks();
    expect(copyPinBtn.textContent).toBe("Copy PIN");
    expect(document.getElementById("error-banner")?.textContent).toBe(
      "Could not copy to clipboard.",
    );
  });

  it("tracks settingsDirty accurately against saved state and shows TLS disabled warning immediately", async () => {
    const mounted = await mountPage();

    const unsavedBadge = document.getElementById("unsaved-badge")!;
    const saveBtn = document.getElementById(
      "save-settings-btn",
    ) as HTMLButtonElement;
    const tlsCheckbox = document.getElementById(
      "input-tls",
    ) as HTMLInputElement;
    const tlsWarning = document.getElementById("tls-warning")!;
    const portInput = document.getElementById("input-port") as HTMLInputElement;

    // Clean on initial load.
    expect(unsavedBadge.classList.contains("hidden")).toBe(true);
    expect(saveBtn.disabled).toBe(true);
    expect(tlsWarning.classList.contains("hidden")).toBe(true);

    // Unchecking Require TLS 1.3 immediately reveals warning and marks settings dirty.
    tlsCheckbox.checked = false;
    tlsCheckbox.dispatchEvent(new Event("change"));
    expect(tlsWarning.classList.contains("hidden")).toBe(false);
    expect(tlsWarning.textContent).toContain("will not be encrypted");
    expect(unsavedBadge.classList.contains("hidden")).toBe(false);
    expect(saveBtn.disabled).toBe(false);

    // Re-checking restores clean state automatically.
    tlsCheckbox.checked = true;
    tlsCheckbox.dispatchEvent(new Event("change"));
    expect(tlsWarning.classList.contains("hidden")).toBe(true);
    expect(unsavedBadge.classList.contains("hidden")).toBe(true);
    expect(saveBtn.disabled).toBe(true);

    // Invalid port blocks save with error message.
    portInput.value = "80";
    portInput.dispatchEvent(new Event("input"));
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    expect(mounted.run).not.toHaveBeenCalled();
    expect(document.getElementById("error-banner")?.textContent).toBe(
      "Port must be an integer between 1024 and 65535.",
    );

    // Valid edit saves and clears dirty badge.
    portInput.value = "48300";
    portInput.dispatchEvent(new Event("input"));
    saveBtn.click();
    await flushMicrotasks();
    expect(mounted.run).toHaveBeenCalledWith({
      op: "config.update",
      patch: {
        port: 48300,
        tls: true,
        advertiseMdns: true,
        customHost: "mac.tailnet.ts.net",
      },
    });
    expect(unsavedBadge.classList.contains("hidden")).toBe(true);
    expect(saveBtn.disabled).toBe(true);
  });

  it("renders human-readable sessionMode labels and shows calm pairing expiry explanation instead of hiding silently", async () => {
    const mounted = await mountPage();

    const listText = document.getElementById("device-list")?.textContent ?? "";
    expect(listText).toContain("Dedicated device session");
    expect(listText).toContain("Shared desktop session");
    expect(listText).not.toContain("delegated");

    const pairingBox = document.getElementById("pairing-box")!;
    const expiredBox = document.getElementById("pairing-expired-box")!;
    const openPairBtn = document.getElementById(
      "open-pair-btn",
    ) as HTMLButtonElement;

    expect(pairingBox.classList.contains("hidden")).toBe(false);
    expect(expiredBox.classList.contains("hidden")).toBe(true);
    expect(openPairBtn.textContent).toBe("Rotate Pairing Code");

    // Advance past the 5-minute expiry window: expired notice appears calmly.
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    expect(pairingBox.classList.contains("hidden")).toBe(true);
    expect(expiredBox.classList.contains("hidden")).toBe(false);
    expect(expiredBox.textContent).toContain("Pairing code expired");
    expect(openPairBtn.textContent).toBe("Open Pairing");

    // Main-process push with pairing removed keeps the expired notice visible.
    const { pairing: _dropped, ...withoutPairing } = makeState();
    mounted.pushState(withoutPairing);
    expect(expiredBox.classList.contains("hidden")).toBe(false);

    // Opening a new pairing clears the expired notice.
    openPairBtn.click();
    await flushMicrotasks();
    expect(expiredBox.classList.contains("hidden")).toBe(true);
    expect(pairingBox.classList.contains("hidden")).toBe(false);

    // Closing pairing manually does NOT show the expired notice.
    document.getElementById("close-pair-btn")!.click();
    await flushMicrotasks();
    expect(pairingBox.classList.contains("hidden")).toBe(true);
    expect(expiredBox.classList.contains("hidden")).toBe(true);
  });

  it("enforces switch ARIA semantics, strips unsafe QR SVG tags, and localizes all new UI strings in zh-CN", async () => {
    const xssSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>window.__xss=1</script><rect width="10" height="10" fill="#fff" onclick="alert(1)"/><path fill="#000" d="M1 1h2v2h-2z"/></svg>';
    await mountPage({
      language: "zh-CN",
      initialState: makeState({
        pairing: {
          pairId: "pair_zh",
          pin: "908172",
          pairingUri: "lingerx://pair?v=1",
          qrSvg: xssSvg,
          expiresAt: Date.now() + 60_000,
        },
        devices: [
          {
            deviceId: "dev_xss",
            deviceName: '<img src=x onerror="window.__xss=2">',
            platform: "ios",
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            sessionMode: "dedicated",
            activeSse: true,
            activeConnections: 1,
          },
        ],
      }),
    });

    // Switch accessibility semantics.
    const toggle = document.getElementById(
      "toggle-enabled",
    ) as HTMLInputElement;
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe(
      zhCN.mobileCompanion.toggleGatewayTitle,
    );

    // XSS defenses: zero <script> or <img> elements injected.
    const qrFrame = document.getElementById("qr-frame")!;
    expect(qrFrame.querySelector("script")).toBeNull();
    expect(qrFrame.querySelector("rect")?.getAttribute("onclick")).toBeNull();
    expect(qrFrame.querySelector("path")).not.toBeNull();
    expect(
      document.getElementById("device-list")?.querySelector("img"),
    ).toBeNull();
    expect(document.querySelector(".device-name")?.textContent).toBe(
      '<img src=x onerror="window.__xss=2">',
    );

    // zh-CN localized copy across all new surfaces.
    expect(document.getElementById("copy-pin-btn")?.textContent).toBe(
      zhCN.mobileCompanion.copyPin,
    );
    expect(document.getElementById("copy-tls-pin-btn")?.textContent).toBe(
      zhCN.mobileCompanion.copyTlsPin,
    );
    expect(document.getElementById("device-list")?.textContent).toContain(
      zhCN.mobileCompanion.sessionDedicated,
    );
    expect(document.getElementById("unsaved-badge")?.textContent).toBe(
      zhCN.mobileCompanion.unsavedChanges,
    );
    expect(document.getElementById("tls-warning")?.textContent).toContain(
      zhCN.mobileCompanion.tlsDisableWarning,
    );

    // Structural CSS & CSP invariants.
    expect(rawPage).toContain("default-src 'none'");
    expect(rawPage).toContain("@media (prefers-color-scheme: dark)");
    expect(rawPage).toContain("--canvas: #161614;");
    expect(rawPage).toContain("--surface: #1f1f1c;");
    expect(rawPage).toContain("--ink: #f2f1ed;");
    expect(rawPage).toContain(".switch input:focus-visible + .track");
    expect(rawPage).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
