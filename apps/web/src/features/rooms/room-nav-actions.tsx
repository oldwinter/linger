import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlarmClockIcon,
  BellIcon,
  BellOffIcon,
  Clock01Icon,
  Delete02Icon,
  Link01Icon,
  Moon02Icon,
  PinIcon,
  PinOffIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { lazy, Suspense, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { Icon } from "@/components/ui/icon";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubRoomListItem,
  TeamHubRoomPage,
} from "@/features/teamhub/teamhub-types";

import { canDeleteTenantAgent } from "./members/agent-permissions";
import { RoomCopyStatus, useRoomClipboardCopy } from "./room-copy-feedback";
import {
  clearRoomMentionSnooze,
  muteRoomMention,
  roomMentionSnoozeUntil,
  setRoomMentionSnooze,
  unmuteRoomMention,
} from "./room-mention-snooze";
import {
  teamHubIdentityQueryOptions,
  tenantAgentsQueryOptions,
  tenantRoomsQueryKey,
} from "./room-queries";
import { roomChatPath } from "./room-routes";
import {
  markAllRoomsRead,
  markAllRoomsReadTargets,
  type MarkAllRoomsReadReport,
} from "./room-mark-all-read";
import { markRoomReadRequest, type RoomMarkReadTarget } from "./room-mark-read";
import {
  clearRoomSnooze,
  roomSnoozeUntil,
  setRoomSnooze,
  type RoomSnoozeChoice,
} from "./room-snooze";

const AgentDeleteDialog = lazy(async () => ({
  default: (await import("./room-nav-agent-delete-dialog"))
    .RoomNavAgentDeleteDialog,
}));

/** Pinned Rooms lead their section, the most recently pinned first. */
export function pinnedFirst(rooms: TeamHubRoomListItem[]) {
  const pinned = rooms
    .filter((room) => room.pinned_at)
    .sort((left, right) =>
      (right.pinned_at ?? "").localeCompare(left.pinned_at ?? ""),
    );
  return [...pinned, ...rooms.filter((room) => !room.pinned_at)];
}

export function useRoomPin(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const queryKey = tenantRoomsQueryKey(tenantId);
  const applyPin = (roomId: string, pinnedAt: string | undefined) =>
    queryClient.setQueryData<TeamHubRoomPage>(queryKey, (current) =>
      current
        ? {
            ...current,
            items: current.items.map((room) =>
              room.id === roomId ? { ...room, pinned_at: pinnedAt } : room,
            ),
          }
        : current,
    );
  return useMutation({
    mutationFn: (intent: { pinned: boolean; roomId: string }) =>
      teamHubData(
        client.api.PUT("/v0/rooms/{roomId}/pin", {
          params: { path: { roomId: intent.roomId } },
          body: { pinned: intent.pinned },
        }),
      ),
    // The row moves at once; the server's pin time replaces the guess. An
    // in-flight list read is cancelled so it can't land on top of the guess.
    onMutate: async ({ pinned, roomId }) => {
      await queryClient.cancelQueries({ queryKey });
      applyPin(roomId, pinned ? new Date().toISOString() : undefined);
    },
    onSuccess: (state) => applyPin(state.room_id, state.pinned_at),
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });
}

/** Writes one Room's acknowledgement into the cached list. */
function applyRoomReadState(
  queryClient: QueryClient,
  queryKey: QueryKey,
  roomId: string,
  readThroughRoomSeq: number,
) {
  queryClient.setQueryData<TeamHubRoomPage>(queryKey, (current) =>
    current
      ? {
          ...current,
          items: current.items.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  read_through_room_seq: Math.max(
                    room.read_through_room_seq,
                    readThroughRoomSeq,
                  ),
                  unread_mention_count: 0,
                  unread_message_count: 0,
                }
              : room,
          ),
        }
      : current,
  );
}

/** Advances one Room's read cursor and clears its row without opening it. */
export function useRoomMarkRead(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const queryKey = tenantRoomsQueryKey(tenantId);
  return useMutation({
    mutationFn: (intent: RoomMarkReadTarget) =>
      markRoomReadRequest(client, intent),
    // A list read that started before the acknowledgement would otherwise land
    // stale counts on top of the new cursor.
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (state) =>
      applyRoomReadState(
        queryClient,
        queryKey,
        state.room_id,
        state.read_through_room_seq,
      ),
  });
}

/**
 * Marks every unread Room read through the row's own request, a few at a time.
 * Each acknowledgement patches its row at once, and the report counts only what
 * TeamHub accepted, so a failed Room stays unread.
 */
