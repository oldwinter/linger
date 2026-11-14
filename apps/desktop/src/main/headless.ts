import { app } from "electron";

// GTK aborts the process when a tray, menu, or global shortcut is created
// without a display, as CI and the headless test path run.
export function headlessDisplay(): boolean {
  return app.commandLine.getSwitchValue("ozone-platform") === "headless";
}
