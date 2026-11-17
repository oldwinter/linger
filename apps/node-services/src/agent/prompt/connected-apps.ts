/** Names the apps the Agent could use when the Run started, by app key. */
export function connectedAppsAtRunStart(keys: readonly string[]): string {
  return keys.length === 0
    ? "no app had an account you can use"
    : `these apps had an account you can use: ${keys.join(", ")}`;
}
