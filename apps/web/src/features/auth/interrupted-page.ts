// A return_to query is chosen by whoever made the link, so it stays limited to
// computer setup. This is only the page the tab was already on when the
// session expired, and signing in reads it once.

const storageKey = "linger.interrupted-page";

export function interruptedPage(value: string): string | null {
  if (value.length === 0 || value.length > 2_048) return null;
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("#")
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value, "http://localhost");
  } catch {
    return null;
  }
  if (url.origin !== "http://localhost" || url.username || url.password) {
    return null;
  }
  const path = `${url.pathname}${url.search}`;
  if (path !== value) return null;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) {
    return null;
  }
  return path;
}

export function rememberInterruptedPage(value: string) {
  const path = interruptedPage(value);
  if (!path) return;
  try {
    sessionStorage.setItem(storageKey, path);
  } catch {
    // The next sign-in opens Rooms when the tab cannot keep the page.
  }
}

export function takeInterruptedPage(): string | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(storageKey);
    sessionStorage.removeItem(storageKey);
  } catch {
    return null;
  }
  return raw ? interruptedPage(raw) : null;
}

export function clearInterruptedPage() {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Nothing to clear.
  }
}
