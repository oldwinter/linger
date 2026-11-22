import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import { Navigate, useParams } from "react-router";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useT } from "@/i18n/use-translation";
import {
  isWikiCollection,
  wikiCollections,
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
import { WikiCollectionCopyList } from "./wiki-collection-copy-list";
import { wikiDocumentPath, wikiPreviewPath } from "./wiki-routes";
import { WikiWritingWalk } from "./wiki-writing-walk-page";
import { wikiMessages as m } from "./wiki.messages";

const GraphPage = lazy(async () => {
  const { WikiGraphPage } = await import("@/features/memory/wiki-graph-page");
  return { default: WikiGraphPage };
});

export function WikiCollectionPage() {
  const { collection, tenantId = "" } = useParams();
  const t = useT();
  if (!collection) return <WikiHomePage />;
  // Profile is the Wiki home's default tab.
  if (collection === "profile")
    return (
      <Navigate
        replace
        to={`/t/${encodeURIComponent(tenantId)}/library/wiki`}
      />
    );
  if (collection === "writing") return <WikiWritingWalk />;
  if (collection === "graph")
    return (
      <Suspense
        fallback={
          <p role="status" className="p-4 text-sm text-app-muted">
            {t(m.loadingTimeline)}
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
          {t(m.collectionUnavailable)}
        </p>
      )}
    </main>
  );
}

const wikiCollectionNouns: Record<
  WikiCollection,
  { plural: string; singular: string }
> = {
  clients: { plural: "companies", singular: "company" },
  contacts: { plural: "people", singular: "person" },
  projects: { plural: "projects", singular: "project" },
  topics: { plural: "topics", singular: "topic" },
};

function formatCollectionCount(
  collection: WikiCollection,
  shown: number,
  total: number,
  filtering: boolean,
) {
  const noun = wikiCollectionNouns[collection];
  const unit = total === 1 ? noun.singular : noun.plural;
  return filtering ? `${shown} of ${total} ${unit}` : `${total} ${unit}`;
}

function WikiCollectionContent({ collection }: { collection: WikiCollection }) {
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const collections = useWikiCollectionPages(tenantId);
  const nodes = useWikiGraphNodes(tenantId);
  const { preview } = usePersonalWikiRefresh(tenantId);
  const previews = useMemo(() => wikiPreviewPages(preview), [preview]);
  const [query, setQuery] = useState("");
  const t = useT();
  const all = collections.entries(collection, previews);
  const words = wikiCollections[collection];
  const label = t(words.label);
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
        {needle
          ? formatCollectionCount(collection, pages.length, all.length, true)
          : t(words.count, { count: all.length })}
      </p>
      {/* Same search field as the Connectors catalog. */}
      <label className="mb-6 flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground transition-colors duration-150 hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40">
        <Icon icon={Search01Icon} size={14} />
        <input
          aria-label={t(words.search)}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-app-placeholder"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key !== "Escape" || !query) return;
            event.preventDefault();
            setQuery("");
          }}
          placeholder={t(words.search)}
          role="searchbox"
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label={`Clear ${label} search`}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
            onClick={() => setQuery("")}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        ) : null}
      </label>
      {collections.pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t(m.loadingDocuments)}
        </p>
      ) : collections.error ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t(m.documentsUnavailable)}
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
                    (entry.published ? editedLabel(entry.published, t) : ""))}
              </span>
            </WikiEntryLink>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {needle
            ? t(words.noMatch, { query: query.trim() })
            : t(words.noneGenerated)}
        </p>
      )}
    </div>
  );
}
