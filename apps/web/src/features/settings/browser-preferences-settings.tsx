import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { subscribeRecentDocuments } from "@/features/library/recent-documents";
import { subscribeMeetingPlaybackSpeed } from "@/features/memory/meeting-playback-speed";
import { subscribeMeetingResume } from "@/features/memory/meeting-resume";
import { subscribeDesktopNotificationPause } from "@/features/rooms/desktop-notification-pause";
import { subscribeLastRoom } from "@/features/rooms/last-room";
import { subscribeRoomComposerDrafts } from "@/features/rooms/room-drafts";
import { subscribeRoomMentionPreferences } from "@/features/rooms/room-mention-snooze";
import { subscribeRoomSnooze } from "@/features/rooms/room-snooze";
import { subscribeRoomUnreadFilter } from "@/features/rooms/room-unread-filter";
import { subscribeGlobalSearchHistory } from "@/features/search/global-search-recent";
import { subscribeRecentWikiPages } from "@/features/wiki/recent-wiki-pages";

import { browserPreferences } from "./browser-preferences";

/**
 * The one place that drops the preferences this browser keeps on its own. It
 * asks first, reports the outcome, and leaves the Session, the Account, and
 * everything on TeamHub alone.
 */
export function BrowserPreferencesSettings() {
  const headingId = useId();
  const [stored, setStored] = useState(holdsAnything);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<"cleared" | "failed">();

  // Preferences written elsewhere in this tab or another keep the Clear
  // action's availability honest without the person leaving the page.
  useEffect(() => {
    const refresh = () => setStored(holdsAnything());
    const stops = [
      subscribeLastRoom(refresh),
      subscribeRoomComposerDrafts(refresh),
      subscribeRoomMentionPreferences(refresh),
      subscribeRoomSnooze(refresh),
      subscribeRoomUnreadFilter(refresh),
      subscribeDesktopNotificationPause(refresh),
      subscribeGlobalSearchHistory(refresh),
      subscribeRecentDocuments(refresh),
      subscribeMeetingResume(refresh),
      subscribeMeetingPlaybackSpeed(refresh),
      subscribeRecentWikiPages(refresh),
    ];
    refresh();
    return () => {
      for (const stop of stops) stop();
    };
  }, []);

  function clearPreferences() {
    setConfirming(false);
    try {
      for (const preference of browserPreferences) preference.clear();
    } catch {
      setStored(holdsAnything());
      setResult("failed");
      return;
    }
    setStored(holdsAnything());
    // Storage that silently refused the removals still holds something.
    setResult(holdsAnything() ? "failed" : "cleared");
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-border bg-background p-6"
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground" id={headingId}>
          This browser
        </h2>
        {confirming ? null : (
          <Button
            disabled={!stored}
            onClick={() => {
              setResult(undefined);
              setConfirming(true);
            }}
            size="compact"
            tone="secondary"
          >
            Clear
          </Button>
        )}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        These preferences stay on this computer. Clearing them does not sign you
        out, change your Account, or change anything on TeamHub.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {browserPreferences.map((preference) => (
          <li key={preference.label}>{preference.label}</li>
        ))}
      </ul>
      {confirming ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-sm text-foreground">
            Clear every preference listed here?
          </p>
          <Button
            onClick={() => setConfirming(false)}
            size="compact"
            tone="ghost"
          >
            Cancel
          </Button>
          <Button onClick={clearPreferences} size="compact" tone="danger">
            Clear preferences
          </Button>
        </div>
      ) : null}
      {result === "cleared" ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          Preferences cleared
        </p>
      ) : null}
      {result === "failed" ? (
        <p className="mt-3 text-xs text-app-danger" role="alert">
          Preferences could not be cleared
        </p>
      ) : null}
    </section>
  );
}

function holdsAnything() {
  return browserPreferences.some((preference) => preference.hasAnything());
}
