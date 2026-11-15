import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { browserPreferences } from "./browser-preferences";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Feature modules that keep something in this browser but stay out of the This
 * browser section, named with the reason. Any other module that reads or writes
 * browser storage has to be registered, so a new store cannot be forgotten.
 */
const excluded: Readonly<Record<string, string>> = {
  "app/desktop-shell.ts":
    "Desktop shell Chats list collapsed state, per-Tenant layout state.",
  "components/ui/use-sidebar-width.ts":
    "Resized sidebar widths, per-Tenant layout state.",
  "features/memory/meeting-told-part.ts":
    "The line you chose to tell from a meeting; clearing it would forget which part you picked.",
  "features/memory/meeting-follow-ups.ts":
    "Checked to-dos for one meeting on this computer; clearing them would mark that list undone.",
  "features/rooms/another-me-quiet.ts":
    "The time Another Me stays quiet on this computer; clearing it would let reminders through early.",
  "features/rooms/voice-control/speaker-names.ts":
    "Names given to the voices in a recording, kept with that recording on this computer.",
  "features/rooms/away-recap.ts":
    "Remembers which away recap was dismissed; clearing it would replay a summary, not reset a preference.",
  "features/rooms/chat/use-another-me-onboarding.ts":
    "A one-time intro-seen marker; clearing it would replay onboarding.",
  "features/rooms/chat/voice-mode/voice-mode-mini-window.tsx":
    "The mini window's last screen position, a layout convenience.",
  "features/rooms/members/agent-avatar.ts":
    "Avatar choices cached for display, not a setting this section offers.",
  "features/rooms/task-sidebar/panel-tab-store.ts":
    "The task sidebar's last open tab, per-Room layout state.",
  "features/rooms/task-sidebar/panel-width.ts":
    "The task sidebar's width, layout state.",
  "features/rooms/voice-control/voice-control-storage.ts":
    "Voice control's device and session keys, owned by the microphone session and its own disconnect.",
  "features/wiki/wiki-display-state.ts":
    "Per-page wiki display choices, layout state owned by the wiki view.",
  "lib/local-preference-keys.ts":
    "Shared helper that enumerates and removes browser preference keys on behalf of registered stores.",
  "lib/room-diagnostics.ts":
    "Developer opt-in flag (`linger.roomDiagnostics`) checked during room debugging, not a preference.",
};

describe("browser preference registry", () => {
  it("registers every feature module that keeps something in this browser", async () => {
    const storing = await storageModules();
    const registered = new Set(
      browserPreferences.map((preference) => preference.module),
    );

    expect(
      storing.filter(
        (module) => !registered.has(module) && !(module in excluded),
      ),
      "A feature module keeps browser storage without a Clear entry or an excluded reason.",
    ).toEqual([]);
  });

  it("names a real browser-storage module for every registry entry", async () => {
    const storing = await storageModules();

    for (const preference of browserPreferences) {
      expect(
        storing,
        `${preference.label} names ${preference.module}`,
      ).toContain(preference.module);
      expect(
        Object.keys(excluded),
        `${preference.label} cannot also be excluded`,
      ).not.toContain(preference.module);
    }
  });

  it("gives every excluded module a reason and only names modules that exist", async () => {
    const storing = await storageModules();

    for (const module of Object.keys(excluded)) {
      expect(excluded[module]?.trim(), `${module} needs a reason`).toBeTruthy();
      expect(storing, `${module} no longer keeps browser storage`).toContain(
        module,
      );
    }
  });
});

/** App module paths, relative to `src/`, that touch browser storage. */
async function storageModules(): Promise<string[]> {
  const modules: string[] = [];
  for (const file of await sourceFiles(srcRoot)) {
    const text = await readFile(join(srcRoot, file), "utf8");
    if (text.includes("localStorage")) modules.push(file);
  }
  return modules.sort();
}

async function sourceFiles(dir: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(join(dir, entry.name), path)));
      continue;
    }
    if (!/\.(ts|tsx)$/u.test(entry.name) || /\.test\./u.test(entry.name)) {
      continue;
    }
    files.push(path);
  }
  return files;
}
