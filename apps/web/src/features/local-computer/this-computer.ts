/**
 * The computer this desktop is running on, when Computers was opened with
 * several machines and nobody has asked for the list.
 */
export function computerTheDesktopOpens(
  computerIds: readonly string[],
  input: {
    requestedId: string | null;
    showingDirectory: boolean;
    thisComputerId: string | undefined;
  },
): string | undefined {
  if (input.requestedId || input.showingDirectory) return undefined;
  if (computerIds.length < 2 || !input.thisComputerId) return undefined;
  return computerIds.includes(input.thisComputerId)
    ? input.thisComputerId
    : undefined;
}
