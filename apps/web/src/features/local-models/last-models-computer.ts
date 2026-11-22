/**
 * Per-tenant browser memory of the last owned Computer opened on
 * Settings › Models. Lives only in localStorage, so every read and write
 * tolerates missing or blocked storage.
 */

const STORAGE_PREFIX = "linger.models.lastComputer:";

export function lastModelsComputerStorageKey(tenantId: string): string {
  return `${STORAGE_PREFIX}${tenantId}`;
}

export function readLastModelsComputer(tenantId: string): string | undefined {
  try {
    const stored = window.localStorage
      .getItem(lastModelsComputerStorageKey(tenantId))
      ?.trim();
    return stored || undefined;
  } catch {
    return undefined;
  }
}

export function writeLastModelsComputer(
  tenantId: string,
  computerId: string,
): void {
  const trimmed = computerId.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(
      lastModelsComputerStorageKey(tenantId),
      trimmed,
    );
  } catch {
    // Blocked or full storage must not prevent switching Computers.
  }
}

export function clearLastModelsComputer(): void {
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Blocked storage must not prevent Session cleanup.
  }
}
