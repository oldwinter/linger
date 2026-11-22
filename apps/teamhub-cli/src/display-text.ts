/** Display text for an untyped JSON field: structured values serialize as JSON. */
export const displayText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.href;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
};

/**
 * An account's identity label as Agent-readable text, empty when there is no
 * label. An Outlook label is the Microsoft account's sign-in name, which can
 * belong to another mail provider, so it must not be read as the mailbox.
 */
export const accountIdentityText = (
  appKey: unknown,
  label: unknown,
): string => {
  if (label === undefined || label === null || label === "") return "";
  const text = displayText(label);
  return appKey === "outlook"
    ? `${text} - Microsoft sign-in name, the mailbox address may differ`
    : text;
};
