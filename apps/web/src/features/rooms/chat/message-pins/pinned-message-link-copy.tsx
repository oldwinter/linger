import { Link01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { RoomCopyStatus, useRoomClipboardCopy } from "../../room-copy-feedback";
import { roomMessageUrl } from "../../room-routes";

/**
 * Copies one pin's absolute link, origin included, so it opens from a document
 * or another app. It leaves the panel and the Room where they are, so the
 * person can copy several rows in a turn.
 */
export function PinnedMessageLinkCopy({
  message,
  tenantId,
}: {
  message: Pick<TeamHubMessage, "id" | "room_id">;
  tenantId: string;
}) {
  const { copy, state } = useRoomClipboardCopy(() =>
    roomMessageUrl(window.location.origin, tenantId, message),
  );
  return (
    <span className="ml-auto flex items-center gap-1">
      <RoomCopyStatus state={state} />
      <Button
        aria-label="Copy link to this message"
        className="!rounded-lg border-0 text-app-muted"
        onClick={copy}
        size="compactIcon"
        title="Copy link to this message"
        tone="ghost"
      >
        <Icon icon={Link01Icon} size={14} />
      </Button>
    </span>
  );
}
