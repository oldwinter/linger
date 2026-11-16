import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

import {
  filterKeyboardShortcutGroups,
  type KeyboardShortcutGroup,
} from "./keyboard-shortcuts";
import { SettingsPageHeading } from "./settings-page-heading";
import { playedShortcuts, type PlayedShortcut } from "./shortcut-rehearsal";

export function ShortcutsSettingsPage() {
  const [query, setQuery] = useState("");
  const [played, setPlayed] = useState<PlayedShortcut[]>([]);
  const groups = filterKeyboardShortcutGroups(query);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      const matches = playedShortcuts(event);
      if (matches.length === 0) return;
      setPlayed(matches);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description="The keys this app responds to, grouped by where they work."
        title="Shortcuts"
      />

      <label className="flex w-full cursor-text items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
        <Icon
          icon={Search01Icon}
          className="shrink-0 text-muted-foreground"
          size={15}
        />
        <input
          aria-label="Filter shortcuts"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !query) return;
            event.preventDefault();
            setQuery("");
          }}
          placeholder="Filter by action, section, or key"
          role="searchbox"
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label="Clear shortcuts filter"
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setQuery("")}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={13} />
          </button>
        ) : null}
      </label>

      <ShortcutStage played={played} />

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-border bg-background p-6 text-sm text-muted-foreground">
          No shortcuts match that filter.
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
                    <dt className="text-sm text-foreground">
                      {shortcut.action}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1.5">
                      <KeyCap>{shortcut.keys.mac}</KeyCap>
                      {shortcut.keys.other === undefined ? null : (
                        <>
                          <span className="text-xs text-muted-foreground">
                            or
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
  return (
    <section
      aria-label="Shortcut you pressed"
      aria-live="polite"
      className="rounded-2xl border border-border bg-background p-6"
    >
      {played.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Press a shortcut. This page says what it does, and where.
        </p>
      ) : (
        <>
          <p className="font-mono text-3xl text-foreground">
            {played[0]?.chord}
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {played.map((item) => (
              <li key={`${item.where}\n${item.action}`}>
                <p className="text-sm text-foreground">{item.action}</p>
                <p className="text-sm text-muted-foreground">{item.where}</p>
              </li>
            ))}
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
