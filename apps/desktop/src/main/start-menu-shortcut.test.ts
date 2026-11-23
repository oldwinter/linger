import { describe, expect, it, vi } from "vitest";

import { markStartMenuShortcut } from "./start-menu-shortcut.js";

const APP_DATA = "C:\\Users\\Administrator\\AppData\\Roaming";
const SHORTCUT =
  "C:\\Users\\Administrator\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Linger.lnk";
const INSTALLED =
  "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Linger\\Linger.exe";
const PORTABLE = "C:\\lv015\\app\\Linger\\Linger.exe";
const APP_ID = "com.simplexai.linger.desktop.preview";

describe("markStartMenuShortcut", () => {
  it("does not touch the Start Menu shortcut when LINGER_DESKTOP_USER_DATA is set", () => {
    const readShortcutLink = vi.fn(() => ({ target: INSTALLED }));
    const writeShortcutLink = vi.fn(() => true);

    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: INSTALLED,
        appUserModelId: APP_ID,
        env: { LINGER_DESKTOP_USER_DATA: "C:\\lv015\\ud" },
        exists: () => true,
        readShortcutLink,
        writeShortcutLink,
      }),
    ).toBe(false);
    expect(readShortcutLink).not.toHaveBeenCalled();
    expect(writeShortcutLink).not.toHaveBeenCalled();
  });

  it("does not overwrite a shortcut pointing to a different installation", () => {
    const readShortcutLink = vi.fn(() => ({ target: INSTALLED }));
    const writeShortcutLink = vi.fn(() => true);

    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: PORTABLE,
        appUserModelId: APP_ID,
        env: {},
        exists: () => true,
        readShortcutLink,
        writeShortcutLink,
      }),
    ).toBe(false);
    expect(readShortcutLink).toHaveBeenCalledWith(SHORTCUT);
    expect(writeShortcutLink).not.toHaveBeenCalled();
  });

  it("skips when the Start Menu shortcut does not exist or cannot be read", () => {
    const writeShortcutLink = vi.fn(() => true);
    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: INSTALLED,
        appUserModelId: APP_ID,
        env: {},
        exists: () => false,
        readShortcutLink: vi.fn(),
        writeShortcutLink,
      }),
    ).toBe(false);

    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: INSTALLED,
        appUserModelId: APP_ID,
        env: {},
        exists: () => true,
        readShortcutLink: () => {
          throw new Error("corrupt lnk");
        },
        writeShortcutLink,
      }),
    ).toBe(false);
    expect(writeShortcutLink).not.toHaveBeenCalled();
  });

  it("updates appUserModelId when the shortcut target matches case-insensitively", () => {
    const writeShortcutLink = vi.fn(() => true);

    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: INSTALLED.toLowerCase().replaceAll("\\", "/"),
        appUserModelId: APP_ID,
        env: {},
        exists: () => true,
        readShortcutLink: () => ({ target: INSTALLED }),
        writeShortcutLink,
      }),
    ).toBe(true);
    expect(writeShortcutLink).toHaveBeenCalledExactlyOnceWith(
      SHORTCUT,
      "update",
      {
        target: INSTALLED,
        appUserModelId: APP_ID,
      },
    );
  });

  it("skips rewriting when target and appUserModelId already match", () => {
    const writeShortcutLink = vi.fn(() => true);

    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: INSTALLED,
        appUserModelId: APP_ID,
        env: {},
        exists: () => true,
        readShortcutLink: () => ({
          target: INSTALLED,
          appUserModelId: APP_ID,
        }),
        writeShortcutLink,
      }),
    ).toBe(false);
    expect(writeShortcutLink).not.toHaveBeenCalled();
  });

  it("rejects relative target or executable paths", () => {
    const writeShortcutLink = vi.fn(() => true);

    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: "Linger.exe",
        appUserModelId: APP_ID,
        env: {},
        exists: () => true,
        readShortcutLink: () => ({ target: "Linger.exe" }),
        writeShortcutLink,
      }),
    ).toBe(false);
    expect(writeShortcutLink).not.toHaveBeenCalled();
  });

  it("canonicalizes paths via realpath and strips extended-length prefixes before comparing", () => {
    const writeShortcutLink = vi.fn(() => true);
    const shortTarget =
      "C:\\Users\\ADMINI~1\\AppData\\Local\\Programs\\Linger\\Linger.exe";

    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: `\\\\?\\${INSTALLED}`,
        appUserModelId: APP_ID,
        env: {},
        exists: () => true,
        realpath: (file) =>
          file === shortTarget ? `\\\\?\\${INSTALLED}` : file,
        readShortcutLink: () => ({ target: shortTarget }),
        writeShortcutLink,
      }),
    ).toBe(true);
    expect(writeShortcutLink).toHaveBeenCalledExactlyOnceWith(
      SHORTCUT,
      "update",
      {
        target: shortTarget,
        appUserModelId: APP_ID,
      },
    );
  });

  it("returns false and reports the error when writeShortcutLink throws", () => {
    const onWriteError = vi.fn();
    const locked = new Error("EPERM: shortcut is read-only");

    expect(
      markStartMenuShortcut({
        appData: APP_DATA,
        execPath: INSTALLED,
        appUserModelId: APP_ID,
        env: {},
        exists: () => true,
        readShortcutLink: () => ({ target: INSTALLED }),
        writeShortcutLink: () => {
          throw locked;
        },
        onWriteError,
      }),
    ).toBe(false);
    expect(onWriteError).toHaveBeenCalledExactlyOnceWith(locked);
  });
});
