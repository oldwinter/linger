import {
  File01Icon,
  PencilEdit01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useId, useRef, useState } from "react";

import { Icon, type IconSvgElement } from "@/components/ui/icon";

import type {
  TeamHubActorRef,
  TeamHubDocument,
} from "@/features/teamhub/teamhub-types";

import { ActorAvatar } from "../members/actor-avatar";
import { RoomAvatar } from "../members/room-avatar";
import { cn } from "@/lib/cn";

type InfoView = "members" | "files";

const INFO_TABS: ReadonlyArray<{ id: InfoView; label: string }> = [
  { id: "members", label: "Members" },
  { id: "files", label: "Files" },
];

export function RoomInfoPanel({
  documents,
  hidden = false,
  members,
  onOpenDocument,
  onOpenRoomSettings,
  roomName,
}: {
  documents: TeamHubDocument[];
  hidden?: boolean;
  members: TeamHubActorRef[];
  onOpenDocument?: (document: TeamHubDocument) => void;
  onOpenRoomSettings?: () => void;
  roomName: string;
}) {
  const [view, setView] = useState<InfoView>("members");
  const tabIdPrefix = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <div
      className={
        hidden
          ? "hidden"
          : "@container/sidebar workspace-scrollbar h-full overflow-y-auto bg-card"
      }
      data-testid="panel-room-info"
      hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <div className="mx-auto w-full max-w-[760px] px-3 pb-8 @min-[380px]/sidebar:px-4">
        <header className="flex min-h-[218px] flex-col items-center justify-center pb-3 text-center @min-[500px]/sidebar:min-h-[238px]">
          <RoomAvatar members={members} size="lg" />
          <div className="mt-4 flex max-w-full items-center gap-1.5">
            <h2 className="truncate text-xl text-foreground">{roomName}</h2>
            {onOpenRoomSettings ? (
              <button
                aria-label="Edit Room"
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={onOpenRoomSettings}
                title="Edit Room"
                type="button"
              >
                <Icon icon={PencilEdit01Icon} size={14} />
              </button>
            ) : null}
          </div>
          <div
            aria-label={`${members.length} ${members.length === 1 ? "member" : "members"}`}
            className="mt-5 flex h-7 items-center justify-center rounded-full bg-muted px-2.5"
          >
            <div className="flex items-center pl-1">
              {members.slice(0, 7).map((member, index) => (
                <span
                  className={cn(
                    "overflow-hidden rounded-[20%] bg-card ring-1 ring-card",
                    index ? "-ml-1" : false,
                  )}
                  key={member.id}
                >
                  <ActorAvatar
                    actorId={member.id}
                    kind={member.kind}
                    name={member.display_name}
                    size="micro"
                  />
                </span>
              ))}
            </div>
            <span className="ml-1.5 text-2xs tabular-nums text-muted-foreground">
              {members.length}
            </span>
          </div>
        </header>

        <div
          aria-label="Room info sections"
          className="mt-6 flex items-center gap-1"
          role="tablist"
        >
          {INFO_TABS.map((item, index) => {
            const selected = item.id === view;
            return (
              <button
                aria-controls={`${tabIdPrefix}-panel-${item.id}`}
                aria-selected={selected}
                className={cn(
                  "h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors duration-150",
                  selected
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                id={`${tabIdPrefix}-tab-${item.id}`}
                key={item.id}
                onClick={() => setView(item.id)}
                onKeyDown={(event) => {
                  const nextIndex =
                    event.key === "ArrowRight"
                      ? (index + 1) % INFO_TABS.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + INFO_TABS.length) % INFO_TABS.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? INFO_TABS.length - 1
                            : null;
                  if (nextIndex === null) return;
                  const nextTab = INFO_TABS[nextIndex];
                  if (!nextTab) return;
                  event.preventDefault();
                  tabRefs.current[nextIndex]?.focus();
                  setView(nextTab.id);
                }}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          aria-labelledby={`${tabIdPrefix}-tab-${view}`}
          className="pt-2"
          id={`${tabIdPrefix}-panel-${view}`}
          role="tabpanel"
        >
          {view === "members" ? (
            members.length ? (
              <div className="space-y-1">
                {members.map((member) => (
                  <div
                    className="flex items-center gap-3 rounded-lg px-2 py-2"
                    key={member.id}
                  >
                    <ActorAvatar
                      actorId={member.id}
                      kind={member.kind}
                      name={member.display_name}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {member.display_name}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {member.kind}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyInfo icon={UserGroupIcon} label="No members" />
            )
          ) : documents.length ? (
            <div className="space-y-1">
              {documents.map((document) => (
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-300 hover:bg-muted/70"
                  key={document.id}
                  onClick={() => onOpenDocument?.(document)}
                  type="button"
                >
                  <Icon
                    className="text-muted-foreground"
                    icon={File01Icon}
                    size={14}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {document.title}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyInfo icon={File01Icon} label="No Room files" />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyInfo({ icon, label }: { icon: IconSvgElement; label: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border px-3 text-center text-sm text-muted-foreground">
      <Icon className="mr-2" icon={icon} size={14} />
      {label}
    </div>
  );
}
