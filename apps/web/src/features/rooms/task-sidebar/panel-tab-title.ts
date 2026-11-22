/**
 * The name a Message tab is saved with: the start of its text. An empty name
 * is worded as "Untitled" when the tab is shown.
 */
export function panelTabTitle(body: string) {
  const normalized = body.trim().replace(/\s+/g, " ");
  return normalized.length > 24
    ? `${normalized.slice(0, 24).trimEnd()}…`
    : normalized;
}
