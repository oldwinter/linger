import { contextBridge, ipcRenderer } from "electron";

import {
  MOBILE_COMPANION_IPC,
  type LingerMobileCompanionApi,
  type MobileCompanionCommand,
  type MobileCompanionState,
} from "../shared/mobile-companion.js";

// Sandboxed preload for the isolated Mobile Companion window only.
const api: LingerMobileCompanionApi = {
  getState: () =>
    ipcRenderer.invoke(
      MOBILE_COMPANION_IPC.state,
    ) as Promise<MobileCompanionState>,
  onState: (listener) => {
    const handler = (_event: unknown, state: MobileCompanionState): void =>
      listener(state);
    ipcRenderer.on(MOBILE_COMPANION_IPC.stateEvent, handler);
    return () => ipcRenderer.off(MOBILE_COMPANION_IPC.stateEvent, handler);
  },
  run: (command: MobileCompanionCommand) =>
    ipcRenderer.invoke(
      MOBILE_COMPANION_IPC.run,
      command,
    ) as Promise<MobileCompanionState>,
};

contextBridge.exposeInMainWorld("lingerMobileCompanion", api);
