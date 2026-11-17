import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RoomDraftScope } from "../room-drafts";

// Presentation-only, bounded to recently visited Rooms in this browser tab.
// No message content or durable event cursor lives here.
const readingPositions = new Map<
  string,
  {
    firstMessageId?: string;
    scrollTop: number;
    atBottom: boolean;
  }
>();

/** Content changes this soon after the reader's own input are theirs to keep. */
const INPUT_SETTLE_MS = 1_000;

/**
 * Sitting still in an open room this long, with nothing new arriving, lets
 * the lane rest. The next message no longer pulls the view. This is longer
 * than the gap that starts a new conversation, and it is not leaving the room.
 */
export const QUIET_ROOM_MS = 15 * 60 * 1000;

/** The first Message row in view, and where it sat when the lane was this wide. */
interface ReadingAnchor {
  element: Element;
  offset: number;
  width: number;
}

interface PendingPrepend {
  firstMessageId?: string;
  scrollHeight: number;
  scrollTop: number;
}

interface RoomTimelineScrollOptions {
  firstMessageId?: string;
  /** A question from yesterday that leads until it is cleared. */
  leadingMessageId?: string | null;
  linkedMessageId: string | null;
  linkedMessageReady?: boolean;
  messageCount: number;
  pendingMessageCount: number;
  progressVersion?: string;
  scope?: RoomDraftScope;
}

