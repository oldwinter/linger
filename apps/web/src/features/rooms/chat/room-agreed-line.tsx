import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

/** The message the whole room reacted to, held above the scrolling timeline. */
export function RoomAgreedLine({ message }: { message: TeamHubMessage }) {
  const words = message.raw_message.trim();
  if (!words) return null;
  return (
    <section
      aria-label="The room agreed"
      className="shrink-0 border-b border-app-border bg-app-surface px-4 py-2"
    >
      <p className="truncate text-xs text-app-muted">
        {message.author.display_name}
      </p>
      <p className="line-clamp-2 text-sm text-app-ink">{words}</p>
    </section>
  );
}
