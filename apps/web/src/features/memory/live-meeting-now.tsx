/** Today's meeting while the words are still being heard. Not a saved meeting. */
export function LiveMeetingNow({ line }: { line: string }) {
  return (
    <article
      aria-label="Recording now"
      className="border-b border-app-border px-4 py-3 md:px-5"
    >
      <p className="text-xs text-app-muted">Recording now</p>
      <p className="mt-1 text-sm text-app-ink">{line}</p>
    </article>
  );
}
