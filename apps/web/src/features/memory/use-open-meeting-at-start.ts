import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { useMeetings } from "./memory-queries";
import { meetingPath } from "./meeting-routes";
import {
  nextMeetingStart,
  openMeetingId,
  shouldOpenMeetingAtStart,
} from "./meeting-begins";

/** setTimeout cannot wait longer than this; a later meeting is armed again. */
const MAX_WAIT_MS = 2_000_000_000;

/**
 * When a meeting's start time arrives, open it from wherever the person is.
 * A meeting already underway when the app opens stays where the person is.
 */
export function useOpenMeetingAtStart(tenantId: string) {
  const meetings = useMeetings(tenantId);
  const navigate = useNavigate();
  const location = useLocation();
  const [generation, setGeneration] = useState(0);
  const next = nextMeetingStart(meetings.data ?? [], Date.now());
  const nextId = next?.id;
  const startMs = next?.startMs;

  useEffect(() => {
    if (!nextId || startMs === undefined) return;
    const start = { id: nextId, startMs };
    const delay = start.startMs - Date.now();
    const timer = window.setTimeout(
      () => {
        const nowMs = Date.now();
        if (nowMs + 1_000 < start.startMs) {
          setGeneration((current) => current + 1);
          return;
        }
        const here = openMeetingId(location.pathname, location.search);
        if (
          !shouldOpenMeetingAtStart({
            alreadyThere: here === start.id,
            dialogOpen: document.querySelector("dialog[open]") !== null,
            nowMs,
            startMs: start.startMs,
            visible: document.visibilityState === "visible",
            writing: personIsWriting(),
          })
        ) {
          return;
        }
        void navigate(meetingPath(tenantId, start.id));
      },
      Math.min(Math.max(delay, 0), MAX_WAIT_MS),
    );
    return () => window.clearTimeout(timer);
  }, [
    generation,
    location.pathname,
    location.search,
    navigate,
    nextId,
    startMs,
    tenantId,
  ]);
}

function personIsWriting() {
  const current = document.activeElement;
  return (
    current instanceof HTMLElement &&
    current.matches("input, textarea, [contenteditable='true']")
  );
}
