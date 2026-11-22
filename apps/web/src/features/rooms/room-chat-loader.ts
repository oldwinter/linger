import { lazy } from "react";

function loadRoomChatModule() {
  return import("./chat/room-chat");
}

/** Preloads the Room chat chunk without surfacing rejections to route loaders. */
export function preloadRoomChat(): Promise<unknown> {
  return loadRoomChatModule().catch(() => {});
}

export const LazyRoomChat = lazy(async () => ({
  default: (await loadRoomChatModule()).RoomChat,
}));
