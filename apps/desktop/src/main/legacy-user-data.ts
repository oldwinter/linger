import { existsSync, renameSync } from "node:fs";
import path from "node:path";

export interface UserDataMove {
  readonly outcome: "moved" | "kept";
  readonly legacy: string;
  readonly userData: string;
  // Where a Linger folder without a Computer credential was set aside.
  readonly setAside?: string;
}

// Windows refuses to rename a folder while a program keeps a file in it open
// without delete sharing. Scanners and indexers let go within a moment; an
// editor does not, which is what the failure message asks the person to close.
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
export const RENAME_ATTEMPTS = 5;
const RETRY_MS = 150;

export interface LegacyMoveIo {
  readonly exists: (target: string) => boolean;
  readonly rename: (from: string, to: string) => void;
  readonly sleep: (ms: number) => void;
}

const nodeIo: LegacyMoveIo = {
  exists: existsSync,
  rename: (from, to) => renameSync(from, to),
  // The move runs before any window exists, so blocking the main thread for
  // the few short retries is harmless.
  sleep: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
};

// Moves the data folder of an install from before the product was renamed
// Linger. A folder holding a Computer credential is already the live one, so
// the legacy folder stays untouched and is never merged or deleted.
export function moveLegacyUserData(
  legacy: string,
  userData: string,
  io: LegacyMoveIo = nodeIo,
): UserDataMove | undefined {
  if (!io.exists(legacy)) return undefined;
  if (io.exists(path.join(userData, "computer", "credential.json")))
    return { outcome: "kept", legacy, userData };
  let setAside: string | undefined;
  if (io.exists(userData)) {
    setAside = `${userData}.before-move-${Date.now()}`;
    renameWhenUnlocked(userData, setAside, io);
  }
  renameWhenUnlocked(legacy, userData, io);
  return {
    outcome: "moved",
    legacy,
    userData,
    ...(setAside ? { setAside } : {}),
  };
}

function renameWhenUnlocked(from: string, to: string, io: LegacyMoveIo): void {
  for (let attempt = 1; ; attempt++) {
    try {
      io.rename(from, to);
      return;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (!LOCKED.has(failure.code ?? "")) throw error;
      if (attempt === RENAME_ATTEMPTS) throw moveFailure(from, to, failure);
      io.sleep(RETRY_MS);
    }
  }
}

// The code alone means nothing to the person, who needs to know which folder
// to close and what to do next.
const moveFailure = (
  from: string,
  to: string,
  cause: NodeJS.ErrnoException,
): Error => {
  const code = cause.code ? ` (${cause.code})` : "";
  return new Error(
    `Linger could not move ${from} to ${to} because a program is using a file in it. Close programs that have files open there (for example a log opened in an editor), then start Linger again.${code}`,
    { cause },
  );
};
