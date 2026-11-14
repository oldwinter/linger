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
import { documentDownloadContent } from "@/features/rooms/documents/document-download-content";
import { tenantRoomsQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";

import { wikiPageShare, wikiPageShareIdempotencyKey } from "./wiki-page-share";
import { wikiDocumentPath } from "./wiki-routes";

/**
 * Sends this Wiki page to one Room as one Message: its title, a bounded
 * excerpt, and a link back. The page's Markdown is read from the same source
 * Download saves, and only once a Room is chosen. The picker stays open while
 * the send is in flight and after a refusal, so the same Room can be retried.
 */
export function WikiSendToRoom({
  documentId,
  tenantId,
  title,
  updatedAt,
}: {
  documentId: string;
  tenantId: string;
  title: string;
  updatedAt: string;
}) {
  const { client } = useTeamHubRuntime();
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const [sent, setSent] = useState<{ roomId: string; roomName: string }>();
  const send = useMutation({
    mutationFn: async (room: TeamHubRoomListItem) => {
      const share = wikiPageShare({
        documentId,
        markdown: await pageMarkdown(client, documentId),
        title,
        updatedAt,
        url: new URL(
          wikiDocumentPath(tenantId, documentId),
          window.location.origin,
        ).toString(),
      });
      const { message } = await roomMessageSender(client).createMessage({
        attachments: [],
        body: share.text,
        idempotencyKey: wikiPageShareIdempotencyKey(share.version, room.id),
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
          {send.error.message || "Could not send"}
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

/** The page's Markdown; a page that cannot be read must not post a Message. */
async function pageMarkdown(client: TeamHubClient, documentId: string) {
  try {
    return await (
      await documentDownloadContent(client, documentId)
    ).blob.text();
  } catch {
    throw new Error("Could not send");
  }
}
