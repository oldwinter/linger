import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { type MouseEvent, useMemo, useState } from "react";
import { Link } from "react-router";

import { Icon } from "@/components/ui/icon";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  awayRecap,
  awayRecapVisible,
  readAwayRecapDismissal,
  writeAwayRecapDismissal,
  type AwayRecap,
} from "./away-recap";

export interface AwayRecapCatchUp {
  ariaLabel: string;
  count: number;
  label: string;
  onClick?: () => void;
}

/**
 * The card sits above the Room rows and answers "what did I miss?". Its rows
 * open the Room but do not dismiss it: the Rooms that remain unread still
 * belong there after one is read.
 */
export function AwayRecapCard({
  accountId,
  activeRoomId,
  catchUp,
  dismissedAt: controlledDismissedAt,
  onDismiss,
  onNavigate,
  rooms,
  tenantId,
}: {
  accountId?: string;
  activeRoomId?: string;
  catchUp?: AwayRecapCatchUp;
  dismissedAt?: string | null;
  onDismiss?: (cutoff: string) => void;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, roomId: string) => void;
  rooms: readonly TeamHubRoomListItem[];
  tenantId: string;
}) {
  const recap = useMemo(
    () => awayRecap(rooms, activeRoomId),
    [activeRoomId, rooms],
  );
  const [localDismissedAt, setLocalDismissedAt] = useState<string | null>(() =>
    readAwayRecapDismissal(accountId, tenantId),
  );
  const dismissedAt = onDismiss
    ? (controlledDismissedAt ?? null)
    : localDismissedAt;
  if (!awayRecapVisible(recap, dismissedAt)) return null;
  function dismiss() {
    // A recap whose Rooms carry no usable timestamp still dismisses for the
    // session and until later activity arrives.
    const cutoff = recap.newestAt ?? new Date().toISOString();
    if (onDismiss) {
      onDismiss(cutoff);
      return;
    }
    writeAwayRecapDismissal(accountId, tenantId, cutoff);
    setLocalDismissedAt(cutoff);
  }
  const catchUpLink: AwayRecapCatchUp = catchUp ?? {
    ariaLabel: `Catch up, ${recap.roomCount} ${recap.roomCount === 1 ? "chat" : "chats"}`,
    count: recap.roomCount,
    label: "Catch up",
  };
  return (
    <section
      aria-label="While you were away"
      className="rounded-lg bg-app-surface p-2 shadow-outline"
    >
      <div className="flex items-start gap-1 px-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-medium text-foreground">
            While you were away
          </h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            {summaryText(recap)}
          </p>
        </div>
        <button
          aria-label="Dismiss recap"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={dismiss}
          title="Dismiss"
          type="button"
        >
          <Icon icon={Cancel01Icon} size={14} />
        </button>
      </div>
      <ul className="mt-2 space-y-0.5">
        {recap.rows.map((row) => (
          <li key={row.id}>
            <Link
              className="flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={
                onNavigate ? (event) => onNavigate(event, row.id) : undefined
              }
              to={`/t/${tenantId}/rooms/${row.id}/chat`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-medium text-foreground">
                  {row.name}
                </span>
                <span className="ml-auto shrink-0 text-2xs tabular-nums text-app-muted">
                  {row.unreadCount}
                </span>
              </span>
              <span className="truncate text-xs leading-4 text-muted-foreground">
                {row.snippet}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 border-t border-border/50 pt-1.5">
        <Link
          aria-label={catchUpLink.ariaLabel}
          className="flex items-center justify-between rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={catchUpLink.onClick}
          to={`/t/${tenantId}/rooms/catch-up`}
        >
          <span>{catchUpLink.label}</span>
          <span className="text-2xs tabular-nums text-app-muted">
            {catchUpLink.count}
          </span>
        </Link>
      </div>
    </section>
  );
}

function summaryText(recap: AwayRecap) {
  const messages = `${recap.messageCount} new ${
    recap.messageCount === 1 ? "message" : "messages"
  }`;
  const rooms = `in ${recap.roomCount} ${
    recap.roomCount === 1 ? "room" : "rooms"
  }`;
  if (recap.mentionCount === 0) return `${messages} ${rooms}`;
  return `${messages} ${rooms}, ${recap.mentionCount} ${
    recap.mentionCount === 1 ? "mention" : "mentions"
  }`;
}
