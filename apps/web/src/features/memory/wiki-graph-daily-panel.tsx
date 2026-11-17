import {
  Cancel01Icon,
  Copy01Icon,
  HashtagIcon,
  LeftToRightListBulletIcon,
  MessageAdd01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/icon";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router";
import {
  extractRenderedDocumentHeadings,
  type DocumentHeading,
} from "@/components/document-headings";
import { ReadOnlyBlockNoteDocument } from "@/components/read-only-blocknote-document";
import { useDocumentAnchorLinks } from "@/components/document-anchor-links";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { Button, buttonClassName } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { roomMessageSender } from "@/features/rooms/chat/room-message-sender";
import { tenantRoomsQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubRoomListItem } from "@/features/teamhub/teamhub-types";
import { resolveMemoryDocumentLink } from "./memory-document-links";
import {
  reportShare,
  reportShareIdempotencyKey,
  type ReportShare,
} from "./report-share";

import { sameCalendarDay } from "./on-this-day";
import {
  periodLabel,
  reportDate,
  usePeriodReport,
  usePeriodReports,
  type PeriodReportKind,
} from "./wiki-period-reports";
const RESIZE_HANDLES = {
  n: "top edge",
  s: "bottom edge",
  e: "right edge",
  w: "left edge",
  ne: "top right corner",
  nw: "top left corner",
  se: "bottom right corner",
  sw: "bottom left corner",
} as const;
type ResizeDirection = keyof typeof RESIZE_HANDLES;
interface WindowBox {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface WindowBounds {
  width: number;
  height: number;
}
interface CopyNotice {
  state: "copied" | "failed";
  version: string;
}
interface SentReport {
  messageId: string;
  roomId: string;
  roomName: string;
  version: string;
}

function viewportBounds(): WindowBounds {
  return { width: window.innerWidth, height: window.innerHeight };
}

function constrainBox(box: WindowBox, bounds: WindowBounds): WindowBox {
  const availableWidth = Math.max(0, bounds.width - 24);
  const availableHeight = Math.max(0, bounds.height - 24);
  const width = Math.min(
    availableWidth,
    Math.max(Math.min(480, availableWidth), box.width),
  );
  const height = Math.min(
    availableHeight,
    Math.max(Math.min(260, availableHeight), box.height),
  );
  return {
    width,
    height,
    left: Math.max(12, Math.min(box.left, bounds.width - width - 12)),
    top: Math.max(12, Math.min(box.top, bounds.height - height - 12)),
  };
}

function resizeBox(
  box: WindowBox,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  bounds: WindowBounds,
): WindowBox {
  const next = { ...box };
  const minWidth = Math.min(480, bounds.width - 24);
  const minHeight = Math.min(260, bounds.height - 24);
  if (direction.includes("w")) {
    const right = box.left + box.width;
    next.left = Math.max(12, Math.min(box.left + dx, right - minWidth));
    next.width = right - next.left;
  }
  if (direction.includes("e"))
    next.width = Math.max(
      minWidth,
      Math.min(box.width + dx, bounds.width - box.left - 12),
    );
  if (direction.includes("n")) {
    const bottom = box.top + box.height;
    next.top = Math.max(12, Math.min(box.top + dy, bottom - minHeight));
    next.height = bottom - next.top;
  }
  if (direction.includes("s"))
    next.height = Math.max(
      minHeight,
      Math.min(box.height + dy, bounds.height - box.top - 12),
    );
  return next;
}

export function WikiGraphDailyPanel({
  tenantId,
  day,
  kind = "daily",
  onClose,
  onOpenDay,
}: {
  tenantId: string;
  day: string;
  kind?: PeriodReportKind;
  onClose: () => void;
  /** Opens another year's Daily that falls on this month and day. */
  onOpenDay?: (day: string) => void;
}) {
  const label = kind === "daily" ? "Daily" : "Weekly";
  const contentRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLElement>(null);
  const gesture = useRef<{
    mode: "move" | ResizeDirection;
    x: number;
    y: number;
    box: WindowBox;
  } | null>(null);
  const [box, setBox] = useState<WindowBox | null>(null);
  const [tocOpen, setTocOpen] = useState(true);
  const [headings, setHeadings] = useState<DocumentHeading[]>([]);
  const [activeHeading, setActiveHeading] = useState<string>();
  const reports = usePeriodReports(tenantId, kind);
  const otherYears =
    kind === "daily" && onOpenDay
      ? sameCalendarDay(reports.data ?? [], day).slice(0, 4)
      : [];
  const listedEntry = reports.data?.find((item) => reportDate(item) === day);
  const daily = usePeriodReport(tenantId, kind, day, listedEntry);
  const entry = daily.data;
  const { client } = useTeamHubRuntime();
  const share = entry ? reportShare({ day, entry, kind }) : undefined;
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const [copy, setCopy] = useState<CopyNotice>();
  const [sent, setSent] = useState<SentReport>();
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const send = useMutation({
    mutationFn: async (input: {
      room: TeamHubRoomListItem;
      share: ReportShare;
    }) => {
      const { message } = await roomMessageSender(client).createMessage({
        attachments: [],
        body: input.share.text,
        idempotencyKey: reportShareIdempotencyKey(
          input.share.version,
          input.room.id,
        ),
        mentions: [],
        roomId: input.room.id,
      });
      return { messageId: message.id };
    },
    onSuccess: (result, input) =>
      setSent({
        messageId: result.messageId,
        roomId: input.room.id,
        roomName: input.room.name,
        version: input.share.version,
      }),
  });
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const pending =
    reports.isPending || (Boolean(listedEntry) && daily.isPending);
  const error = reports.error ?? daily.error;
  const anchors = useDocumentAnchorLinks(
    contentRef,
    entry ? `${tenantId}:${entry.id}` : undefined,
  );
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    root.scrollTop = 0;
    setActiveHeading(undefined);
    const update = () => {
      const next = extractRenderedDocumentHeadings(root);
      setHeadings((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [day, entry?.id]);
  useEffect(() => {
    const onResize = () =>
      setBox((current) => {
        if (!current) return current;
        const next = constrainBox(current, viewportBounds());
        return JSON.stringify(next) === JSON.stringify(current)
          ? current
          : next;
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function measureBox(): WindowBox | null {
    const element = windowRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }
  function beginGesture(
    event: PointerEvent<HTMLElement>,
    mode: "move" | ResizeDirection,
  ) {
    if (
      event.button !== 0 ||
      (mode === "move" && (event.target as HTMLElement).closest("button"))
    )
      return;
    const measured = measureBox();
    if (!measured) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      mode,
      x: event.clientX,
      y: event.clientY,
      box: measured,
    };
    setBox(measured);
  }
  function moveGesture(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current) return;
    const bounds = viewportBounds();
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    setBox(
      current.mode === "move"
        ? constrainBox(
            {
              ...current.box,
              left: current.box.left + dx,
              top: current.box.top + dy,
            },
            bounds,
          )
        : resizeBox(current.box, current.mode, dx, dy, bounds),
    );
  }

  function jumpToHeading(heading: DocumentHeading) {
    setActiveHeading(heading.id);
    const target = contentRef.current?.querySelector<HTMLElement>(
      `[data-id="${CSS.escape(heading.id)}"]`,
    );
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target?.scrollIntoView({
      behavior: reducedMotion ? "instant" : "smooth",
      block: "start",
    });
  }
  const minHeadingLevel = headings.length
    ? Math.min(...headings.map((heading) => heading.level))
    : 1;
  const copyNotice =
    copy && copy.version === share?.version ? copy.state : undefined;
  const sentReport = sent && sent.version === share?.version ? sent : undefined;
  const sendRefused =
    send.isError && send.variables?.share.version === share?.version;
  const sendableRooms = (rooms.data?.items ?? []).filter(
    (room) => room.kind !== "thread",
  );
  const roomItems: ActionMenuItem[] = !share
    ? []
    : rooms.isPending
      ? [{ disabled: true, label: "Loading Rooms…" }]
      : rooms.error
        ? [{ disabled: true, label: "Rooms are unavailable." }]
        : sendableRooms.length
          ? sendableRooms.map((room) => ({
              disabled: send.isPending,
              icon: (
                <Icon
                  icon={room.kind === "direct" ? UserIcon : HashtagIcon}
                  size={14}
                />
              ),
              label: room.name,
              onSelect: () => send.mutate({ room, share }),
            }))
          : [{ disabled: true, label: "No Rooms available." }];

  async function copyReport(target: ReportShare) {
    let state: CopyNotice["state"];
    try {
      await navigator.clipboard.writeText(target.text);
      state = "copied";
    } catch {
      state = "failed";
    }
    setCopy({ state, version: target.version });
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopy((current) =>
        current?.version === target.version ? undefined : current,
      );
    }, 3_000);
  }

  return (
    <ModalDialog
      ariaLabel={`${label} report for ${periodLabel(day, kind)}`}
      className="wiki-graph-daily-dialog"
      closeOnBackdrop
      onClose={onClose}
    >
      <aside
        ref={windowRef}
        aria-label={`${label} report`}
        className="wiki-graph-daily-panel"
        style={box ?? undefined}
        onPointerMove={moveGesture}
        onPointerUp={() => {
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
      >
        <header
          className="wiki-graph-daily-header"
          onPointerDown={(event) => beginGesture(event, "move")}
        >
          <div className="min-w-0">
            <p className="wiki-graph-daily-eyebrow">{label} summary</p>
            <h2>
              <time dateTime={day}>{periodLabel(day, kind)}</time>
            </h2>
            {otherYears.length ? (
              <nav
                aria-label="Also on this day"
                className="mt-1 flex flex-wrap items-center gap-1"
              >
                <span className="text-xs text-app-muted">Also on this day</span>
                {otherYears.map((item) => (
                  <Button
                    key={item.day}
                    onClick={() => onOpenDay?.(item.day)}
                    size="compact"
                    tone="ghost"
                  >
                    {item.day.slice(0, 4)}
                  </Button>
                ))}
              </nav>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {share?.text ? (
              <>
                <Button
                  aria-label="Copy report"
                  onClick={() => void copyReport(share)}
                  size="icon"
                  title="Copy report"
                  tone="ghost"
                >
                  <Icon icon={Copy01Icon} size={16} />
                </Button>
                <ActionMenu
                  buttonClassName={buttonClassName({
                    size: "icon",
                    tone: "ghost",
                  })}
                  items={roomItems}
                  label="Send to Room"
                  placement="bottom-end"
                  trigger={
                    <span
                      className="inline-flex items-center"
                      title="Send to Room"
                    >
                      <Icon icon={MessageAdd01Icon} size={16} />
                    </span>
                  }
                />
              </>
            ) : null}
            <Button
              aria-label={`Toggle ${label} contents`}
              aria-expanded={tocOpen}
              title="Contents"
              onClick={() => setTocOpen((open) => !open)}
              size="icon"
              tone="ghost"
            >
              <Icon icon={LeftToRightListBulletIcon} size={16} />
            </Button>
            <Button
              aria-label={`Close ${label}`}
              onClick={onClose}
              size="icon"
              tone="ghost"
            >
              <Icon icon={Cancel01Icon} size={16} />
            </Button>
          </div>
        </header>
        {copyNotice || sentReport || sendRefused ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5 text-xs">
            {copyNotice === "copied" ? <span role="status">Copied</span> : null}
            {copyNotice === "failed" ? (
              <span role="alert">
                Copy failed. Select the report text and copy it yourself.
              </span>
            ) : null}
            {sentReport ? (
              <span role="status" className="inline-flex items-center gap-1">
                Sent to {sentReport.roomName}.
                <Link
                  className="underline underline-offset-2"
                  to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(sentReport.roomId)}/chat?message=${encodeURIComponent(sentReport.messageId)}`}
                >
                  Open message
                </Link>
              </span>
            ) : null}
            {sendRefused ? (
              <span role="alert">
                {send.error?.message ||
                  "The report could not be sent to the Room."}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="wiki-graph-daily-reading">
          {tocOpen && headings.length > 0 ? (
            <nav
              aria-label={`${label} contents`}
              className="wiki-graph-daily-toc workspace-scrollbar"
            >
              <p>Contents</p>
              {headings.map((heading) => (
                <button
                  key={heading.id}
                  type="button"
                  style={{
                    paddingLeft: 12 + (heading.level - minHeadingLevel) * 12,
                  }}
                  aria-current={
                    activeHeading === heading.id ? "location" : undefined
                  }
                  onClick={() => jumpToHeading(heading)}
                >
                  {heading.text}
                </button>
              ))}
            </nav>
          ) : null}
          <div
            ref={contentRef}
            className="wiki-graph-daily-content workspace-scrollbar"
            onClickCapture={anchors.openAnchor}
            onKeyDownCapture={(event) => {
              if (event.key === "Enter") anchors.openAnchor(event);
            }}
          >
            {pending ? (
              <p role="status" className="p-6 text-sm text-app-muted">
                Loading {label}…
              </p>
            ) : error ? (
              <div role="alert" className="p-6 text-sm">
                <p className="text-app-danger">{error.message}</p>
                <Button
                  className="mt-3"
                  onClick={() =>
                    void (reports.error ? reports.refetch() : daily.refetch())
                  }
                  tone="secondary"
                >
                  Retry {label}
                </Button>
              </div>
            ) : entry ? (
              <ReadOnlyBlockNoteDocument
                ariaLabel={`${day} ${label} content`}
                markdown={entry.content || entry.summary}
                presentation="knowledge"
                documentTitle={entry.title}
                resolveLink={resolveMemoryDocumentLink}
              />
            ) : (
              <p className="p-6 text-sm text-app-muted">
                No {label} report for this {kind === "daily" ? "day" : "week"}.
              </p>
            )}
            {anchors.error ? (
              <p role="alert" className="px-6 py-2 text-sm text-app-danger">
                {anchors.error}
              </p>
            ) : null}
          </div>
        </div>
        {(Object.keys(RESIZE_HANDLES) as ResizeDirection[]).map((direction) => (
          <button
            key={direction}
            type="button"
            className="wiki-graph-daily-resize"
            data-direction={direction}
            aria-label={`Resize ${label} ${RESIZE_HANDLES[direction]}`}
            onPointerDown={(event) => beginGesture(event, direction)}
            onKeyDown={(event) => {
              const measured = measureBox();
              const bounds = viewportBounds();
              if (
                !measured ||
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              setBox(
                resizeBox(
                  measured,
                  direction,
                  event.key === "ArrowRight"
                    ? 16
                    : event.key === "ArrowLeft"
                      ? -16
                      : 0,
                  event.key === "ArrowDown"
                    ? 16
                    : event.key === "ArrowUp"
                      ? -16
                      : 0,
                  bounds,
                ),
              );
            }}
          />
        ))}
      </aside>
    </ModalDialog>
  );
}
