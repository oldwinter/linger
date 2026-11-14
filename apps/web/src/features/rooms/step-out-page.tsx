import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { requireRoomRouteParam } from "./room-route-params";
import { roomQueryOptions } from "./room-queries";
import { useRoomParticipation } from "./room-participation";
import { canStepOut } from "./step-out";

/** Leaving stops delivery and sending until the member comes back. */
export function StepOutPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const roomId = requireRoomRouteParam(useParams().roomId, "Room");
  const room = useQuery(roomQueryOptions(client, tenantId, roomId));
  const participation = useRoomParticipation(
    room.data ?? {
      created_at: "",
      created_by: {
        display_name: "",
        id: "pending",
        kind: "human",
        tenant_id: tenantId,
      },
      id: roomId,
      kind: "room",
      name: "Room",
      tenant_id: tenantId,
      updated_at: "",
    },
  );
  const [choice, setChoice] = useState<"joined" | "left">();
  const current =
    choice ?? (room.data?.participation === "left" ? "left" : "joined");
  const chat = `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">Step out</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {room.data
              ? `${room.data.name} keeps your place and its history.`
              : "A room can go quiet without losing your place."}
          </p>
        </header>
        {room.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Opening the room.
          </p>
        ) : room.isError || !room.data ? (
          <p className="text-sm text-destructive" role="alert">
            This room could not be opened.
          </p>
        ) : !canStepOut(room.data.kind) ? (
          <p className="text-sm text-muted-foreground" role="status">
            This conversation stays with you. Only a regular room can go quiet.
          </p>
        ) : current === "left" ? (
          <>
            <p className="text-sm text-foreground" role="status">
              You stepped out. New messages will not arrive, and you cannot
              send, until you come back.
            </p>
            <Button
              disabled={participation.isPending}
              onClick={() =>
                participation.mutate("joined", {
                  onSuccess: (updated) =>
                    setChoice(
                      updated.participation === "left" ? "left" : "joined",
                    ),
                })
              }
              type="button"
            >
              {participation.isPending ? "Coming back" : "Come back"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-foreground">
              Step out and this room goes quiet. You keep your place and the
              history. New messages will not arrive, and you cannot send, until
              you come back.
            </p>
            <Button
              disabled={participation.isPending}
              onClick={() =>
                participation.mutate("left", {
                  onSuccess: (updated) =>
                    setChoice(
                      updated.participation === "left" ? "left" : "joined",
                    ),
                })
              }
              type="button"
            >
              {participation.isPending ? "Stepping out" : "Step out"}
            </Button>
          </>
        )}
        {participation.isError ? (
          <p className="text-sm text-destructive" role="alert">
            The room did not change.
          </p>
        ) : null}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={chat}
        >
          Back to the room
        </Link>
      </div>
    </main>
  );
}
