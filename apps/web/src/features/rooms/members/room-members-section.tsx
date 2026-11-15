import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  Cancel01Icon,
  Delete02Icon,
  PlusSignIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { HighlightedText } from "@/features/search/search-highlight";
import { teamHubData, teamHubDone } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubActor,
  TeamHubActorRef,
} from "@/features/teamhub/teamhub-types";
import { writeClipboardText } from "@/lib/clipboard";

import {
  roomMembersQueryOptions,
  teamHubIdentityQueryOptions,
  tenantActorsQueryOptions,
  tenantAgentAvailabilityQueryOptions,
  tenantAgentsQueryOptions,
} from "../room-queries";
import { eligibleRoomAgents } from "../agent-admission";
import { ActorAvatar } from "./actor-avatar";
import { AgentStatus } from "./agent-status";
import { searchRoomMembers } from "./room-member-search";
import { roomMembersMarkdown } from "./room-members-markdown";

/** Long enough to read, matching the other copy actions. */
const MEMBERS_COPIED_MS = 1200;

export function RoomMembersSection({
  onOpenProfile,
  roomId,
  roomName,
  tenantId,
}: {
  onOpenProfile?: (actorId: string) => void;
  roomId: string;
  /** The heading of the copied roster names the Room. */
  roomName: string;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamHubActorRef | null>(
    null,
  );
  const [copyState, setCopyState] = useState<"copied" | "failed">();
  const copyResetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyResetTimer.current), []);
  const { data: identity } = useSuspenseQuery(
    teamHubIdentityQueryOptions(client),
  );
  const membersQuery = roomMembersQueryOptions(client, tenantId, roomId);
  const membersResult = useQuery(membersQuery);
  const memberItems = membersResult.data?.items ?? [];
  const membersPending = membersResult.isPending;
  const [query, setQuery] = useState("");
  // A search belongs to one look at one Room's roster; another Room starts over.
  useEffect(() => {
    setQuery("");
  }, [roomId]);
  const filtering = query.trim().length > 0;
  const search = searchRoomMembers(memberItems, query);
  const copyDisabled = membersPending || memberItems.length === 0;
  function copyMembers() {
    if (copyDisabled) return;
    window.clearTimeout(copyResetTimer.current);
    setCopyState(undefined);
    void writeClipboardText(
      roomMembersMarkdown({ members: memberItems, roomName }),
    ).then(
      () => {
        setCopyState("copied");
        copyResetTimer.current = window.setTimeout(
          () => setCopyState(undefined),
          MEMBERS_COPIED_MS,
        );
      },
      () => setCopyState("failed"),
    );
  }
  const { data: actors } = useSuspenseQuery({
    ...tenantActorsQueryOptions(client, tenantId),
    refetchOnMount: "always",
  });
  const currentActorId = identity.actors.find(
    (actor) => actor.tenant_id === tenantId,
  )?.id;
  const isOwner = memberItems.some(
    (member) => member.actor.id === currentActorId && member.role === "owner",
  );
  const agentDirectory = useQuery({
    ...tenantAgentsQueryOptions(client, tenantId),
    refetchOnMount: "always",
    retry: false,
  });
  const agentAvailability = useQuery({
    ...tenantAgentAvailabilityQueryOptions(client, tenantId),
    refetchOnMount: "always",
    retry: false,
  });
  const availabilityByActorId = useMemo(
    () =>
      new Map(
        (agentAvailability.data?.items ?? []).map((snapshot) => [
          snapshot.actor_id,
          snapshot.availability,
        ]),
      ),
    [agentAvailability.data?.items],
  );
  const sponsoredAgentIds = useMemo(() => {
    const actorIds = new Set<string>();
    for (const agent of agentDirectory.data?.items ?? []) {
      if (agent.created_by.id === currentActorId) {
        actorIds.add(agent.actor.id);
      }
    }
    return actorIds;
  }, [agentDirectory.data?.items, currentActorId]);
  const availableActors = useMemo(() => {
    const memberIds = new Set(
      (membersResult.data?.items ?? []).map((member) => member.actor.id),
    );
    const availableHumans = actors.items.filter(
      (actor) => actor.kind === "human" && !memberIds.has(actor.id),
    );
    const availableAgents = eligibleRoomAgents({
      agents: agentDirectory.data?.items ?? [],
      availabilitySnapshots: agentAvailability.data?.items ?? [],
      roomMemberIds: memberIds,
      sponsorActorId: currentActorId,
    });
    return [...availableHumans, ...availableAgents];
  }, [
    actors.items,
    agentAvailability.data?.items,
    agentDirectory.data?.items,
    currentActorId,
    membersResult.data?.items,
  ]);
  const refreshMembers = () =>
    queryClient.invalidateQueries({ queryKey: membersQuery.queryKey });
  const putMember = useMutation({
    mutationFn: (actorId: string) =>
      teamHubData(
        client.api.PUT("/v0/rooms/{roomId}/members/{actorId}", {
          params: { path: { roomId, actorId } },
          body: { role: "member" },
        }),
      ),
    onSuccess: refreshMembers,
  });
  const removeMember = useMutation({
    mutationFn: (actorId: string) =>
      teamHubDone(
        client.api.DELETE("/v0/rooms/{roomId}/members/{actorId}", {
          params: { path: { roomId, actorId } },
        }),
      ),
    onSuccess: async () => {
      await refreshMembers();
      setRemoveTarget(null);
    },
  });

  return (
    <section aria-label="Room members" className="px-5 py-3">
      {membersPending ? (
        <p className="text-xs text-app-muted" role="status">
          Loading members...
        </p>
      ) : null}
      {!membersPending && memberItems.length > 0 ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40">
            <Icon icon={Search01Icon} size={14} />
            <input
              aria-label="Search members"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              role="searchbox"
              type="text"
              value={query}
            />
            {query ? (
              <button
                aria-label="Clear member search"
                className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                onClick={() => setQuery("")}
                type="button"
              >
                <Icon icon={Cancel01Icon} size={12} />
              </button>
            ) : null}
          </label>
          {filtering ? (
            <span
              aria-live="polite"
              className="shrink-0 text-2xs text-app-subtle"
            >
              {search.count} of {memberItems.length}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1">
        {filtering && search.count === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
            <p className="text-xs text-app-muted">
              No members match “{query.trim()}”.
            </p>
            <Button
              onClick={() => setQuery("")}
              size="compact"
              tone="secondary"
            >
              Clear search
            </Button>
          </div>
        ) : (
          search.items.map((member) => {
            const agent = agentDirectory.data?.items.find(
              (candidate) => candidate.actor.id === member.actor.id,
            );
            return (
              <div
                className="group flex min-h-13 w-full items-center rounded-lg transition-colors duration-300 hover:bg-muted/70"
                key={member.actor.id}
              >
                <button
                  aria-label={`Open ${member.actor.display_name} profile`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-focus"
                  onClick={() => onOpenProfile?.(member.actor.id)}
                  type="button"
                >
                  <ActorAvatar
                    actorId={member.actor.id}
                    kind={member.actor.kind}
                    name={member.actor.display_name}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        <HighlightedText
                          query={query}
                          text={member.actor.display_name}
                        />
                      </span>
                      {member.actor.kind === "agent" ? (
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                          Agent
                        </span>
                      ) : null}
                      {sponsoredAgentIds.has(member.actor.id) ? (
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-medium text-foreground">
                          Yours
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{member.role}</span>
                      {member.actor.kind === "agent" &&
                      agent &&
                      availabilityByActorId.has(member.actor.id) ? (
                        <>
                          <span aria-hidden>·</span>
                          <AgentStatus
                            availability={
                              availabilityByActorId.get(member.actor.id)!
                            }
                            showDetails
                          />
                        </>
                      ) : null}
                    </span>
                  </span>
                </button>
                {isOwner && member.actor.id !== currentActorId ? (
                  <Button
                    aria-label={`Remove ${member.actor.display_name}`}
                    className="mr-1 opacity-70 group-hover:opacity-100"
                    onClick={() => {
                      removeMember.reset();
                      setRemoveTarget(member.actor);
                    }}
                    size="compactIcon"
                    title={`Remove ${member.actor.display_name}`}
                    tone="ghost"
                  >
                    <Icon icon={Delete02Icon} size={16} />
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <Button
          disabled={copyDisabled}
          onClick={copyMembers}
          size="compact"
          tone="secondary"
        >
          Copy members
        </Button>
        {copyState === "copied" ? (
          <span className="text-xs leading-4 text-app-muted" role="status">
            Copied
          </span>
        ) : null}
        {copyState === "failed" ? (
          <span className="text-xs leading-4 text-app-danger" role="alert">
            Copy failed
          </span>
        ) : null}
      </div>

      {!addOpen && putMember.error ? (
        <p className="mt-3 text-sm text-app-danger" role="alert">
          {putMember.error.message}
        </p>
      ) : null}
      <Button
        className="mt-3 w-full"
        onClick={() => {
          putMember.reset();
          setAddOpen(true);
        }}
      >
        <Icon className="text-muted-foreground" icon={PlusSignIcon} size={16} />
        Add member
      </Button>

      {addOpen ? (
        <AddMemberDialog
          agentDirectoryError={
            agentDirectory.isError || agentAvailability.isError
          }
          agentDirectoryLoading={
            agentDirectory.isPending || agentAvailability.isPending
          }
          actors={availableActors}
          sponsoredAgentIds={sponsoredAgentIds}
          error={putMember.error?.message}
          isPending={putMember.isPending}
          onAdd={(actor) =>
            putMember.mutate(actor.id, { onSuccess: () => setAddOpen(false) })
          }
          onClose={() => {
            putMember.reset();
            setAddOpen(false);
          }}
          onRetryAgentDirectory={() =>
            void Promise.all([
              agentDirectory.refetch(),
              agentAvailability.refetch(),
            ])
          }
        />
      ) : null}
      {removeTarget ? (
        <RemoveMemberDialog
          actor={removeTarget}
          error={removeMember.error?.message}
          isPending={removeMember.isPending}
          onClose={() => {
            removeMember.reset();
            setRemoveTarget(null);
          }}
          onRemove={() => removeMember.mutate(removeTarget.id)}
        />
      ) : null}
    </section>
  );
}

function RemoveMemberDialog({
  actor,
  error,
  isPending,
  onClose,
  onRemove,
}: {
  actor: TeamHubActorRef;
  error?: string;
  isPending: boolean;
  onClose: () => void;
  onRemove: () => void;
}) {
  const title = `Remove ${actor.display_name}?`;
  return (
    <ModalDialog
      description="They will lose access to this Room."
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button disabled={isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isPending} onClick={onRemove} tone="danger">
            Remove
          </Button>
        </>
      }
    >
      {error ? (
        <p className="px-5 py-4 text-sm text-app-danger" role="alert">
          {error}
        </p>
      ) : null}
    </ModalDialog>
  );
}

function AddMemberDialog({
  agentDirectoryError,
  agentDirectoryLoading,
  actors,
  error,
  isPending,
  onAdd,
  onClose,
  onRetryAgentDirectory,
  sponsoredAgentIds,
}: {
  agentDirectoryError: boolean;
  agentDirectoryLoading: boolean;
  actors: TeamHubActor[];
  error?: string;
  isPending: boolean;
  onAdd: (actor: TeamHubActor) => void;
  onClose: () => void;
  onRetryAgentDirectory: () => void;
  sponsoredAgentIds: Set<string>;
}) {
  return (
    <ModalDialog onClose={onClose} size="md" title="Add Room member">
      <div className="p-3">
        {agentDirectoryError ? (
          <div
            className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3"
            role="alert"
          >
            <span className="text-sm text-muted-foreground">
              Your agents are unavailable
            </span>
            <Button
              onClick={onRetryAgentDirectory}
              size="compact"
              tone="secondary"
            >
              Retry
            </Button>
          </div>
        ) : null}
        {agentDirectoryLoading ? (
          <p className="mb-3 text-xs text-muted-foreground" role="status">
            Loading your agents...
          </p>
        ) : null}
        {error ? (
          <p
            className="mb-3 rounded-lg border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] p-3 text-sm text-app-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {actors.length ? (
          actors.map((actor) => (
            <button
              className="flex min-h-13 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors duration-300 hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-app-focus disabled:opacity-50"
              disabled={isPending}
              key={actor.id}
              onClick={() => onAdd(actor)}
              type="button"
            >
              <ActorAvatar
                actorId={actor.id}
                kind={actor.kind}
                name={actor.display_name}
                size="sm"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {actor.display_name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {sponsoredAgentIds.has(actor.id) ? "Yours" : "Human"}
                </span>
              </span>
              <Icon
                className="text-muted-foreground"
                icon={PlusSignIcon}
                size={16}
              />
            </button>
          ))
        ) : (
          <p className="p-4 text-center text-sm text-muted-foreground">
            Every Tenant Actor is already in this Room.
          </p>
        )}
      </div>
    </ModalDialog>
  );
}
