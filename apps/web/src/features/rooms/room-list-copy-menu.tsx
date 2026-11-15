import { Copy01Icon } from "@hugeicons/core-free-icons";

import { ActionMenu } from "@/components/ui/action-menu";
import { Icon } from "@/components/ui/icon";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { RoomCopyStatus, useRoomClipboardCopy } from "./room-copy-feedback";
import { roomListMarkdown } from "./room-list-markdown";

/**
 * Copies the Room list as it stands: the rows the list shows, in its order,
 * with each Room's name linked and its unread state named. It reads what is
 * already on screen, so it issues no request.
 */
export function RoomListCopyMenu({
  rooms,
  tenantId,
}: {
  /** The rows the list shows, in display order. */
  rooms: readonly TeamHubRoomListItem[];
  tenantId: string;
}) {
  const { copy, state } = useRoomClipboardCopy(() =>
    roomListMarkdown({ origin: window.location.origin, rooms, tenantId }),
  );
  return (
    <span className="relative inline-flex">
      <ActionMenu
        buttonClassName="xs-nav-btn"
        items={[
          {
            disabled: rooms.length === 0,
            icon: <Icon icon={Copy01Icon} size={14} />,
            label: "Copy Room list as Markdown",
            onSelect: copy,
          },
        ]}
        label="Room list actions"
      />
      {state === "idle" ? null : (
        <span className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-card px-1.5 py-0.5 shadow-outline">
          <RoomCopyStatus state={state} />
        </span>
      )}
    </span>
  );
}
