import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import { Navigate, useParams } from "react-router";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import {
  isWikiCollection,
  wikiCollectionLabels,
  type WikiCollection,
} from "./wiki-display-state";
import { useWikiGraphNodes } from "./wiki-graph-queries";
import {
  editedLabel,
  entryName,
  useWikiCollectionPages,
  WikiBack,
  WikiEntryLink,
  WikiHomePage,
} from "./wiki-home-page";
import { type WikiEntry, wikiPreviewPages } from "./wiki-preview-pages";
import { matchWikiPage, wikiSearchText } from "./wiki-page-search";
import { usePersonalWikiRefresh } from "./wiki-refresh";
import { wikiDocumentPath, wikiPreviewPath } from "./wiki-routes";
import { WikiCollectionCopyList } from "./wiki-collection-copy-list";

const GraphPage = lazy(async () => {
  const { WikiGraphPage } = await import("@/features/memory/wiki-graph-page");
  return { default: WikiGraphPage };
});

export function WikiCollectionPage() {
  const { collection, tenantId = "" } = useParams();
  if (!collection) return <WikiHomePage />;
  // Profile is the Wiki home's default tab.
  if (collection === "profile")
    return (
      <Navigate
        replace
        to={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
      />
    );
  if (collection === "graph")
    return (
      <Suspense
        fallback={
          <p role="status" className="p-4 text-sm text-app-muted">
            Loading timeline…
          </p>
        }
      >
        <GraphPage />
      </Suspense>
    );
  return (
    <main className="workspace-scrollbar wiki-landing flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app-surface">
      {isWikiCollection(collection) ? (
        <WikiCollectionContent collection={collection} />
      ) : (
        <p role="alert" className="p-4">
          Wiki collection unavailable.
        </p>
      )}
    </main>
  );
}

function WikiCollectionContent({ collection }: { collection: WikiCollection }) {
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const collections = useWikiCollectionPages(tenantId);
  const nodes = useWikiGraphNodes(tenantId);
  const { preview } = usePersonalWikiRefresh(tenantId);
  const previews = useMemo(() => wikiPreviewPages(preview), [preview]);
  const [query, setQuery] = useState("");
  const all = collections.entries(collection, previews);
  const label = wikiCollectionLabels[collection];
  const description = (entry: WikiEntry) =>
    (entry.preview
      ? entry.preview.description
      : nodes.get(entry.key)?.description) ?? "";
  // Stripped body text is cached by page key so typing never re-strips it.
  const searchBodies = useRef(
    new Map<string, { source: string; text: string }>(),
  );
  const bodyText = (entry: WikiEntry) => {
    const source = entry.preview
      ? entry.preview.markdown
      : (nodes.get(entry.key)?.body ?? "");
    const cached = searchBodies.current.get(entry.key);
    if (cached?.source === source) return cached.text;
    const text = wikiSearchText(source);
    searchBodies.current.set(entry.key, { source, text });
    return text;
  };
  const needle = query.trim();
  const pages = all.flatMap((entry) => {
    if (!needle) return [{ entry, snippet: undefined as string | undefined }];
    const match = matchWikiPage(
      {
        body: bodyText(entry),
        description: description(entry),
        title: entryName(entry),
      },
      needle,
    );
    return match ? [{ entry, snippet: match.snippet }] : [];
  });
  const documentPath = (page: TeamHubDocument) =>
    wikiDocumentPath(tenantId, page.id);
  const copyPages = pages.map(({ entry }) => ({
    path: entry.published
      ? documentPath(entry.published)
      : wikiPreviewPath(tenantId, entry.preview.path),
    title: entryName(entry),
  }));
  return (
    <div className="workspace-content mx-auto w-full px-4 py-6 md:px-8">
      <WikiBack />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl text-foreground">{label}</h1>
        <WikiCollectionCopyList label={label} pages={copyPages} />
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {all.length} {label.toLowerCase()}
      </p>
      {/* Same search field as the Connectors catalog. */}
      <label className="relative mb-6 block">
        <Icon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          size={14}
        />
        <input
          aria-label={`Search ${label}`}
          className="h-9 w-full rounded-lg border border-border bg-card pr-3 pl-9 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground hover:border-border-hover focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          type="search"
          value={query}
        />
      </label>
      {collections.pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading Wiki Documents…
        </p>
      ) : collections.error ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Wiki Documents are unavailable.
        </p>
      ) : pages.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {pages.map(({ entry, snippet }) => (
            <WikiEntryLink
              className="wiki-entity-card"
              documentPath={documentPath}
              entry={entry}
              key={entry.key}
              tenantId={tenantId}
            >
              <span className="block text-sm font-medium text-foreground">
                {entryName(entry)}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {snippet ??
                  (description(entry) ||
                    (entry.published ? editedLabel(entry.published) : ""))}
              </span>
            </WikiEntryLink>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {needle
            ? `No ${label.toLowerCase()} match “${query.trim()}”.`
            : `No generated ${label.toLowerCase()} yet.`}
        </p>
      )}
    </div>
  );
}
