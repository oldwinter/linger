import {
  HashtagIcon,
  MessageAdd01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { buttonClassName } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { roomMessageSender } from "@/features/rooms/chat/room-message-sender";
import { tenantRoomsQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubDocument,
  TeamHubRoomListItem,
} from "@/features/teamhub/teamhub-types";

import { documentDetailPath } from "../files/document-detail-routes";

import {
  roomDocumentShare,
  roomDocumentShareIdempotencyKey,
} from "./room-document-share";

/**
 * Sends a Room Document to one Room as one Message carrying its title and
 * link. The picker stays open while the post is in flight and after a refusal,
 * so the person can retry there, then names the Room once it lands.
 */
export function RoomDocumentShareAction({
  document,
  tenantId,
}: {
  document: TeamHubDocument;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const share = roomDocumentShare({
    document,
    url: new URL(
      documentDetailPath({ documentId: document.id, tenantId }),
      window.location.origin,
    ).toString(),
  });
  const [sent, setSent] = useState<{ roomId: string; roomName: string }>();
  const send = useMutation({
    mutationFn: async (room: TeamHubRoomListItem) => {
      const { message } = await roomMessageSender(client).createMessage({
        attachments: [],
        body: share.text,
        idempotencyKey: roomDocumentShareIdempotencyKey(share.version, room.id),
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
          {send.error.message || "The Document could not be sent to the Room."}
        </span>
      ) : null}
      {/* A landed Message remounts the menu closed; a refusal leaves it open
          on the Room that can be tried again. */}
      <ActionMenu
        buttonClassName={buttonClassName({
          size: "compactIcon",
          tone: "ghost",
        })}
        items={roomItems}
        key={sent ? `sent:${sent.roomId}` : "unsent"}
        label="Send to Room"
        placement="bottom-end"
        trigger={<Icon icon={MessageAdd01Icon} size={16} />}
      />
    </>
  );
}
