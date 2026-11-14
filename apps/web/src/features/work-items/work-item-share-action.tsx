import {
  HashtagIcon,
  MessageAdd01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { Icon } from "@/components/ui/icon";
import { roomMessageSender } from "@/features/rooms/chat/room-message-sender";
import { tenantRoomsQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubRoomListItem,
  TeamHubWorkItem,
} from "@/features/teamhub/teamhub-types";

import { dashboardWorkItemUrl } from "./work-item-routes";
import { workItemShare, workItemShareIdempotencyKey } from "./work-item-share";

/**
 * Sends the Work Item to one Room as one Message built from the Copy as
 * Markdown text. The picker stays open while the post is in flight and after a
 * refusal, so the person can retry there, then names the Room once it lands.
 */
export function WorkItemShareAction({
  item,
  tenantId,
}: {
  item: TeamHubWorkItem;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const share = workItemShare({
    item,
    url: dashboardWorkItemUrl(tenantId, item.id),
  });
  const [sent, setSent] = useState<{ roomId: string; roomName: string }>();
  const send = useMutation({
    mutationFn: async (room: TeamHubRoomListItem) => {
      const { message } = await roomMessageSender(client).createMessage({
        attachments: [],
        body: share.text,
        idempotencyKey: workItemShareIdempotencyKey(share.version, room.id),
        mentions: [],
        roomId: room.id,
      });
      return message.id;
    },
    onSuccess: (_messageId, room) =>
      setSent({ roomId: room.id, roomName: room.name }),
  });
  const sendableRooms = (rooms.data?.items ?? []).filter(
    (room) => room.kind !== "thread",
  );
  const roomItems: ActionMenuItem[] = rooms.isPending
    ? [{ disabled: true, label: "Loading Rooms…" }]
    : rooms.error
      ? [{ disabled: true, label: "Rooms are unavailable." }]
      : sendableRooms.length
        ? sendableRooms.map((room) => ({
            disabled: send.isPending,
            icon: (
              <Icon
                icon={room.kind === "direct" ? UserIcon : HashtagIcon}
                size={14}
              />
            ),
            keepOpen: true,
            label: room.name,
            onSelect: () => send.mutate(room),
          }))
        : [{ disabled: true, label: "No Rooms available." }];

  return (
    <>
      {sent ? (
        <span className="text-xs leading-4 text-app-muted" role="status">
          Sent to {sent.roomName}.
        </span>
      ) : null}
      {send.isError ? (
        <span className="text-xs leading-4 text-app-danger" role="alert">
          {send.error.message || "The Work Item could not be sent to the Room."}
        </span>
      ) : null}
      {/* A landed Message remounts the menu closed; a refusal leaves it open
          on the Room that can be tried again. The trigger keeps the peek
          header's existing icon-button size. */}
      <ActionMenu
        buttonClassName="app-dialog-close"
        items={roomItems}
        key={sent ? `sent:${sent.roomId}` : "unsent"}
        label="Send to Room"
        placement="bottom-end"
        trigger={<Icon icon={MessageAdd01Icon} size={16} />}
      />
    </>
  );
}
