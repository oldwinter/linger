import { HashtagIcon, UserIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { buttonClassName } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { roomMessageSender } from "@/features/rooms/chat/room-message-sender";
import { tenantRoomsQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import {
  introductionIdempotencyKey,
  introductionMessage,
} from "./introduce-in-room";

/**
 * Posts the introduction into a Room as one message. The introduction page
 * still does not open that Room or leave a draft there.
 */
export function IntroduceInRoom({
  paragraphs,
  tenantId,
}: {
  paragraphs: readonly string[];
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const text = introductionMessage(paragraphs);
  const [sent, setSent] = useState<{ roomId: string; roomName: string }>();
  const send = useMutation({
    mutationFn: async (room: TeamHubRoomListItem) => {
      const { message } = await roomMessageSender(client).createMessage({
        attachments: [],
        body: text,
        idempotencyKey: introductionIdempotencyKey(room.id, text),
        mentions: [],
        roomId: room.id,
      });
      return message.id;
    },
    onSuccess: (_messageId, room) =>
      setSent({ roomId: room.id, roomName: room.name }),
  });
  const sendable = (rooms.data?.items ?? []).filter(
    (room) => room.kind !== "thread",
  );
  const items: ActionMenuItem[] = rooms.isPending
    ? [{ disabled: true, label: "Loading Rooms…" }]
    : rooms.error
      ? [{ disabled: true, label: "Rooms are unavailable." }]
      : sendable.length
        ? sendable.map((room) => ({
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
    <div className="flex flex-wrap items-center gap-3">
      {sent ? (
        <span className="text-sm text-muted-foreground" role="status">
          Introduced in {sent.roomName}.
        </span>
      ) : null}
      {send.isError ? (
        <span className="text-sm text-destructive" role="alert">
          {send.error.message || "Could not introduce you"}
        </span>
      ) : null}
      <ActionMenu
        buttonClassName={buttonClassName({
          size: "default",
          tone: "secondary",
        })}
        items={items}
        key={sent ? `sent:${sent.roomId}` : "unsent"}
        label="Introduce you in a Room"
        placement="bottom-start"
        trigger="Introduce you in a Room"
      />
    </div>
  );
}
