import { contextBridge, ipcRenderer } from "electron";

import {
  IPC,
  type ComputerStatus,
  type DesktopUpdateState,
  type LingerDesktopApi,
} from "../shared/api.js";

// Sandboxed preload: exposes only window.lingerDesktop, never ipcRenderer.
declare const __DESKTOP_VERSION__: string;

const api: LingerDesktopApi = {
  version: __DESKTOP_VERSION__,
  platform: process.platform as LingerDesktopApi["platform"],
  computer: {
    getStatus: () => ipcRenderer.invoke(IPC.computerStatus),
    onStatus: (callback) => {
      const listener = (_event: unknown, status: ComputerStatus): void =>
        callback(status);
      ipcRenderer.on(IPC.computerStatusEvent, listener);
      return () => {
        ipcRenderer.off(IPC.computerStatusEvent, listener);
      };
    },
    enroll: () => ipcRenderer.invoke(IPC.computerEnroll),
    unenroll: () => ipcRenderer.invoke(IPC.computerUnenroll),
  },
  workspace: {
    pick: () => ipcRenderer.invoke(IPC.workspacePick),
    list: () => ipcRenderer.invoke(IPC.workspaceList),
    revoke: (grantId) => ipcRenderer.invoke(IPC.workspaceRevoke, grantId),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  },
  notifications: {
    setBadgeCount: (count) => ipcRenderer.invoke(IPC.notificationsBadge, count),
  },
  localAccount: {
    available: () => ipcRenderer.invoke(IPC.localAccountAvailable),
    signIn: () => ipcRenderer.invoke(IPC.localAccountSignIn),
  },
  update: {
    getState: () => ipcRenderer.invoke(IPC.updateState),
    onState: (callback) => {
      const listener = (_event: unknown, state: DesktopUpdateState): void =>
        callback(state);
      ipcRenderer.on(IPC.updateStateEvent, listener);
      return () => {
        ipcRenderer.off(IPC.updateStateEvent, listener);
      };
    },
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
  },
  connectorOAuth: {
    prepare: () => ipcRenderer.invoke(IPC.connectorOAuthPrepare),
    onReturn: (callback) => {
      const listener = (_event: unknown, account?: string): void =>
        callback(account);
      ipcRenderer.on(IPC.connectorOAuthReturn, listener);
      return () => ipcRenderer.off(IPC.connectorOAuthReturn, listener);
    },
  },
  ...(process.platform === "darwin"
    ? {
        permissions: {
          act: (step) => ipcRenderer.invoke(IPC.permissionAct, step),
        },
      }
    : {}),
};

contextBridge.exposeInMainWorld("lingerDesktop", api);

// On macOS the page runs under the traffic lights with no title bar; pages
// style html[data-desktop-chrome="inset"] to leave room and a drag region.
if (process.platform === "darwin") {
  // The root element may not exist yet when the preload runs.
  const mark = (): void =>
    document.documentElement?.setAttribute("data-desktop-chrome", "inset");
  mark();
  document.addEventListener("DOMContentLoaded", mark, { once: true });
}
