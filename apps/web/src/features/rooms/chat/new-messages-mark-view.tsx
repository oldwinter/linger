export function NewMessagesMark({ count }: { count: number }) {
  const label = count === 1 ? "1 new message" : `${count} new messages`;
  return (
    <div
      aria-label={label}
      className="my-3 flex items-center gap-3 px-4"
      role="separator"
    >
      <span className="h-px flex-1 bg-app-border" />
      <span className="text-xs font-medium text-app-ink">{label}</span>
      <span className="h-px flex-1 bg-app-border" />
    </div>
  );
}
