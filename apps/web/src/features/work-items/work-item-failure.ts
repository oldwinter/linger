/** A failed write says what TeamHub said, or that the Item could not change. */
export function updateFailureMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The Work Item could not be updated.";
}
