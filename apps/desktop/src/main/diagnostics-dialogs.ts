import {
  clipboard,
  dialog,
  type BaseWindow,
  type MessageBoxOptions,
} from "electron";

import { consentText, type DiagnosticsPrompts } from "./diagnostics-upload.js";

// Send Diagnostics' native dialogs for the tray and the start failure page.
export const diagnosticsDialogs = (
  window: () => BaseWindow | undefined,
): DiagnosticsPrompts => {
  const show = async (options: MessageBoxOptions): Promise<number> => {
    const parent = window();
    const { response } = await (parent
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options));
    return response;
  };
  return {
    consent: async (state) =>
      (await show({
        type: "question",
        ...consentText(state),
        buttons: ["Send", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      })) === 0,
    sent: async (state) => {
      const copy = await show({
        type: "info",
        message: "Diagnostics sent",
        detail: `Report ID: ${state.reportId}\nGive this ID to Linger support so they can find your report.`,
        buttons: ["Copy Report ID", "Done"],
        defaultId: 0,
        cancelId: 1,
      });
      if (copy === 0) clipboard.writeText(state.reportId);
    },
    failed: async (state) =>
      (await show({
        type: "warning",
        message: "Couldn't send diagnostics",
        detail: state.retry
          ? state.error
          : `${state.error}\nYou can still use Save Diagnostics and send the file by hand.`,
        buttons: state.retry ? ["Try Again", "Close"] : ["Close"],
        defaultId: 0,
        cancelId: state.retry ? 1 : 0,
      })) === 0 && state.retry,
    busy: async () => {
      await show({
        type: "info",
        message: "Diagnostics are already being sent",
        detail: "Finish or cancel that report in the Linger setup window.",
        buttons: ["OK"],
      });
    },
  };
};
