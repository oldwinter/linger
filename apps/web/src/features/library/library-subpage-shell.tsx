import { ArrowLeft02Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

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
  /** Optional extra header controls rendered inside the header block. */
  headerExtra?: ReactNode;
  /** Optional max-width utility; defaults to `max-w-2xl`. */
  maxWidthClassName?: string;
  children: ReactNode;
}

/**
 * Shared scrollable frame for Library, Memory, Wiki, and Document subpages.
 * Keeps top Back navigation, mobile sidebar drawer access when the layout
 * renders a sidebar, and a consistent heading hierarchy across every subpage.
 */
export function LibrarySubpageShell({
  backTo,
  backLabel,
  eyebrow,
  title,
  subtitle,
  headerActions,
  headerExtra,
  maxWidthClassName = "max-w-2xl",
  children,
}: LibrarySubpageShellProps) {
  const workspaceTree = useWorkspaceTree();
  const hasHeader =
    eyebrow !== undefined ||
    title !== undefined ||
    subtitle !== undefined ||
    headerExtra !== undefined;

  return (
    <main className="workspace-content-viewport workspace-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto bg-app-surface px-6 py-8">
      <div
        className={cn("mx-auto flex w-full flex-col gap-6", maxWidthClassName)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {workspaceTree.hasList ? (
              <Button
                aria-controls={WORKSPACE_TREE_ID}
                aria-expanded={workspaceTree.open}
                aria-label="Open Library pages"
                className="sm:hidden"
                onClick={() => workspaceTree.setOpen(true)}
                size="icon"
                title="Library pages"
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
        {hasHeader ? (
          <header className="flex flex-col gap-2">
            {eyebrow ? (
              <p className="text-sm text-muted-foreground">{eyebrow}</p>
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
            {headerExtra}
          </header>
        ) : null}
        {children}
      </div>
    </main>
  );
}
