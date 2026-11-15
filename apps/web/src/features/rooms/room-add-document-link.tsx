import { Link, useMatch } from "react-router";

import { roomAddDocumentPath } from "./room-add-document";

/** Opens the screen that binds one of the Human's documents into this Room. */
export function RoomAddDocumentLink({
  roomId,
  tenantId,
}: {
  roomId: string;
  tenantId: string;
}) {
  const here = useMatch("/t/:tenantId/rooms/:roomId/add-document");
  if (here) return null;
  return (
    <Link
      className="shrink-0 rounded-md px-2 py-1 text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to={roomAddDocumentPath(tenantId, roomId)}
    >
      Add a document
    </Link>
  );
}
