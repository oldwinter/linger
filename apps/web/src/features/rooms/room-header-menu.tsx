import { Link01Icon } from "@hugeicons/core-free-icons";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { Icon } from "@/components/ui/icon";

import { RoomCopyStatus, useRoomClipboardCopy } from "./room-copy-feedback";
import { roomChatPath } from "./room-routes";

/** The Room header's overflow menu. */
export function RoomHeaderMenu({
  actions = [],
  name,
  roomId,
  tenantId,
}: {
  actions?: ActionMenuItem[];
  name: string;
  roomId: string;
  tenantId: string;
}) {
  const link = useRoomClipboardCopy(() => roomChatPath(tenantId, roomId));
  return (
    <>
      <RoomCopyStatus state={link.state} />
      <ActionMenu
        buttonClassName="flex size-8 shrink-0 items-center justify-center rounded-lg text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink aria-expanded:bg-app-hover aria-expanded:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
        items={[
          ...actions,
          {
            icon: <Icon icon={Link01Icon} size={14} />,
            label: "Copy Room link",
            onSelect: link.copy,
            separatorBefore: actions.length > 0,
          },
        ]}
        label={`More actions for ${name}`}
      />
    </>
  );
}
