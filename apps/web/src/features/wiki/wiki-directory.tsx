import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Briefcase01Icon,
  Building03Icon,
  Cancel01Icon,
  NoteEditIcon,
  Search01Icon,
  Tag01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { isShortcutKeyEvent } from "@/lib/keyboard-shortcut";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import {
  secondaryNavigationHeaderClass,
  secondaryNavigationTitleClass,
} from "@/components/ui/secondary-navigation";
import { useWorkspaceTree } from "@/features/library/workspace-tree";
import {
  WORKSPACE_HEADING_ICON_SIZE,
  WORKSPACE_TREE_CHEVRON_SIZE,
  workspaceNavRowClass,
  workspaceNavRowCurrentClass,
  workspaceNavRowIdleClass,
} from "@/features/library/workspace-sidebar-styles";
import { useLibraryTreeState } from "@/features/library/use-library-tree-state";
import { documentQueryOptions } from "@/features/rooms/room-queries";
import { HighlightedText } from "@/features/search/search-highlight";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useWikiDocuments } from "./knowledge-sidebar-trees";
import {
  isWikiCollection,
  useWikiDisplayState,
  wikiCollection,
  wikiCollectionLabels,
  wikiPageKey,
  wikiPagePath,
  type WikiCollection,
} from "./wiki-display-state";
import { wikiDocumentPath, wikiPreviewPath } from "./wiki-routes";
import { wikiPreviewPages } from "./wiki-preview-pages";
import { usePersonalWikiRefresh } from "./wiki-refresh";
import { filterWikiEntries } from "./wiki-title-filter";
import { useRecordRecentWikiPage } from "./use-recent-wiki-pages";

const entries = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "graph", label: "Timeline", icon: NoteEditIcon },
  { id: "projects", label: "Projects", icon: Briefcase01Icon },
  { id: "topics", label: wikiCollectionLabels.topics, icon: Tag01Icon },
  { id: "contacts", label: wikiCollectionLabels.contacts, icon: UserGroupIcon },
  { id: "clients", label: wikiCollectionLabels.clients, icon: Building03Icon },
] as const;
// Rows reuse the Library sidebar's row tokens (30px, 14px/18px, grey idle
// tone, grey pill when current) so both sidebars match. Touch
// screens keep the 44px target.
function rowClass(current: boolean) {
  return `${workspaceNavRowClass} max-sm:min-h-11 ${current ? workspaceNavRowCurrentClass : workspaceNavRowIdleClass}`;
}

/** The row's single line: the file name without its Markdown extension. */
function pageRowTitle(page: { title: string }) {
  return page.title.replace(/\.md$/i, "");
}

