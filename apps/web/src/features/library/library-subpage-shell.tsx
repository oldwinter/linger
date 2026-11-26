import { ArrowLeft02Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { librarySubpagesMessages as m } from "./library-subpages.messages";
import { WORKSPACE_TREE_ID, useWorkspaceTree } from "./workspace-tree";

export interface LibrarySubpageShellProps {
  /** Destination for the top Back link. */
  backTo: string;
  /** Accessible label for the top Back link. */
  backLabel: string;
  /** Optional eyebrow label above the page title. */
  eyebrow?: string;
  /** Optional page heading. */
  title?: string;
  /** Optional subtitle shown beneath the heading. */
  subtitle?: ReactNode;
  /** Optional secondary navigation or cross-links in the top bar. */
  headerActions?: ReactNode;
  /** Optional segmented view tabs rendered in the header block. */
  viewTabs?: ReactNode;
  /** Optional extra header controls rendered inside the header block. */
  headerExtra?: ReactNode;
  /** Optional max-width utility; defaults to `max-w-2xl`. */
  maxWidthClassName?: string;
  children: ReactNode;
}

/**
 * Shared scrollable frame for Library, Memory, Wiki, and Document subpages.
 * Keeps a sticky top navigation bar, mobile sidebar drawer access when the
 * layout renders a sidebar, optional view tabs, and consistent heading elevation.
 */
export function LibrarySubpageShell({
  backTo,
  backLabel,
  eyebrow,
  title,
  subtitle,
  headerActions,
  viewTabs,
  headerExtra,
  maxWidthClassName = "max-w-2xl",
  children,
}: LibrarySubpageShellProps) {
  const workspaceTree = useWorkspaceTree();
  const t = useT();
  const hasHeader =
    eyebrow !== undefined ||
    title !== undefined ||
    subtitle !== undefined ||
    viewTabs !== undefined ||
    headerExtra !== undefined;

  return (
    <main className="workspace-content-viewport workspace-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto bg-app-surface">
      <div className="sticky top-0 z-10 border-b border-border/70 bg-app-surface/95 backdrop-blur-sm">
        <div
          className={cn(
            "mx-auto flex w-full flex-wrap items-center justify-between gap-2 px-6 py-3",
            maxWidthClassName,
          )}
        >
          <div className="flex items-center gap-2">
            {workspaceTree.hasList ? (
              <Button
                aria-controls={WORKSPACE_TREE_ID}
                aria-expanded={workspaceTree.open}
                aria-label={t(m.openLibraryPages)}
                className="sm:hidden"
                onClick={() => workspaceTree.setOpen(true)}
                size="icon"
                title={t(m.libraryPagesTitle)}
                tone="ghost"
              >
                <Icon icon={SidebarLeftIcon} size={16} />
              </Button>
            ) : null}
            <Link
              className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={backTo}
            >
              <Icon icon={ArrowLeft02Icon} size={14} />
              {backLabel}
            </Link>
          </div>
          {headerActions ? (
            <div className="flex flex-wrap items-center gap-3">
              {headerActions}
            </div>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-6 px-6 py-6 sm:py-8",
          maxWidthClassName,
        )}
      >
        {hasHeader ? (
          <header className="flex flex-col gap-3 border-b border-border/60 pb-5">
            {eyebrow ? (
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                {eyebrow}
              </p>
            ) : null}
            {title !== undefined ? (
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
            ) : null}
            {subtitle ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
            {viewTabs ? <div className="pt-0.5">{viewTabs}</div> : null}
            {headerExtra}
          </header>
        ) : null}
        {children}
      </div>
    </main>
  );
}
