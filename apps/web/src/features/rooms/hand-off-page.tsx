import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { dashboardWorkItemPath } from "@/features/work-items/work-item-routes";
import { tenantWorkItemsDashboardQueryPrefix } from "@/features/work-items/work-item-queries";

import { handOffCandidates } from "./hand-off";
import {
  roomMembersQueryOptions,
  roomQueryOptions,
  teamHubIdentityQueryOptions,
} from "./room-queries";

export function HandOffPage() {
  const { tenantId = "", roomId = "" } = useParams();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const titleId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [handed, setHanded] = useState<{
    name: string;
    workItemId: string;
  } | null>(null);
  const room = useQuery(roomQueryOptions(client, tenantId, roomId));
  const members = useQuery(roomMembersQueryOptions(client, tenantId, roomId));
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const handOff = useMutation({
    mutationFn: async (actorId: string) => {
      const created = await teamHubData(
        client.api.POST("/v0/tenants/{tenantId}/work-items", {
          params: {
            path: { tenantId },
            header: idempotencyHeader(createTeamHubIdempotencyKey()),
          },
          body: {
            assignee_actor_ids: [actorId],
            description: "",
            kind: "issue",
            origin_room_id: roomId,
            priority: "medium",
            title: title.trim(),
          },
        }),
      );
      return created.id;
    },
    onSuccess: async (workItemId, actorId) => {
      const person = members.data?.items.find(
        (member) => member.actor.id === actorId,
      );
      setHanded({
        name: person?.actor.display_name ?? "They",
        workItemId,
      });
      await queryClient.invalidateQueries({
        queryKey: tenantWorkItemsDashboardQueryPrefix(tenantId),
      });
    },
  });

  const ready = !room.isPending && !members.isPending && !identity.isPending;
  useEffect(() => {
    if (ready) titleRef.current?.focus();
  }, [ready]);

  if (!ready) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <p role="status">Loading this room...</p>
      </main>
    );
  }

  if (room.isError || !room.data) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <p role="alert">This room could not be opened.</p>
      </main>
    );
  }

  const chatPath = `/t/${tenantId}/rooms/${roomId}/chat`;

  if (room.data.kind === "thread") {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <h1 className="text-2xl text-foreground">Hand this off</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          A thread stays with its room. Hand work off from the room itself.
        </p>
        <Link
          className="mt-6 inline-block text-sm text-foreground underline"
          to={`/t/${tenantId}/rooms`}
        >
          Back to rooms
        </Link>
      </main>
    );
  }

  const currentActorId = identity.data?.actors.find(
    (actor) => actor.tenant_id === tenantId,
  )?.id;
  const people = handOffCandidates(
    members.data?.items.map((member) => member.actor) ?? [],
    currentActorId,
  );

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <p className="text-sm text-muted-foreground">{room.data.name}</p>
      <h1 className="mt-1 text-2xl text-foreground">Hand this off</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Name the job. The person you choose keeps it, and it shows up on the
        dashboard.
      </p>
      {handed ? (
        <div className="mt-8">
          <p role="status">{handed.name} has it. It waits on the dashboard.</p>
          <Link
            className="mt-4 inline-block text-sm text-foreground underline"
            to={dashboardWorkItemPath(tenantId, handed.workItemId)}
          >
            See it on the dashboard
          </Link>
        </div>
      ) : (
        <div className="mt-8">
          <label className="block" htmlFor={titleId}>
            <span className="mb-1.5 block text-sm font-medium">
              What needs doing
            </span>
            <input
              className="ui-field-control w-full"
              id={titleId}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              ref={titleRef}
              value={title}
            />
          </label>
          {people.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground" role="status">
              There is no one else here to hand work to.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-2">
              {people.map((person) => (
                <li key={person.id}>
                  <Button
                    disabled={!title.trim() || handOff.isPending}
                    onClick={() => handOff.mutate(person.id)}
                    type="button"
                  >
                    Hand it to {person.display_name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {handOff.isError ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              That handoff did not go through.
            </p>
          ) : null}
        </div>
      )}
      <Link
        className="mt-8 inline-block text-sm text-muted-foreground underline"
        to={chatPath}
      >
        Back to {room.data.name}
      </Link>
    </main>
  );
}
