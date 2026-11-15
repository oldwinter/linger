import { contextBridge, ipcRenderer } from "electron";

import {
  QUICK_NOTE_IPC,
  type LingerQuickNoteApi,
  type QuickNoteResult,
} from "../shared/quick-note.js";

// Sandboxed preload for the local quick note window only.
const api: LingerQuickNoteApi = {
  submit: (text) =>
    ipcRenderer.invoke(QUICK_NOTE_IPC.submit, text) as Promise<QuickNoteResult>,
  cancel: () => ipcRenderer.send(QUICK_NOTE_IPC.cancel),
};

contextBridge.exposeInMainWorld("lingerQuickNote", api);
