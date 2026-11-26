import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import {
  filterKeyboardShortcutGroups,
  keyboardShortcutGroups,
  type KeyboardShortcutGroup,
} from "./keyboard-shortcuts";
import { SettingsPageHeading } from "./settings-page-heading";
import { playedShortcuts, type PlayedShortcut } from "./shortcut-rehearsal";
import { shortcutsSettingsMessages as m } from "./shortcuts-settings.messages";

const shortcutTextMessages: Readonly<Record<string, Message<string>>> = {
  Global: m.groupGlobalTitle,
  "Works anywhere in a Room.": m.groupGlobalDescription,
  "Search dialog": m.groupSearchTitle,
  "Works while the search dialog has focus.": m.groupSearchDescription,
  "Chat composer": m.groupComposerTitle,
  "Works while the message field has focus.": m.groupComposerDescription,
  "Room Document editor": m.groupDocumentTitle,
  "Works while the Room Document editor has focus.": m.groupDocumentDescription,
  "Work Items board": m.groupBoardTitle,
  "Works on the Work Items board when no input or dialog has focus.":
    m.groupBoardDescription,
  "Wiki directory": m.groupWikiTitle,
  "Works in the Wiki directory.": m.groupWikiDescription,
  "Meeting audio player": m.groupMeetingAudioTitle,
  "Works on a Meeting detail page when a recording is ready.":
    m.groupMeetingAudioDescription,
  "Open search": m.actionOpenSearch,
  "Jump to a room, meeting, or library place": m.actionJump,
  "Search in current room": m.actionSearchInRoom,
  "Close the active sidebar tab, or collapse the sidebar": m.actionCloseSidebar,
  "Reopen the last closed sidebar tab": m.actionReopenSidebar,
  "Switch to the previous or next sidebar tab": m.actionSwitchSidebar,
  "Move through search results": m.actionMoveSearchResults,
  "Open the highlighted search result": m.actionOpenSearchResult,
  "Narrow search to the highlighted result type": m.actionNarrowSearch,
  "Return to all search scopes when the query is empty":
    m.actionReturnAllScopes,
  "Remove the highlighted recent search when the query is empty":
    m.actionRemoveRecentSearch,
  "Close the search dialog": m.actionCloseSearchDialog,
  "Send the message": m.actionSendMessage,
  "Start a new line": m.actionNewLine,
  "Move through mention and skill suggestions": m.actionMoveSuggestions,
  "Insert the highlighted suggestion": m.actionInsertSuggestion,
  "Dismiss the suggestions": m.actionDismissSuggestions,
  "Select everything in the Document": m.actionSelectAllDocument,
  "Continue a list in a table cell": m.actionContinueTableList,
  "Select the next Work Item card": m.actionSelectNextCard,
  "Select the previous Work Item card": m.actionSelectPrevCard,
  "Peek the selected Work Item card": m.actionPeekCard,
  "Clear the Work Item card selection": m.actionClearCardSelection,
  "Focus the Wiki page filter": m.actionFocusWikiFilter,
  "Clear and leave the active Wiki page filter": m.actionClearWikiFilter,
  "Play or pause the Meeting recording": m.actionPlayPauseMeeting,
  "Seek backward or forward 5 seconds": m.actionSeekMeeting,
  "Desktop app only — browsers reserve this shortcut to reopen closed tabs.":
    m.noteDesktopOnlyReopenTab,
};

export function ShortcutsSettingsPage() {
  const t = useT();
  const translateShortcutText = (text: string) => {
    const message = shortcutTextMessages[text];
    return message ? t(message) : text;
  };
  const localizedGroups: readonly KeyboardShortcutGroup[] =
    keyboardShortcutGroups.map((group) => ({
      description: translateShortcutText(group.description),
      shortcuts: group.shortcuts.map((shortcut) => ({
        ...shortcut,
        action: translateShortcutText(shortcut.action),
        note: shortcut.note ? translateShortcutText(shortcut.note) : undefined,
      })),
      title: translateShortcutText(group.title),
    }));
  const [query, setQuery] = useState("");
  const [played, setPlayed] = useState<PlayedShortcut[]>([]);
  const groups = filterKeyboardShortcutGroups(query, localizedGroups);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || event.keyCode === 229) return;
      if (
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        )
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
        )
      ) {
        return;
      }
      const matches = playedShortcuts(event);
      if (matches.length === 0) return;
      if (event.key !== "Tab") {
        event.preventDefault();
        event.stopPropagation();
      }
      setPlayed(matches);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading description={t(m.description)} title={t(m.title)} />

      <label className="flex w-full cursor-text items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
        <Icon
          icon={Search01Icon}
          className="shrink-0 text-muted-foreground"
          size={16}
        />
        <input
          aria-label={t(m.filterShortcuts)}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-app-placeholder"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !query) return;
            event.preventDefault();
            setQuery("");
          }}
          placeholder={t(m.filterPlaceholder)}
          role="searchbox"
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label={t(m.clearFilter)}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setQuery("")}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        ) : null}
      </label>

      <ShortcutStage played={played} />

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-border bg-background p-6 text-sm text-muted-foreground">
          {t(m.noMatching)}
        </p>
      ) : (
        groups.map((group: KeyboardShortcutGroup, index) => {
          const headingId = `shortcuts-group-${index}`;
          return (
            <section
              aria-labelledby={headingId}
              className="rounded-2xl border border-border bg-background p-6"
              key={group.title}
            >
              <h2
                className="text-sm font-medium text-foreground"
                id={headingId}
              >
                {group.title}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {group.description}
              </p>
              <dl className="mt-4 divide-y divide-border">
                {group.shortcuts.map((shortcut) => (
                  <div
                    className="flex items-center justify-between gap-4 py-2.5"
                    key={shortcut.action}
                  >
                    <dt className="min-w-0 text-sm text-foreground">
                      <span>{shortcut.action}</span>
                      {shortcut.note ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {shortcut.note}
                        </span>
                      ) : null}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1.5">
                      <KeyCap>{shortcut.keys.mac}</KeyCap>
                      {shortcut.keys.other === undefined ? null : (
                        <>
                          <span className="text-xs text-muted-foreground">
                            {t(m.or)}
                          </span>
                          <KeyCap>{shortcut.keys.other}</KeyCap>
                        </>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })
      )}
    </div>
  );
}

function ShortcutStage({ played }: { played: PlayedShortcut[] }) {
  const t = useT();
  return (
    <section
      aria-label={t(m.stageLabel)}
      aria-live="polite"
      className="rounded-2xl border border-border bg-background p-6"
    >
      {played.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(m.pressPrompt)}</p>
      ) : (
        <>
          <p className="font-mono text-3xl text-foreground">
            {played[0]?.chord}
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {played.map((item) => {
              const actionMsg = shortcutTextMessages[item.action];
              const whereMsg = shortcutTextMessages[item.where];
              return (
                <li key={`${item.where}\n${item.action}`}>
                  <p className="text-sm text-foreground">
                    {actionMsg ? t(actionMsg) : item.action}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {whereMsg ? t(whereMsg) : item.where}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-xs text-foreground">
      {children}
    </kbd>
  );
}
