/**
 * This browser's stored keys whose names start with any of the prefixes.
 * Blocked or unavailable storage holds nothing.
 */
export function storedPreferenceKeys(prefixes: readonly string[]): string[] {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

/** Removes every stored key that starts with any of the prefixes. */
export function removePreferenceKeys(prefixes: readonly string[]): void {
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Blocked storage has nothing this app can remove.
  }
}
