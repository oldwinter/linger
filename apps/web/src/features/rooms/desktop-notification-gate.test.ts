import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Every place the Web client raises a browser desktop notification, named by
 * what it announces. A new source has to appear here and consult the pause, so
 * a notification that skips the gate fails this test instead of slipping past.
 */
const notificationSources: Readonly<Record<string, string>> = {
  "features/rooms/another-me-notifications.ts": "Another Me messages",
  "features/rooms/room-mention-notifications.ts": "Room mentions",
};

describe("desktop notification sources", () => {
  it("names every source that raises one", async () => {
    const raising: string[] = [];
    for (const file of await sourceFiles(srcRoot)) {
      if (file.startsWith("test/")) continue;
      const text = await readFile(join(srcRoot, file), "utf8");
      if (text.includes("new Notification(")) raising.push(file);
    }

    expect(raising.sort()).toEqual(Object.keys(notificationSources).sort());
  });

  it("gates every named source on the notification pause", async () => {
    for (const [file, source] of Object.entries(notificationSources)) {
      const text = await readFile(join(srcRoot, file), "utf8");
      expect(
        text.includes("isDesktopNotificationPaused"),
        `${source} (${file}) must consult isDesktopNotificationPaused`,
      ).toBe(true);
    }
  });
});

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