export function useMarkAllRoomsRead(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const queryKey = tenantRoomsQueryKey(tenantId);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  }>();
  const [report, setReport] = useState<MarkAllRoomsReadReport>();

  async function markAll(rooms: readonly TeamHubRoomListItem[]) {
    const targets = markAllRoomsReadTargets(rooms);
    if (targets.length === 0 || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setReport(undefined);
    setProgress({ completed: 0, total: targets.length });
    try {
      await queryClient.cancelQueries({ queryKey });
      setReport(
        await markAllRoomsRead(
          targets,
          (target) => markRoomReadRequest(client, target),
          (settlement) => {
            if (settlement.acknowledgement) {
              applyRoomReadState(
                queryClient,
                queryKey,
                settlement.acknowledgement.roomId,
                settlement.acknowledgement.readThroughRoomSeq,
              );
            }
            setProgress({
              completed: settlement.completed,
              total: settlement.total,
            });
          },
        ),
      );
    } finally {
      runningRef.current = false;
      setRunning(false);
      setProgress(undefined);
    }
  }

  return { markAll, progress, report, running };
}

// Row actions sit flat until the pointer is on the icon itself (or its menu is
// open); the row's own hover tint is enough to announce them.
const roomNavActionClass =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-foreground/5 hover:text-foreground aria-expanded:bg-foreground/5 aria-expanded:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const roomHeaderActionClass =
  "flex size-8 shrink-0 items-center justify-center rounded-lg text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink aria-expanded:bg-app-hover aria-expanded:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus";

/**
 * Copies a Room's canonical chat URL. A thread is a Room, so passing its id
 * copies the thread's own URL.
 */
function useRoomLinkCopy(tenantId: string, roomId: string) {
  return useRoomClipboardCopy(() => roomChatPath(tenantId, roomId));
}

/** The row action, present only when the Room has a cursor to acknowledge. */
function roomMarkReadItems(
  markRead: ReturnType<typeof useRoomMarkRead>,
  roomId: string,
  throughRoomSeq: number | undefined,
): ActionMenuItem[] {
  if (throughRoomSeq === undefined) return [];
  return [
    {
      disabled: markRead.isPending,
      icon: <Icon icon={Tick02Icon} size={14} />,
      label: "Mark as read",
      onSelect: () => {
        if (markRead.isPending) return;
        markRead.reset();
        markRead.mutate({ roomId, throughRoomSeq });
      },
    },
  ];
}

function RoomMarkReadStatus({ failed }: { failed: boolean }) {
  if (!failed) return null;
  return (
    <span className="text-xs leading-4 text-app-danger" role="alert">
      Could not mark as read.
    </span>
  );
}

/** The Room header's overflow menu. */
export function RoomHeaderMenu({
  name,
  roomId,
  tenantId,
}: {
  name: string;
  roomId: string;
  tenantId: string;
}) {
  const link = useRoomLinkCopy(tenantId, roomId);
  return (
    <>
      <RoomCopyStatus state={link.state} />
      <ActionMenu
        buttonClassName={roomHeaderActionClass}
        items={[
          {
            icon: <Icon icon={Link01Icon} size={14} />,
            label: "Copy Room link",
            onSelect: link.copy,
          },
        ]}
        label={`More actions for ${name}`}
      />
    </>
  );
}

export function RoomPinButton({
  name,
  onToggle,
  pinned,
}: {
  name: string;
  onToggle: () => void;
  pinned: boolean;
}) {
  const label = `${pinned ? "Unpin" : "Pin"} ${name}`;
  return (
    <button
      aria-label={label}
      className={roomNavActionClass}
      onClick={onToggle}
      title={pinned ? "Unpin" : "Pin"}
      type="button"
    >
      {pinned ? (
        <Icon icon={PinOffIcon} size={14} />
      ) : (
        <Icon icon={PinIcon} size={14} />
      )}
    </button>
  );
}

/**
 * A Room's quieting choices. Both are this browser's display decisions for the
 * Account, so the menu writes nothing to the server. Mention snoozing quietens
 * notifications; Room snoozing hides the row until it ends. A muted Room offers
 * only Unmute, and Off appears only while the Room's mentions are snoozed.
 */
