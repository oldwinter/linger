import { Tick02Icon } from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";
import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

/** The message the whole room reacted to, held above the scrolling timeline. */
export function RoomAgreedLine({ message }: { message: TeamHubMessage }) {
  const words = markdownPlainText(message.raw_message).trim();
  if (!words) return null;
  return (
    <section
      aria-label="The room agreed"
      className="shrink-0 border-b border-app-border bg-app-surface px-4 py-2"
    >
      <div className="flex items-center gap-1.5 text-xs text-app-muted">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium text-app-success">
          <Icon icon={Tick02Icon} size={12} />
          Agreed
        </span>
        <p className="min-w-0 truncate">{message.author.display_name}</p>
      </div>
      <p className="mt-0.5 line-clamp-2 text-sm text-app-ink">{words}</p>
    </section>
  );
}
