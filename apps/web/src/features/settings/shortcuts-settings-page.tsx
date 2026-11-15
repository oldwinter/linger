import type { ReactNode } from "react";

import { keyboardShortcutGroups } from "./keyboard-shortcuts";
import { SettingsPageHeading } from "./settings-page-heading";

export function ShortcutsSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description="The keys this app responds to, grouped by where they work."
        title="Shortcuts"
      />

      {keyboardShortcutGroups.map((group, index) => {
        const headingId = `shortcuts-group-${index}`;
        return (
          <section
            aria-labelledby={headingId}
            className="rounded-2xl border border-border bg-background p-6"
            key={group.title}
          >
            <h2 className="text-sm font-medium text-foreground" id={headingId}>
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
                  <dt className="text-sm text-foreground">{shortcut.action}</dt>
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
      })}
    </div>
  );
}

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-xs text-foreground">
      {children}
    </kbd>
  );
}
