import { globalShortcut } from "electron";

import { headlessDisplay } from "./headless.js";
import type { Module, ModuleContext } from "./modules.js";
import type { QuickNoteModule } from "./quick-note.js";

/** The one accelerator that opens the quick note from any application. It
 * leaves the web app's Cmd/Ctrl+K search and Cmd/Ctrl+Shift+T tab shortcuts
 * free. */
export const QUICK_NOTE_ACCELERATOR = "CommandOrControl+Shift+N";

// Opens the tray's New Note window while another application is in front.
export class GlobalShortcutModule implements Module {
  readonly name = "GlobalShortcut";
  readonly dependsOn = ["QuickNote"];
  #registered = false;

  async start(ctx: ModuleContext): Promise<void> {
    if (headlessDisplay()) return;
    try {
      this.#registered = globalShortcut.register(QUICK_NOTE_ACCELERATOR, () =>
        ctx.get<QuickNoteModule>("QuickNote").show(),
      );
      if (!this.#registered)
        ctx.log.warn("global_shortcut.unavailable", {
          accelerator: QUICK_NOTE_ACCELERATOR,
        });
    } catch (error) {
      // Electron throws for an accelerator it cannot parse; a combination
      // another application already holds returns false. Neither is fatal,
      // and the tray's New Note item still opens the window.
      ctx.log.warn("global_shortcut.unavailable", {
        accelerator: QUICK_NOTE_ACCELERATOR,
        error: String(error),
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.#registered) return;
    globalShortcut.unregister(QUICK_NOTE_ACCELERATOR);
    this.#registered = false;
  }
}