export function WikiDirectory({
  tenantId,
  onFileOpen,
}: {
  tenantId: string;
  onFileOpen?: () => void;
}) {
  const { client } = useTeamHubRuntime();
  const location = useLocation();
  const workspaceTree = useWorkspaceTree();
  const navigate = useNavigate();
  const { documentId } = useParams();
  const [searchParams] = useSearchParams();
  // A page the running refresh has not published opens on its preview route.
  const previewPath = location.pathname.endsWith("/wiki-preview")
    ? (searchParams.get("page") ?? "")
    : null;
  const refresh = usePersonalWikiRefresh(tenantId);
  const previews = useMemo(
    () => wikiPreviewPages(refresh.preview),
    [refresh.preview],
  );
  const [animateNavigation, setAnimateNavigation] = useState(false);
  const base = `/t/${encodeURIComponent(tenantId)}/library/wiki`;
  const documents = useWikiDocuments(tenantId);
  const document = useQuery({
    ...documentQueryOptions(client, tenantId, documentId ?? ""),
    enabled: Boolean(documentId),
  });
  // The open page's own query names it, so recording an open needs no request.
  const opened = document.data;
  useRecordRecentWikiPage(
    opened
      ? {
          id: opened.id,
          name: pageRowTitle(opened),
          path: wikiDocumentPath(tenantId, opened.id),
          tenantId,
        }
      : undefined,
  );
  const [locked, setLocked] = useLibraryTreeState<WikiCollection | null>(
    tenantId,
    "wiki-directory",
    () => null,
  );
  const routed = location.pathname.slice(base.length + 1).split("/")[0] ?? "";
  // An open page lists its own collection, so following a link into another
  // collection never leaves the page missing from the list; the choice made
  // on the directory holds only while that page loads.
  const previewCollection = previewPath?.split("/")[0] ?? "";
  const collection = isWikiCollection(routed)
    ? routed
    : previewPath !== null
      ? isWikiCollection(previewCollection)
        ? previewCollection
        : locked
      : documentId
        ? document.data
          ? wikiCollection(document.data)
          : locked
        : null;
  const display = useWikiDisplayState(tenantId);
  const clientQuery = useQueryClient();
  const pages =
    documents.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (page) =>
          wikiCollection(page) === collection &&
          page.from.some((source) => source.binding_kind === "wiki_page") &&
          !/\/index\.md$/i.test(wikiPagePath(page)) &&
          display.decisions[wikiPageKey(wikiPagePath(page))] !== "delete",
      ) ?? [];
  const pageKeys = new Set(
    pages.map((page) => wikiPageKey(wikiPagePath(page))),
  );
  // Pages being written that are not published yet, listed after the
  // published pages of the same collection.
  const newPages = previews.filter(
    (page) =>
      page.collection === collection &&
      !pageKeys.has(page.key) &&
      display.decisions[page.key] !== "delete",
  );
  const previewKey = previewPath === null ? null : wikiPageKey(previewPath);
  // The filter belongs to the collection it was typed in, so switching
  // collections starts from the full list instead of hiding the new one behind
  // a stale query.
  const [filter, setFilter] = useState<{
    collection: WikiCollection | null;
    text: string;
  }>({ collection: null, text: "" });
  const [hiddenNotice, setHiddenNotice] = useState<{
    collection: WikiCollection;
    path: string;
    title: string;
  } | null>(null);
  const filterText = filter.collection === collection ? filter.text : "";
  const clearFilter = () => setFilter({ collection, text: "" });
  // Slash opens the filter field without reaching for the pointer, unless the
  // keystroke belongs to a field, a dialog, or an IME composition.
  const filterRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.key !== "/" || !isShortcutKeyEvent(event)) return;
      const input = filterRef.current;
      if (!input) return;
      // Browsers with quick-find would otherwise search the page instead.
      event.preventDefault();
      input.focus();
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);
  const visiblePages = filterWikiEntries(pages, filterText, pageRowTitle);
  const visibleNewPages = filterWikiEntries(
    newPages,
    filterText,
    (page) => page.name,
  );
  const filtering = filterText.trim() !== "";
  return (
    <>
      <header
        className={`${secondaryNavigationHeaderClass} sticky top-0 z-10 bg-app-surface`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {collection ? (
            <button
              aria-label="Back to Wiki"
              className="flex size-8 max-sm:size-11 shrink-0 items-center justify-center rounded-md text-app-muted hover:bg-app-hover focus-visible:ring-2 focus-visible:ring-app-focus"
              onClick={() => {
                setAnimateNavigation(true);
                setLocked(null);
                workspaceTree.setOpen(workspaceTree.open, base);
                // Pages are listed on the Wiki tab; the bare address opens Profile.
                void navigate(`${base}?tab=wiki`);
              }}
              type="button"
            >
              <Icon icon={ArrowLeft02Icon} size={16} />
            </button>
          ) : null}
          <h2 className={secondaryNavigationTitleClass}>
            {collection ? wikiCollectionLabels[collection] : "Wiki"}
          </h2>
        </div>
      </header>
      <nav
        key={collection ?? "root"}
        aria-label={
          collection
            ? `${wikiCollectionLabels[collection]} files`
            : "Wiki directory"
        }
        className={`space-y-0.5 pt-2 ${animateNavigation ? (collection ? "wiki-directory-forward" : "wiki-directory-back") : ""}`}
      >
        {!collection ? (
          entries.map((entry) => {
            const current =
              location.pathname ===
              (entry.id === "profile" ? base : `${base}/${entry.id}`);
            return (
              <Link
                key={entry.id}
                className={rowClass(current)}
                aria-current={current ? "page" : undefined}
                to={entry.id === "profile" ? base : `${base}/${entry.id}`}
                onClick={() => {
                  if (isWikiCollection(entry.id)) {
                    setAnimateNavigation(true);
                    setLocked(entry.id);
                  } else setLocked(null);
                  onFileOpen?.();
                }}
              >
                <Icon
                  icon={entry.icon}
                  className={current ? "shrink-0" : "shrink-0 text-app-muted"}
                  size={WORKSPACE_HEADING_ICON_SIZE}
                />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.id !== "profile" && entry.id !== "graph" ? (
                  <Icon
                    icon={ArrowRight01Icon}
                    className="shrink-0 text-app-muted"
                    size={WORKSPACE_TREE_CHEVRON_SIZE}
                  />
                ) : null}
              </Link>
            );
          })
        ) : (
          <>
            {pages.length > 0 || newPages.length > 0 ? (
              <label className="select-pill mb-2 w-full cursor-text pr-1.5 focus-within:ring-2 focus-within:ring-app-focus">
                <Icon icon={Search01Icon} size={14} />
                <input
                  aria-label={`Filter ${wikiCollectionLabels[collection]}`}
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-app-placeholder"
                  onChange={(event) =>
                    setFilter({ collection, text: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229)
                      return;
                    if (event.key !== "Escape" || !filterText) return;
                    event.preventDefault();
                    clearFilter();
                    event.currentTarget.blur();
                  }}
                  placeholder={`Filter ${wikiCollectionLabels[collection].toLowerCase()}`}
                  ref={filterRef}
                  role="searchbox"
                  type="text"
                  value={filterText}
                />
                {filterText ? (
                  <button
                    aria-label={`Clear ${wikiCollectionLabels[collection]} filter`}
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                    onClick={clearFilter}
                    type="button"
                  >
                    <Icon icon={Cancel01Icon} size={12} />
                  </button>
                ) : null}
              </label>
            ) : null}
            {hiddenNotice && hiddenNotice.collection === collection ? (
              <div
                className="mb-2 flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface-soft px-2.5 py-1.5 text-xs text-app-muted"
                role="status"
              >
                <span className="min-w-0 truncate">
                  Hidden {hiddenNotice.title}
                </span>
                <span aria-hidden="true" className="shrink-0">
                  ·
                </span>
                <button
                  className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                  onClick={() => {
                    display.decide(hiddenNotice.path, "keep");
                    setHiddenNotice(null);
                  }}
                  type="button"
                >
                  Undo
                </button>
                <button
                  aria-label="Dismiss hidden notice"
                  className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                  onClick={() => setHiddenNotice(null)}
                  type="button"
                >
                  <Icon icon={Cancel01Icon} size={12} />
                </button>
              </div>
            ) : null}
            {documents.isPending ? (
              <p className="px-2 py-2 text-sm text-app-muted">
                Loading Wiki Documents…
              </p>
            ) : documents.error ? (
              <div role="alert" className="px-2 py-2 text-sm text-app-danger">
                {documents.error.message}
                <button onClick={() => void documents.refetch()} type="button">
                  Retry Wiki
                </button>
              </div>
            ) : pages.length === 0 &&
              newPages.length === 0 &&
              !documents.hasNextPage ? (
              <p className="px-2 py-2 text-sm text-app-muted">
                No generated {wikiCollectionLabels[collection].toLowerCase()}{" "}
                yet.
              </p>
            ) : filtering &&
              visiblePages.length === 0 &&
              visibleNewPages.length === 0 ? (
              <p className="px-2 py-2 text-sm text-app-muted">
                {`No ${wikiCollectionLabels[collection].toLowerCase()} match “${filterText.trim()}”.`}
              </p>
            ) : null}
            {visiblePages.map((page) => (
              <div
                className="group wiki-generated-row flex min-w-0 items-center gap-1 [--row-reveal-fade:112px]"
                key={page.id}
              >
                <Link
                  className={`${rowClass(documentId === page.id || previewKey === wikiPageKey(wikiPagePath(page)))} min-w-0 flex-1`}
                  aria-current={
                    documentId === page.id ||
                    previewKey === wikiPageKey(wikiPagePath(page))
                      ? "page"
                      : undefined
                  }
                  to={`/t/${encodeURIComponent(tenantId)}/documents/${encodeURIComponent(page.id)}`}
                  onClick={() => {
                    const key = documentQueryOptions(
                      client,
                      tenantId,
                      page.id,
                    ).queryKey;
                    if (!clientQuery.getQueryData(key))
                      clientQuery.setQueryData(key, page, { updatedAt: 0 });
                    onFileOpen?.();
                  }}
                >
                  <span className="truncate">
                    <HighlightedText
                      query={filterText.trim()}
                      text={pageRowTitle(page)}
                    />
                  </span>
                </Link>
                {display.decisions[wikiPageKey(wikiPagePath(page))] !==
                "keep" ? (
                  <div className="row-reveal-action wiki-display-actions flex shrink-0 gap-1">
                    <button
                      className="min-h-7 max-sm:min-h-11 max-sm:min-w-11 rounded-full bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-primary/9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      disabled={!display.ready}
                      aria-label={`Keep ${page.title}`}
                      type="button"
                      onClick={() => display.decide(wikiPagePath(page), "keep")}
                    >
                      Keep
                    </button>
                    <button
                      className="min-h-7 max-sm:min-h-11 max-sm:min-w-11 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      disabled={!display.ready}
                      aria-label={`Hide ${page.title}`}
                      type="button"
                      onClick={() => {
                        const path = wikiPagePath(page);
                        display.decide(path, "delete");
                        setHiddenNotice({
                          collection,
                          path,
                          title: pageRowTitle(page),
                        });
                        if (documentId === page.id)
                          void navigate(`${base}/${collection}`);
                      }}
                    >
                      Hide
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {visibleNewPages.map((page) => (
              <Link
                aria-current={previewKey === page.key ? "page" : undefined}
                className={`${rowClass(previewKey === page.key)} min-w-0`}
                key={page.key}
                onClick={() => onFileOpen?.()}
                to={wikiPreviewPath(tenantId, page.path)}
              >
                <span className="truncate">
                  <HighlightedText query={filterText.trim()} text={page.name} />
                </span>
              </Link>
            ))}
          </>
        )}
      </nav>
    </>
  );
}
