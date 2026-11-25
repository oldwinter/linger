import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/use-translation";

import { chatMessages as m } from "./chat.messages";

/** Steps the room back one conversation, and returns it to the live one. */
export function EarlierConversationBar({
  beganAt,
  canGoEarlier,
  onEarlier,
  onNow,
  rewound,
}: {
  beganAt?: string;
  canGoEarlier: boolean;
  onEarlier: () => void;
  onNow: () => void;
  rewound: boolean;
}) {
  const t = useT();
  if (!canGoEarlier && !rewound) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
      {rewound && beganAt ? (
        <p className="min-w-0 flex-1 truncate text-sm text-app-muted">
          {t(m.roomAtTime, { time: beganAt })}
        </p>
      ) : (
        <span className="flex-1" />
      )}
      {canGoEarlier ? (
        <Button onClick={onEarlier} size="compact" tone="ghost">
          {t(m.earlierConversation)}
        </Button>
      ) : null}
      {rewound ? (
        <Button onClick={onNow} size="compact" tone="secondary">
          {t(m.backToNow)}
        </Button>
      ) : null}
    </div>
  );
}
