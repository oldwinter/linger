import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Folder names the installer accepts as instances; legacy-migration.ts skips
// the rest, so they never make a migration pending.
export const INSTANCE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

// The project name prefix of instances installed while the product was named
// Simplex; it marks an instance legacy-migration.ts has not converted yet.
export const LEGACY_PROJECT_PREFIX = "simplex-";

/** The installation home: LINGER_HOME, else ~/.simplexai. */
export function lingerHome(
  environment: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
): string {
  return path.resolve(
    environment.LINGER_HOME || path.join(userHome, ".simplexai"),
  );
}

/**
 * An instance record from before the rename that Linger converts. One from a
 * Docker-mode install (mode "source" or "release") is left as it is: Linger
 * no longer runs it, says so when it is opened, and its compose project
 * name is what removes its containers.
 */
export function convertibleLegacyRecord(value: unknown): boolean {
  const { project, mode } = (value ?? {}) as {
    project?: unknown;
    mode?: unknown;
  };
  return (
    typeof project === "string" &&
    project.startsWith(LEGACY_PROJECT_PREFIX) &&
    mode !== "source" &&
    mode !== "release"
  );
}
/**
 * Whether an instance under `home` still carries the project name of an
 * install from before the rename, so legacy-migration.ts has work to do.
 * Reads only each instance's record, so the desktop can ask before it starts
 * the installer to migrate.
 */
export async function legacyMigrationPending(home: string): Promise<boolean> {
  const directory = path.join(home, "instances");
  const names = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    },
  );
  for (const name of names) {
    if (!INSTANCE_NAME.test(name)) continue;
    const record = await readFile(
      path.join(directory, name, "instance.json"),
      "utf8",
    ).catch(() => undefined);
    if (record === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(record);
    } catch {
      // A damaged record is not the migration's to judge; the installer
      // reports it when it reads the instance.
      continue;
    }
    if (convertibleLegacyRecord(value)) return true;
  }
  return false;
}
