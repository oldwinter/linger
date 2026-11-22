import { translator, type Translate } from "../i18n/language.js";
import type { RuntimeState } from "../shared/api.js";
import type { ComputerDaemonModule } from "./computer-daemon.js";
import type { LanguageModule } from "./language.js";
import type { Module, ModuleContext } from "./modules.js";
import { statusMessages as m } from "./tray.messages.js";

export type StatusTone = "online" | "busy" | "offline" | "error" | "setup";

export interface StatusInput {
  // ComputerDaemonModule.connection().
  readonly connection: string;
  readonly runtime: RuntimeState;
  readonly enrolled: boolean;
  readonly running: number;
}

export interface StatusSummary {
  readonly tone: StatusTone;
  readonly label: string;
}

// One line shown at the top of the tray menu.
export const summarizeStatus = (
  input: StatusInput,
  t: Translate,
): StatusSummary => {
  if (!input.enrolled) return { tone: "setup", label: t(m.notConnected) };
  switch (input.connection) {
    case "auth_failed":
      return { tone: "error", label: t(m.signInExpired) };
    case "identity_conflict":
      return { tone: "error", label: t(m.identityConflict) };
    case "upgrade_required":
      return { tone: "error", label: t(m.updateRequired) };
  }
  if (input.runtime === "crashed")
    return { tone: "error", label: t(m.runtimeError) };
  if (input.runtime !== "ready")
    return { tone: "offline", label: t(m.starting) };
  if (input.connection !== "online")
    return { tone: "offline", label: t(m.offline) };
  if (input.running > 0)
    return { tone: "busy", label: t(m.running, { count: input.running }) };
  return { tone: "online", label: t(m.idle) };
};

// Recomputes the summary from module state and announces changes.
export class StatusModule implements Module {
  readonly name = "Status";
  readonly dependsOn = ["ComputerDaemon", "Language"];
  #ctx: ModuleContext | undefined;
  // Replaced on start, in the shell's language.
  #current: StatusSummary = {
    tone: "offline",
    label: translator("en")(m.starting),
  };
  readonly #unsubscribe: (() => void)[] = [];

  async start(ctx: ModuleContext): Promise<void> {
    this.#ctx = ctx;
    const update = (): void => this.#update();
    this.#unsubscribe.push(
      ctx.bus.on("computer.connection", update),
      ctx.bus.on("runtime.state", update),
      ctx.bus.on("runtime.activity", update),
      ctx.bus.on("computer.changed", update),
      ctx.bus.on("language.changed", update),
    );
    this.#update();
  }

  async stop(): Promise<void> {
    for (const off of this.#unsubscribe.splice(0)) off();
  }

  current(): StatusSummary {
    return this.#current;
  }

  #update(): void {
    const ctx = this.#ctx!;
    const daemon = ctx.get<ComputerDaemonModule>("ComputerDaemon");
    const next = summarizeStatus(
      {
        connection: daemon.connection(),
        runtime: daemon.state(),
        enrolled: !!ctx.config.get().computerId,
        running: daemon.running(),
      },
      ctx.get<LanguageModule>("Language").t,
    );
    if (next.tone === this.#current.tone && next.label === this.#current.label)
      return;
    this.#current = next;
    ctx.bus.emit("status.changed", next);
  }
}
