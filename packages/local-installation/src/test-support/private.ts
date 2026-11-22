import { stat } from "node:fs/promises";
import { expect } from "vitest";
import { windowsPrivatePath } from "../windows-private.js";

export async function expectPrivate(
  file: string,
  kind: "file" | "directory" = "file",
): Promise<void> {
  if (process.platform === "win32") {
    await expect(windowsPrivatePath(file, kind)).resolves.toBeUndefined();
  } else {
    expect((await stat(file)).mode & 0o777).toBe(
      kind === "directory" ? 0o700 : 0o600,
    );
  }
}
