import { Button } from "@/components/ui/button";

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
  if (!canGoEarlier && !rewound) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
      {rewound && beganAt ? (
        <p className="min-w-0 flex-1 truncate text-sm text-app-muted">
          The room at {beganAt}
        </p>
      ) : (
        <span className="flex-1" />
      )}
      {canGoEarlier ? (
        <Button onClick={onEarlier} size="compact" tone="ghost">
          Earlier conversation
        </Button>
      ) : null}
      {rewound ? (
        <Button onClick={onNow} size="compact" tone="secondary">
          Back to now
        </Button>
      ) : null}
    </div>
  );
}
