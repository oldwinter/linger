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
import { commonMessages } from "@/i18n/common.messages";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import { accountSettingsMessages as m } from "./account-settings.messages";
import { browserPreferences } from "./browser-preferences";

const browserPreferenceLabels: Readonly<Record<string, Message<string>>> = {
  "features/rooms/last-room.ts": m.prefLastOpenedRoom,
  "features/rooms/room-drafts.ts": m.prefComposerDrafts,
  "features/rooms/room-mention-snooze.ts": m.prefRoomMentionPreferences,
  "features/rooms/room-snooze.ts": m.prefSnoozedRooms,
  "features/rooms/room-unread-filter.ts": m.prefRoomListFilter,
  "features/rooms/desktop-notification-pause.ts":
    m.prefDesktopNotificationPause,
  "features/search/global-search-recent.ts": m.prefRecentSearches,
  "features/library/recent-documents.ts": m.prefRecentDocuments,
  "features/memory/meeting-resume.ts": m.prefMeetingResume,
  "features/memory/meeting-playback-speed.ts": m.prefMeetingPlaybackSpeed,
  "features/wiki/recent-wiki-pages.ts": m.prefRecentWikiPages,
};

/**
 * The one place that drops the preferences this browser keeps on its own. It
 * asks first, reports the outcome, and leaves the Session, the Account, and
 * everything on TeamHub alone.
 */
export function BrowserPreferencesSettings() {
  const t = useT();
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
          {t(m.thisBrowser)}
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
            {t(m.clear)}
          </Button>
        )}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {t(m.thisBrowserHint)}
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {browserPreferences.map((preference) => {
          const message = browserPreferenceLabels[preference.module];
          return (
            <li key={preference.label}>
              {message ? t(message) : preference.label}
            </li>
          );
        })}
      </ul>
      {confirming ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-sm text-foreground">
            {t(m.clearPreferencesConfirm)}
          </p>
          <Button
            onClick={() => setConfirming(false)}
            size="compact"
            tone="ghost"
          >
            {t(commonMessages.cancel)}
          </Button>
          <Button
            data-voice-risk="never"
            onClick={clearPreferences}
            size="compact"
            tone="danger"
          >
            {t(m.clearPreferences)}
          </Button>
        </div>
      ) : null}
      {result === "cleared" ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {t(m.preferencesCleared)}
        </p>
      ) : null}
      {result === "failed" ? (
        <p className="mt-3 text-xs text-app-danger" role="alert">
          {t(m.preferencesClearFailed)}
        </p>
      ) : null}
    </section>
  );
}

function holdsAnything() {
  return browserPreferences.some((preference) => preference.hasAnything());
}
