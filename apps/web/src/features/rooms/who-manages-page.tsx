import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomMemberPage } from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";
import { roomActionsMessages as m } from "./room-actions.messages";
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
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const roomId = requireRoomRouteParam(params.roomId, "Room");
  const headingId = useId();
  const membersQuery = roomMembersQueryOptions(client, tenantId, roomId);
  const members = useQuery(membersQuery);
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
        const updated = await teamHubData(
          client.api.PUT("/v0/rooms/{roomId}/members/{actorId}", {
            params: { path: { actorId: write.id, roomId } },
            body: { role: write.role },
          }),
        );
        setChosen((current) => {
          const next = new Map(current);
          next.delete(write.id);
          return next;
        });
        queryClient.setQueryData<TeamHubRoomMemberPage>(
          membersQuery.queryKey,
          (current) =>
            current
              ? {
                  ...current,
                  items: current.items.map((item) =>
                    item.actor.id === write.id
                      ? { ...item, role: updated?.role ?? write.role }
                      : item,
                  ),
                }
              : current,
        );
      }
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t(m.whoManagesSaveFailed),
      );
    } finally {
      await queryClient.invalidateQueries({
        queryKey: membersQuery.queryKey,
      });
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7"
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={chat}
          >
            <Icon icon={ArrowLeft01Icon} size={14} />
            {t(m.backToRoom)}
          </Link>
        </div>
        <header>
          <h2 className="text-xl text-foreground" id={headingId}>
            {t(m.whoManagesTitle)}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(m.whoManagesDescription)}
          </p>
        </header>
        {members.isPending || identity.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.whoManagesLoading)}
          </p>
        ) : members.isError || identity.isError ? (
          <div className="flex items-center justify-between gap-3" role="alert">
            <p className="text-sm text-destructive">
              {t(m.whoManagesLoadFailed)}
            </p>
            <Button
              onClick={() => {
                if (members.isError) void members.refetch();
                if (identity.isError) void identity.refetch();
              }}
              size="compact"
              tone="secondary"
              type="button"
            >
              {t(commonMessages.retry)}
            </Button>
          </div>
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
                {t(m.whoManagesOwnerOnly)}
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
                        {t(m.whoManagesAgentRow, { name: person.name })}
                      </p>
                    ) : (
                      <fieldset
                        aria-label={person.name}
                        disabled={!isOwner || pending}
                      >
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
                              {t(
                                value === "owner"
                                  ? m.whoManagesRoleOwner
                                  : m.whoManagesRoleMember,
                              )}
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
                {t(m.whoManagesNeedOwner)}
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {saved ? (
              <p className="text-sm text-foreground" role="status">
                {t(m.whoManagesSaved)}
              </p>
            ) : null}
            {isOwner ? (
              <Button
                disabled={pending || writes.length === 0 || empty}
                type="submit"
              >
                {t(pending ? m.whoManagesSaving : commonMessages.save)}
              </Button>
            ) : null}
          </form>
        )}
      </div>
    </section>
  );
}