export function useRoomTimelineScroll({
  firstMessageId,
  leadingMessageId = null,
  linkedMessageId,
  linkedMessageReady,
  messageCount,
  pendingMessageCount,
  progressVersion = "",
  scope,
}: RoomTimelineScrollOptions) {
  const scopeKey = scope
    ? JSON.stringify([
        scope.accountId,
        scope.tenantId,
        scope.roomId,
        scope.threadId,
      ])
    : undefined;
  const [timelineElement, setTimelineElement] = useState<HTMLDivElement | null>(
    null,
  );
  const previousTimelineRef = useRef<HTMLDivElement | null>(null);
  const [initialScrollReady, setInitialScrollReady] = useState(false);
  const unreadDividerRef = useRef<HTMLDivElement | null>(null);
  const [unreadDividerVisible, setUnreadDividerVisible] = useState(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const shouldAutoFollowRef = useRef(true);
  const pendingPrependRef = useRef<PendingPrepend | null>(null);
  const readingAnchorRef = useRef<ReadingAnchor | null>(null);
  // The scroll event of a resize correction arrives a frame late, after the
  // lane may have reflowed again; it must not count as the reader's choice.
  const correctedScrollTopRef = useRef<number | null>(null);
  const linkedPositionRef = useRef<{
    key: string;
    positioned: boolean;
  } | null>(null);
  const anchoredRef = useRef(false);

  useLayoutEffect(() => {
    const timeline = timelineElement;

    if (!timeline) {
      return;
    }
    if (previousTimelineRef.current !== timeline) {
      previousTimelineRef.current = timeline;
      shouldAutoFollowRef.current = true;
      pendingPrependRef.current = null;
      linkedPositionRef.current = null;
      anchoredRef.current = false;
      const position = scopeKey ? readingPositions.get(scopeKey) : undefined;
      if (
        !linkedMessageId &&
        !leadingMessageId &&
        position &&
        !position.atBottom &&
        position.firstMessageId === firstMessageId
      ) {
        timeline.scrollTop = position.scrollTop;
        shouldAutoFollowRef.current = false;
      }
    }
    const anchorId = linkedMessageId || leadingMessageId || null;
    const linkKey = JSON.stringify([
      scopeKey,
      linkedMessageId,
      leadingMessageId,
    ]);
    if (linkedPositionRef.current?.key !== linkKey) {
      linkedPositionRef.current = { key: linkKey, positioned: false };
    }

    const pendingPrepend = pendingPrependRef.current;
    if (pendingPrepend && pendingPrepend.firstMessageId !== firstMessageId) {
      timeline.scrollTop =
        pendingPrepend.scrollTop +
        (timeline.scrollHeight - pendingPrepend.scrollHeight);
      pendingPrependRef.current = null;
      shouldAutoFollowRef.current = isNearTimelineBottom(timeline);
      setInitialScrollReady(true);
      setAwayFromLatest(!isNearTimelineBottom(timeline));
      setUnreadDividerVisible(
        unreadDividerIsInView(timeline, unreadDividerRef.current),
      );
      return;
    }
    if (anchorId && !linkedPositionRef.current.positioned) {
      const target = timeline.querySelector(
        `[data-message-id="${CSS.escape(anchorId)}"]`,
      );
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "center", inline: "nearest" });
        linkedPositionRef.current.positioned = true;
      } else {
        timeline.scrollTop = 0;
      }
      anchoredRef.current = true;
      shouldAutoFollowRef.current = false;
      setInitialScrollReady(true);
      setAwayFromLatest(!isNearTimelineBottom(timeline));
      setUnreadDividerVisible(
        unreadDividerIsInView(timeline, unreadDividerRef.current),
      );
      return;
    }
    if (!anchorId && anchoredRef.current) {
      anchoredRef.current = false;
      shouldAutoFollowRef.current = true;
    }

    if (!pendingPrepend && shouldAutoFollowRef.current) {
      timeline.scrollTop = timeline.scrollHeight;
    }

    shouldAutoFollowRef.current = isNearTimelineBottom(timeline);
    setInitialScrollReady(true);
    setAwayFromLatest(!isNearTimelineBottom(timeline));
    setUnreadDividerVisible(
      unreadDividerIsInView(timeline, unreadDividerRef.current),
    );
  }, [
    timelineElement,
    firstMessageId,
    leadingMessageId,
    linkedMessageId,
    linkedMessageReady,
    messageCount,
    pendingMessageCount,
    progressVersion,
    scopeKey,
  ]);

  useLayoutEffect(() => {
    const timeline = timelineElement;
    if (!timeline || typeof ResizeObserver === "undefined") {
      return;
    }
    // The panel sidebar animates the chat lane narrower, and content that
    // finishes rendering after the Room opens (images, code, embedded HTML)
    // grows the timeline. Either reflow would otherwise lift a reader who sat
    // at the newest Message off the bottom for a frame before the next render
    // caught up; ResizeObserver re-pins before that frame is painted. Content
    // the reader just changed themselves (Show more, a toggle) stays where
    // they put it, so the control they pressed does not slide away.
    let lastInputAt = -Infinity;
    const noteInput = () => {
      lastInputAt = performance.now();
    };
    const correct = (scrollTop: number) => {
      const before = timeline.scrollTop;
      timeline.scrollTop = scrollTop;
      setAwayFromLatest(!isNearTimelineBottom(timeline));
      if (timeline.scrollTop !== before) {
        correctedScrollTopRef.current = timeline.scrollTop;
      }
    };
    const observer = new ResizeObserver((entries) => {
      setAwayFromLatest(!isNearTimelineBottom(timeline));
      if (!shouldAutoFollowRef.current) {
        // A reader above the newest Message keeps the Message they were
        // reading in place while the lane narrows or widens and its text
        // rewraps; the timeline disables browser scroll anchoring.
        const anchor = readingAnchorRef.current;
        if (
          !anchor ||
          anchor.width === timeline.clientWidth ||
          !anchor.element.isConnected
        ) {
          return;
        }
        anchor.width = timeline.clientWidth;
        correct(
          timeline.scrollTop +
            anchor.element.getBoundingClientRect().top -
            timeline.getBoundingClientRect().top -
            anchor.offset,
        );
        setUnreadDividerVisible(
          unreadDividerIsInView(timeline, unreadDividerRef.current),
        );
        return;
      }
      const contentOnly = entries.every((entry) => entry.target !== timeline);
      if (contentOnly && performance.now() - lastInputAt < INPUT_SETTLE_MS) {
        return;
      }
      correct(timeline.scrollHeight);
      setUnreadDividerVisible(
        unreadDividerIsInView(timeline, unreadDividerRef.current),
      );
    });

    observer.observe(timeline);
    // The timeline's content lane mounts with it and stays for its lifetime.
    for (const child of timeline.children) observer.observe(child);
    timeline.addEventListener("pointerdown", noteInput, true);
    timeline.addEventListener("keydown", noteInput, true);
    return () => {
      observer.disconnect();
      timeline.removeEventListener("pointerdown", noteInput, true);
      timeline.removeEventListener("keydown", noteInput, true);
    };
  }, [timelineElement]);

  useEffect(() => {
    if (!timelineElement) return;
    let timer = window.setTimeout(() => {
      shouldAutoFollowRef.current = false;
    }, QUIET_ROOM_MS);
    const wake = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        shouldAutoFollowRef.current = false;
      }, QUIET_ROOM_MS);
    };
    document.addEventListener("pointerdown", wake, true);
    document.addEventListener("keydown", wake, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", wake, true);
      document.removeEventListener("keydown", wake, true);
    };
  }, [messageCount, pendingMessageCount, timelineElement]);

  function prepareForOlderMessages() {
    const timeline = timelineElement;

    if (!timeline) {
      return;
    }
    pendingPrependRef.current = {
      firstMessageId,
      scrollHeight: timeline.scrollHeight,
      scrollTop: timeline.scrollTop,
    };
  }

  function cancelOlderMessagesIfUnchanged(nextFirstMessageId?: string) {
    if (nextFirstMessageId === pendingPrependRef.current?.firstMessageId) {
      pendingPrependRef.current = null;
    }
  }

  function recordTimelineScroll(timeline: HTMLDivElement) {
    const corrected = correctedScrollTopRef.current === timeline.scrollTop;
    correctedScrollTopRef.current = null;
    setAwayFromLatest(!isNearTimelineBottom(timeline));
    if (!corrected) {
      shouldAutoFollowRef.current = isNearTimelineBottom(timeline);
      readingAnchorRef.current = shouldAutoFollowRef.current
        ? null
        : readingAnchor(timeline);
    }
    setUnreadDividerVisible(
      unreadDividerIsInView(timeline, unreadDividerRef.current),
    );
    if (scopeKey) {
      readingPositions.delete(scopeKey);
      readingPositions.set(scopeKey, {
        firstMessageId,
        scrollTop: timeline.scrollTop,
        atBottom: shouldAutoFollowRef.current,
      });
      if (readingPositions.size > 50) {
        readingPositions.delete(readingPositions.keys().next().value!);
      }
    }
  }

  function pinToLatest() {
    shouldAutoFollowRef.current = true;
  }

  /** Returns to the "New messages" divider when it has scrolled out of view. */
  function jumpToUnreadDivider() {
    const divider = unreadDividerRef.current;
    if (!divider) return;
    // Going back to the divider is the reader's own move, so Messages that
    // arrive afterwards must not pull the lane to the bottom again.
    shouldAutoFollowRef.current = false;
    divider.scrollIntoView({ block: "center", inline: "nearest" });
  }

  function scrollToLatest() {
    const timeline = timelineElement;
    if (!timeline) {
      return;
    }
    // An instant jump: a smooth scroll's intermediate scroll events would
    // switch following off and aim at a bottom that streaming has moved.
    shouldAutoFollowRef.current = true;
    timeline.scrollTop = timeline.scrollHeight;
    setAwayFromLatest(false);
  }

  /** Whether the reader follows the newest Message rather than history. */
  function isFollowingLatest() {
    return (
      timelineElement !== null &&
      pendingPrependRef.current === null &&
      shouldAutoFollowRef.current
    );
  }

  return {
    awayFromLatest,
    cancelOlderMessagesIfUnchanged,
    initialScrollReady,
    isFollowingLatest,
    jumpToUnreadDivider,
    pinToLatest,
    prepareForOlderMessages,
    recordTimelineScroll,
    scrollToLatest,
    timelineElement,
    timelineRef: setTimelineElement,
    unreadDividerRef,
    unreadDividerVisible,
  };
}

function readingAnchor(timeline: HTMLDivElement): ReadingAnchor | null {
  const rows = timeline.querySelectorAll("[data-message-id]");
  const top = timeline.getBoundingClientRect().top;
  // Rows are in reading order, so the first one still in view is found in
  // a few layout reads even in a long history.
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (rows[middle]!.getBoundingClientRect().bottom > top) high = middle;
    else low = middle + 1;
  }
  const element = rows[low];
  return element
    ? {
        element,
        offset: element.getBoundingClientRect().top - top,
        width: timeline.clientWidth,
      }
    : null;
}

function isNearTimelineBottom(timeline: HTMLDivElement) {
  return (
    timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 80
  );
}

/** Whether the divider is inside the viewport, not merely mounted above it. */
function unreadDividerIsInView(
  timeline: HTMLDivElement,
  divider: HTMLDivElement | null,
) {
  if (!divider) return true;
  const dividerRect = divider.getBoundingClientRect();
  const timelineRect = timeline.getBoundingClientRect();
  return (
    dividerRect.bottom > timelineRect.top &&
    dividerRect.top < timelineRect.bottom
  );
}
