import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { requireRoomRouteParam } from "./room-route-params";
import {
  roomMembersQueryOptions,
  teamHubIdentityQueryOptions,
} from "./room-queries";
import {
  chosenRole,
  leavesNoOwner,
  roleWrites,
  type RoomRole,
} from "./who-manages";

/**
 * Owners can change the room and its membership afterwards. The room keeps
 * the roles saved here.
 */
export function WhoManagesPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const roomId = requireRoomRouteParam(params.roomId, "Room");
  const members = useQuery(roomMembersQueryOptions(client, tenantId, roomId));
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const [chosen, setChosen] = useState<Map<string, RoomRole>>(new Map());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const people = (members.data?.items ?? []).map((member) => ({
    id: member.actor.id,
    kind: member.actor.kind,
    name: member.actor.display_name,
    role: member.role,
  }));
  const currentActorId = identity.data?.actors.find(
    (actor) => actor.tenant_id === tenantId,
  )?.id;
  const isOwner = people.some(
    (person) => person.id === currentActorId && person.role === "owner",
  );
  const writes = roleWrites(people, chosen);
  const empty = leavesNoOwner(people, chosen);
  const chat = `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;

  const save = async () => {
    if (!isOwner || pending || writes.length === 0 || empty) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      for (const write of writes) {
        await teamHubData(
          client.api.PUT("/v0/rooms/{roomId}/members/{actorId}", {
            params: { path: { actorId: write.id, roomId } },
            body: { role: write.role },
          }),
        );
      }
      setChosen(new Map());
      setSaved(true);
      await queryClient.invalidateQueries({
        queryKey: roomMembersQueryOptions(client, tenantId, roomId).queryKey,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The room could not be updated.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-xl text-foreground">Who can manage this room</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Someone who can manage may change the room and who belongs to it.
            Someone who takes part can work in it. The room keeps this choice.
          </p>
        </header>
        {members.isPending || identity.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading who can manage.
          </p>
        ) : members.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Who can manage could not be loaded.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {isOwner ? null : (
              <p className="text-sm text-muted-foreground" role="status">
                Only someone who can manage this room can change this.
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {people.map((person) => {
                const role = chosenRole(person, chosen);
                const soleOwner =
                  person.kind === "human" &&
                  role === "owner" &&
                  people.filter(
                    (item) =>
                      item.kind === "human" &&
                      chosenRole(item, chosen) === "owner",
                  ).length === 1;
                return (
                  <li
                    className="rounded-2xl border border-border px-4 py-3"
                    key={person.id}
                  >
                    {person.kind === "agent" ? (
                      <p className="text-sm text-foreground">
                        {`${person.name} takes part. Agents do not manage the room.`}
                      </p>
                    ) : (
                      <fieldset aria-label={person.name} disabled={!isOwner}>
                        <legend className="text-sm text-foreground">
                          {person.name}
                        </legend>
                        <div className="mt-2 flex flex-wrap gap-4">
                          {(["owner", "member"] as const).map((value) => (
                            <label
                              className="flex items-center gap-2 text-sm text-foreground"
                              htmlFor={`${person.id}-${value}`}
                              key={value}
                            >
                              <input
                                checked={role === value}
                                disabled={
                                  !isOwner || (value === "member" && soleOwner)
                                }
                                id={`${person.id}-${value}`}
                                name={person.id}
                                onChange={() => {
                                  setSaved(false);
                                  setChosen((current) => {
                                    const next = new Map(current);
                                    next.set(person.id, value);
                                    return next;
                                  });
                                }}
                                type="radio"
                                value={value}
                              />
                              {value === "owner" ? "Can manage" : "Takes part"}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </li>
                );
              })}
            </ul>
            {empty ? (
              <p className="text-sm text-destructive" role="alert">
                The room needs someone who can manage it.
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {saved ? (
              <p className="text-sm text-foreground" role="status">
                Saved. This room will keep that.
              </p>
            ) : null}
            {isOwner ? (
              <Button
                disabled={pending || writes.length === 0 || empty}
                type="submit"
              >
                {pending ? "Saving" : "Save"}
              </Button>
            ) : null}
          </form>
        )}
        <Link
          className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={chat}
        >
          Back to chat
        </Link>
      </div>
    </main>
  );
}
