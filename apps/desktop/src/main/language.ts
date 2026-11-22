import {
  matchLanguage,
  translator,
  type Language,
  type Translate,
} from "../i18n/language.js";
import type { Module, ModuleContext } from "./modules.js";

/**
 * The language of the shell's own text: menus, the tray, notifications,
 * dialogs and the shell pages. The choice is the Web client's: the page
 * reports it (desktop-ipc.ts) whenever the person picks one in Settings ›
 * Language, and it is kept in the desktop settings so the setup window,
 * which opens before any page loads, shows it too. Until a choice arrives
 * the shell follows the system's preferred languages, else English.
 */
export class LanguageModule implements Module {
  readonly name = "Language";
  readonly dependsOn = ["Config"];
  readonly #systemLanguages: () => readonly string[];
  #ctx: ModuleContext | undefined;

  constructor(options: { systemLanguages: () => readonly string[] }) {
    this.#systemLanguages = options.systemLanguages;
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.#ctx = ctx;
  }

  async stop(): Promise<void> {
    this.#ctx = undefined;
  }

  current(): Language {
    return (
      this.#ctx?.config.get().language ?? matchLanguage(this.#systemLanguages())
    );
  }

  /** Formats a message in the current language. */
  readonly t: Translate = (message, ...values) =>
    translator(this.current())(message, ...values);

  /** Keeps the Web client's choice; what shows text redraws on the event. */
  choose(language: Language): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const stored = ctx.config.get().language;
    if (stored === language) return;
    const before = this.current();
    ctx.config.update({ language });
    if (language !== before) ctx.bus.emit("language.changed", language);
  }
}
