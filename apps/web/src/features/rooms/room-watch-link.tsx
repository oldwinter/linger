import { Activity01Icon } from "@hugeicons/core-free-icons";
import { Link, useMatch } from "react-router";

import { Icon } from "@/components/ui/icon";

import { useRoomActivity } from "./use-room-activity";
import { roomWorkPath } from "./room-work";

/** Shown in the Room header only while an agent is working in this Room. */
export function RoomWatchLink({
  roomId,
  tenantId,
}: {
  roomId: string;
  tenantId: string;
}) {
  const watching = useMatch("/t/:tenantId/rooms/:roomId/working");
  const { runningRoomIds } = useRoomActivity(tenantId, true);
  if (watching || !runningRoomIds.includes(roomId)) return null;
  return (
    <Link
      aria-label="Watch the work"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-app-success hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Watch the work"
      to={roomWorkPath(tenantId, roomId)}
    >
      <Icon icon={Activity01Icon} size={16} />
    </Link>
  );
}