export function RoomMentionMenu({
  accountId,
  markReadThrough,
  muted,
  name,
  roomId,
  roomSnoozed,
  snoozed,
  tenantId,
}: {
  accountId?: string;
  markReadThrough?: number;
  muted: boolean;
  name: string;
  roomId: string;
  roomSnoozed: boolean;
  snoozed: boolean;
  tenantId: string;
}) {
  const markRead = useRoomMarkRead(tenantId);
  function snooze(choice: "hour" | "morning") {
    const now = new Date();
    setRoomMentionSnooze(
      accountId,
      roomId,
      roomMentionSnoozeUntil(choice, now),
      now,
    );
  }
  function snoozeRoom(choice: RoomSnoozeChoice) {
    const now = new Date();
    setRoomSnooze(accountId, roomId, roomSnoozeUntil(choice, now), now);
  }
  const mentionItems: ActionMenuItem[] = muted
    ? [
        {
          icon: <Icon icon={BellIcon} size={14} />,
          label: "Unmute mentions",
          onSelect: () => unmuteRoomMention(accountId, roomId),
          separatorBefore: true,
        },
      ]
    : [
        {
          icon: <Icon icon={Clock01Icon} size={14} />,
          label: "Snooze mentions for 1 hour",
          onSelect: () => snooze("hour"),
        },
        {
          icon: <Icon icon={AlarmClockIcon} size={14} />,
          label: "Snooze mentions until tomorrow morning",
          onSelect: () => snooze("morning"),
        },
        ...(snoozed
          ? [
              {
                icon: <Icon icon={BellOffIcon} size={14} />,
                label: "Turn off snoozing",
                onSelect: () =>
                  clearRoomMentionSnooze(accountId, roomId, new Date()),
                separatorBefore: true,
              },
            ]
          : []),
      ];
  const roomItems: ActionMenuItem[] = roomSnoozed
    ? [
        {
          icon: <Icon icon={BellIcon} size={14} />,
          label: "Bring Room back",
          onSelect: () => clearRoomSnooze(accountId, roomId, new Date()),
          separatorBefore: true,
        },
      ]
    : [
        {
          icon: <Icon icon={Clock01Icon} size={14} />,
          label: "Snooze Room for 1 hour",
          onSelect: () => snoozeRoom("hour"),
          separatorBefore: true,
        },
        {
          icon: <Icon icon={Moon02Icon} size={14} />,
          label: "Snooze Room until tomorrow morning",
          onSelect: () => snoozeRoom("morning"),
        },
      ];
  const items: ActionMenuItem[] = [
    ...roomMarkReadItems(markRead, roomId, markReadThrough),
    ...mentionItems,
    ...roomItems,
    ...(muted
      ? []
      : [
          {
            icon: <Icon icon={BellOffIcon} size={14} />,
            label: "Mute mentions",
            onSelect: () => muteRoomMention(accountId, roomId, new Date()),
            separatorBefore: true,
          },
        ]),
  ];
  return (
    <>
      <RoomMarkReadStatus failed={markRead.isError} />
      <ActionMenu
        buttonClassName={roomNavActionClass}
        items={items}
        label={`More actions for ${name}`}
        placement="right-start"
      />
    </>
  );
}

/** The Agent chat row's menu: pin state, then removing the Agent itself. */
export function AgentRowMenu({
  agentId,
  markReadThrough,
  name,
  onTogglePin,
  pinned,
  roomId,
  tenantId,
}: {
  agentId: string | undefined;
  markReadThrough?: number;
  name: string;
  onTogglePin: () => void;
  pinned: boolean;
  roomId: string;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const [deleting, setDeleting] = useState(false);
  const { data: identity } = useQuery(teamHubIdentityQueryOptions(client));
  const { data: agents } = useQuery({
    ...tenantAgentsQueryOptions(client, tenantId),
    enabled: agentId !== undefined,
  });
  const currentActorId = identity?.actors.find(
    (actor) => actor.tenant_id === tenantId,
  )?.id;
  const registration = agents?.items.find(
    (agent) => agent.actor.id === agentId,
  );
  const canDelete = canDeleteTenantAgent(registration, currentActorId);
  const link = useRoomLinkCopy(tenantId, roomId);
  const markRead = useRoomMarkRead(tenantId);
  return (
    <>
      <RoomMarkReadStatus failed={markRead.isError} />
      <RoomCopyStatus state={link.state} />
      <ActionMenu
        buttonClassName={roomNavActionClass}
        items={[
          {
            icon: pinned ? (
              <Icon icon={PinOffIcon} size={14} />
            ) : (
              <Icon icon={PinIcon} size={14} />
            ),
            label: pinned ? "Unpin" : "Pin",
            onSelect: onTogglePin,
          },
          {
            icon: <Icon icon={Link01Icon} size={14} />,
            label: "Copy Room link",
            onSelect: link.copy,
          },
          ...roomMarkReadItems(markRead, roomId, markReadThrough),
          {
            danger: true,
            disabled: !canDelete,
            icon: <Icon icon={Delete02Icon} size={14} />,
            label: "Delete",
            onSelect: () => setDeleting(true),
            separatorBefore: true,
          },
        ]}
        label={`More actions for ${name}`}
        placement="right-start"
      />
      {deleting && agentId && registration
        ? // The row's action strip is pointer-events: none whenever the
          // pointer leaves the row, and that is inherited through the DOM
          // even by a top-layer dialog, so the dialog lives outside the row.
          createPortal(
            <Suspense fallback={null}>
              <AgentDeleteDialog
                agentId={agentId}
                name={name}
                onClose={() => setDeleting(false)}
                tenantId={tenantId}
              />
            </Suspense>,
            document.body,
          )
        : null}
    </>
  );
}
