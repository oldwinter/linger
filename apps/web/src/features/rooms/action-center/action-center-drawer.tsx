import {
  Activity01Icon,
  AlertCircleIcon,
  ArrowRight01Icon,
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";
import { markdownPlainText } from "@/features/teamhub/markdown-plain-text";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";
import { useT } from "@/i18n/use-translation";

import { ActorAvatar } from "../members/actor-avatar";
import { RoomAvatar } from "../members/room-avatar";
import { spokenRoomFace } from "../members/room-spoken-face";
import { useWorkingClock, workingDuration } from "../working-duration";
import { actionCenterMessages as m } from "./action-center.messages";

export interface ActionCenterDrawerProps {
  failedRoomIds: readonly string[];
  onClose: () => void;
  onNavigate?: () => void;
  rooms: readonly TeamHubRoomListItem[];
  runningRoomIds: readonly string[];
  tenantId: string;
}

/**
 * Global Live Ops drawer listing all active Agent runs and Rooms needing
 * attention (failed runs or unread mentions) across the current workspace.
 */
export function ActionCenterDrawer({
  failedRoomIds,
  onClose,
  onNavigate,
  rooms,
  runningRoomIds,
  tenantId,
}: ActionCenterDrawerProps) {
  const t = useT();
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const workingClock = useWorkingClock(runningRoomIds);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const { activeRooms, attentionRooms } = useMemo(() => {
    const runningSet = new Set(runningRoomIds);
    const failedSet = new Set(failedRoomIds);
    const topLevelRooms = rooms.filter((room) => room.kind !== "thread");

    const active = topLevelRooms.filter((room) => runningSet.has(room.id));
    const attention = topLevelRooms
      .filter((room) => failedSet.has(room.id) || room.unread_mention_count > 0)
      .map((room) => ({
        failed: failedSet.has(room.id),
        mentions: room.unread_mention_count,
        room,
      }))
      .sort((left, right) => {
        if (left.failed !== right.failed) return left.failed ? -1 : 1;
        if (left.mentions !== right.mentions) {
          return right.mentions - left.mentions;
        }
        return (
          Date.parse(
            right.room.latest_message?.created_at ?? right.room.updated_at,
          ) -
          Date.parse(
            left.room.latest_message?.created_at ?? left.room.updated_at,
          )
        );
      });

    return { activeRooms: active, attentionRooms: attention };
  }, [failedRoomIds, rooms, runningRoomIds]);

  const isEmpty = activeRooms.length === 0 && attentionRooms.length === 0;

  const handleRoomJump = () => {
    onClose();
    onNavigate?.();
  };

  const drawer = (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      data-testid="action-center-backdrop"
    >
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-foreground/20 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl"
        data-testid="action-center-drawer"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Icon
                className="shrink-0 text-app-ink"
                icon={Activity01Icon}
                size={16}
              />
              <h2
                className="truncate text-sm font-semibold text-foreground"
                id={titleId}
              >
                {t(m.title)}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isEmpty
                ? t(m.subtitle)
                : t(m.summaryCounts, {
                    attention: attentionRooms.length,
                    running: activeRooms.length,
                  })}
            </p>
          </div>
          <button
            aria-label={t(m.closeDrawer)}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-voice-close
            onClick={onClose}
            ref={closeButtonRef}
            title={t(m.closeDrawer)}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={16} />
          </button>
        </header>

        <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-app-surface-soft/40 px-5 py-10 text-center">
              <span className="flex size-9 items-center justify-center rounded-full bg-app-status-success-surface text-app-status-success-text">
                <Icon icon={Tick02Icon} size={18} />
              </span>
              <p className="mt-3 text-sm font-medium text-foreground">
                {t(m.emptyTitle)}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                {t(m.emptyDescription)}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {activeRooms.length > 0 ? (
                <section aria-label={t(m.activeRunsTitle)}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-app-info motion-safe:animate-pulse"
                      />
                      {t(m.activeRunsTitle)}
                    </h3>
                    <span className="text-2xs font-medium text-app-subtle tabular-nums">
                      {activeRooms.length}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {activeRooms.map((room) => {
                      const name = roomDisplayName(room);
                      const duration = workingDuration(
                        workingClock.since[room.id],
                        workingClock.now,
                      );
                      const preview = room.latest_message
                        ? markdownPlainText(room.latest_message.raw_message)
                        : t(m.noLatestMessage);
                      return (
                        <li
                          className="rounded-xl border border-border bg-app-surface-soft/50 p-2.5 transition-colors hover:border-border-hover"
                          key={room.id}
                        >
                          <div className="flex items-start gap-2.5">
                            <DrawerRoomAvatar room={room} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-medium text-foreground">
                                  {name}
                                </span>
                                <StatusPill tone="info">
                                  {duration
                                    ? t(m.workingFor, {
                                        duration: duration.short,
                                      })
                                    : t(m.workingNow)}
                                </StatusPill>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {preview}
                              </p>
                            </div>
                            <Link
                              aria-label={t(m.openRoomAria, { name })}
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={handleRoomJump}
                              to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(room.id)}/chat`}
                            >
                              <span>{t(m.openRoom)}</span>
                              <Icon icon={ArrowRight01Icon} size={12} />
                            </Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {attentionRooms.length > 0 ? (
                <section aria-label={t(m.needsAttentionTitle)}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      <Icon
                        className="text-app-danger"
                        icon={AlertCircleIcon}
                        size={13}
                      />
                      {t(m.needsAttentionTitle)}
                    </h3>
                    <span className="text-2xs font-medium text-app-subtle tabular-nums">
                      {attentionRooms.length}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {attentionRooms.map(({ failed, mentions, room }) => {
                      const name = roomDisplayName(room);
                      const preview = room.latest_message
                        ? markdownPlainText(room.latest_message.raw_message)
                        : t(m.noLatestMessage);
                      return (
                        <li
                          className="rounded-xl border border-border bg-card p-2.5 transition-colors hover:border-border-hover"
                          key={room.id}
                        >
                          <div className="flex items-start gap-2.5">
                            <DrawerRoomAvatar room={room} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate text-sm font-medium text-foreground">
                                  {name}
                                </span>
                                {failed ? (
                                  <StatusPill tone="danger">
                                    {t(m.runFailed)}
                                  </StatusPill>
                                ) : null}
                                {mentions > 0 ? (
                                  <StatusPill tone="warning">
                                    {t(m.unreadMentions, { count: mentions })}
                                  </StatusPill>
                                ) : null}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {preview}
                              </p>
                            </div>
                            <Link
                              aria-label={t(m.openRoomAria, { name })}
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border bg-app-surface-soft px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={handleRoomJump}
                              to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(room.id)}/chat`}
                            >
                              <span>{t(m.openRoom)}</span>
                              <Icon icon={ArrowRight01Icon} size={12} />
                            </Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  return createPortal(drawer, document.body);
}

function DrawerRoomAvatar({ room }: { room: TeamHubRoomListItem }) {
  if (room.kind === "direct" && room.direct_peer) {
    return (
      <ActorAvatar
        actorId={room.direct_peer.id}
        kind={room.direct_peer.kind}
        name={room.direct_peer.display_name}
        size="nav"
      />
    );
  }
  return (
    <RoomAvatar
      members={spokenRoomFace(
        room.member_preview ?? [],
        room.latest_message?.author,
      )}
    />
  );
}

function roomDisplayName(room: TeamHubRoomListItem): string {
  return room.kind === "direct" && room.direct_peer
    ? room.direct_peer.display_name
    : room.name;
}
