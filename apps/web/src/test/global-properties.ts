// Test files without module mocks share one window per worker, so a property
// a test defines on a global or a prototype would reach every later file. This
// records the original descriptor so src/test/setup.ts restores it after the
// test, the way vi.stubGlobal does for globalThis keys.
const restores: (() => void)[] = [];

export function defineGlobalProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  restores.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
}

export function restoreGlobalProperties(): void {
  for (let restore = restores.pop(); restore; restore = restores.pop()) {
    restore();
  }
}
