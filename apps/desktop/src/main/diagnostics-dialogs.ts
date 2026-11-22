import {
  clipboard,
  dialog,
  type BaseWindow,
  type MessageBoxOptions,
} from "electron";

import type { Translate } from "../i18n/language.js";
import { dialogMessages as m } from "./dialogs.messages.js";
import { consentText, type DiagnosticsPrompts } from "./diagnostics-upload.js";

// Send Diagnostics' native dialogs for the tray and the start failure page.
export const diagnosticsDialogs = (
  window: () => BaseWindow | undefined,
  t: Translate,
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
        ...consentText(state, t),
        buttons: [t(m.send), t(m.cancel)],
        defaultId: 0,
        cancelId: 1,
      })) === 0,
    sent: async (state) => {
      const copy = await show({
        type: "info",
        message: t(m.sent),
        detail: t(m.sentDetail, { reportId: state.reportId }),
        buttons: [t(m.copyReportId), t(m.done)],
        defaultId: 0,
        cancelId: 1,
      });
      if (copy === 0) clipboard.writeText(state.reportId);
    },
    failed: async (state) =>
      (await show({
        type: "warning",
        message: t(m.sendFailed),
        detail: state.retry
          ? state.error
          : `${state.error}\n${t(m.sendFailedSave)}`,
        buttons: state.retry ? [t(m.tryAgain), t(m.close)] : [t(m.close)],
        defaultId: 0,
        cancelId: state.retry ? 1 : 0,
      })) === 0 && state.retry,
    busy: async () => {
      await show({
        type: "info",
        message: t(m.sendBusy),
        detail: t(m.sendBusyDetail),
        buttons: [t(m.ok)],
      });
    },
  };
};
