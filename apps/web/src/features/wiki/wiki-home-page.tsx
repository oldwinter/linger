import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Building03Icon,
  Cancel01Icon,
  Search01Icon,
  ShuffleIcon,
} from "@hugeicons/core-free-icons";
import {
  lazy,
  type ReactNode,
  Suspense,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useTabIndicator } from "@/components/ui/tab-indicator";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import { documentFileName } from "@/features/library/document-display-name";
import { commonMessages } from "@/i18n/common.messages";
import { type Translate, formatLocale, translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";
import { useWikiDocuments } from "./knowledge-sidebar-trees";
import { useWikiGraphNodes } from "./wiki-graph-queries";
import { RecentWikiPagesStrip } from "./recent-wiki-pages-strip";
import { WikiOvernightWait } from "./wiki-overnight-wait";
import { WikiDailyCard } from "./wiki-daily-card";
import { OnThisDayRecall, recallForToday } from "./on-this-day-recall";
import { useWikiLiveFocus } from "./wiki-live-focus";
import { WikiLiveWriting } from "./wiki-live-writing";
import {
  wikiEntries,
  type WikiEntry,
  wikiPreviewPages,
  type WikiPreviewPage,
} from "./wiki-preview-pages";
import { matchWikiPage, wikiSearchText } from "./wiki-page-search";
import { WikiProfileEditButton } from "./wiki-profile-edit-button";
import { WikiRefreshButton } from "./wiki-refresh-button";
import { usePersonalWikiRefresh, type WikiRefreshStatus } from "./wiki-refresh";
import { WikiRefreshBanner } from "./wiki-refresh-status";
import { useAnotherMeActorId } from "./wiki-working-card";
import { wikiDocumentPath, wikiPreviewPath } from "./wiki-routes";
import {
  nextWikiSurprise,
  readWikiSurpriseSeen,
  writeWikiSurpriseSeen,
} from "./wiki-surprise";
import {
  useWikiDisplayState,
  wikiCollection,
  wikiPageKey,
  wikiPagePath,
  type WikiCollection,
} from "./wiki-display-state";
import {
  reportDate,
  usePeriodReports,
} from "@/features/memory/wiki-period-reports";
import { wikiMessages as m } from "./wiki.messages";
import "./wiki-home-page.css";

const entityHues = [
  "var(--app-wiki-hue-0)",
  "var(--app-wiki-hue-1)",
  "var(--app-wiki-hue-2)",
  "var(--app-wiki-hue-3)",
  "var(--app-wiki-hue-4)",
  "var(--app-wiki-hue-5)",
] as const;

export function pageName(page: TeamHubDocument) {
  return documentFileName(page).replace(/\.md$/i, "");
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0]![0]}${words[words.length - 1]![0]}`
      : (words[0] ?? "?").slice(0, 2)
  ).toUpperCase();
}

/** People and companies take the palette in order; a member keeps one hue. */
function entityColors(key: number | string) {
  let index = typeof key === "number" ? key : 0;
  if (typeof key === "string")
    for (const char of key) index = (index * 31 + char.codePointAt(0)!) | 0;
  const color = entityHues[Math.abs(index) % entityHues.length]!;
  return {
    background: `color-mix(in srgb, ${color} 10%, transparent)`,
    color,
  };
}

export function editedLabel(page: TeamHubDocument, t: Translate = translate) {
  const date = new Date(page.updated_at);
  return Number.isNaN(date.valueOf())
    ? ""
    : t(m.edited, {
        date: new Intl.DateTimeFormat(formatLocale(), {
          month: "short",
          day: "numeric",
        }).format(date),
      });
}

export function useWikiCollectionPages(tenantId: string) {
  const documents = useWikiDocuments(tenantId);
  const display = useWikiDisplayState(tenantId);
  const pages = (
    documents.data?.pages.flatMap((page) => page.items) ?? []
  ).filter(
    (page) =>
      page.from.some((source) => source.binding_kind === "wiki_page") &&
      !/\/index\.md$/i.test(wikiPagePath(page)) &&
      display.decisions[wikiPageKey(wikiPagePath(page))] !== "delete",
  );
  const of = (collection: WikiCollection) =>
    pages.filter((page) => wikiCollection(page) === collection);
  return {
    pending: documents.isPending,
    error: Boolean(documents.error),
    of,
    pages,
    /** The collection's cards with the running refresh's pages in place. */
    entries: (collection: WikiCollection, previews: WikiPreviewPage[]) =>
      wikiEntries(
        of(collection),
        previews.filter((page) => display.decisions[page.key] !== "delete"),
        collection,
      ),
  };
}

const homeTabs = [
  { id: "profile", label: m.profileTab },
  { id: "wiki", label: m.title },
] as const;
type WikiHomeTab = (typeof homeTabs)[number]["id"];

const ProfilePage = lazy(async () => {
  const { WikiProfilePage } = await import("./wiki-profile-page");
  return { default: WikiProfilePage };
});

/**
 * Wiki opens on the reader's Profile; the Wiki tab holds the generated pages.
 */
export function WikiHomePage() {
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: WikiHomeTab =
    searchParams.get("tab") === "wiki" ? "wiki" : "profile";
  const refresh = usePersonalWikiRefresh(tenantId);
  const { tabRef, indicator } = useTabIndicator(tab);
  const t = useT();
  return (
    <main className="workspace-content-viewport workspace-scrollbar wiki-landing min-w-0 flex-1 overflow-y-auto bg-app-surface [scrollbar-gutter:stable]">
      {/* Same column, heading and tabs as the Library page. */}
      <div className="workspace-file-browser">
        <h1 className="sr-only">{t(m.title)}</h1>
        <WikiOvernightWait
          refreshing={refresh.refreshing}
          tenantId={tenantId}
        />
        {/* Profile and Wiki tabs head the page in the Library column. */}
        <header className="wiki-home-header flex flex-wrap items-center gap-3">
          <div
            aria-label={t(m.views)}
            className="workspace-file-tabs relative flex max-w-full gap-1 overflow-x-auto"
            role="tablist"
          >
            {homeTabs.map((candidate) => (
              <button
                aria-selected={candidate.id === tab}
                className="workspace-view-tab inline-flex h-8 shrink-0 items-center rounded-md px-3 text-lg font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                key={candidate.id}
                onClick={() =>
                  setSearchParams(
                    candidate.id === "wiki" ? { tab: "wiki" } : {},
                  )
                }
                ref={tabRef(candidate.id)}
                role="tab"
                type="button"
              >
                {t(candidate.label)}
              </button>
            ))}
            {indicator}
          </div>
          {tab === "wiki" ? (
            <>
              <WikiRefreshButton
                refreshing={refresh.refreshing}
                tenantId={tenantId}
              />
              <WikiSurpriseButton tenantId={tenantId} />
            </>
          ) : (
            <WikiProfileEditButton tenantId={tenantId} />
          )}
        </header>
        {tab === "wiki" ? (
          <WikiOverview refresh={refresh} tenantId={tenantId} />
        ) : (
          <div className="landing-profile-tab">
            <Suspense
              fallback={
                <p role="status" className="text-sm text-app-muted">
                  {t(m.loadingProfile)}
                </p>
              }
            >
              <ProfilePage />
            </Suspense>
          </div>
        )}
      </div>
    </main>
  );
}

/** Opens one of the person's Wiki pages at random, or nothing without pages. */
function WikiSurpriseButton({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const collection = useWikiCollectionPages(tenantId);
  const pages = collection.pages;
  if (pages.length === 0) return null;
  return (
    <Button
      onClick={() => {
        const pick = nextWikiSurprise(
          pages,
          readWikiSurpriseSeen(tenantId),
          Math.random,
        );
        if (!pick) return;
        writeWikiSurpriseSeen(tenantId, pick.seenIds);
        void navigate(wikiDocumentPath(tenantId, pick.page.id));
      }}
      size="compact"
      title="Open one of your Wiki pages at random"
      tone="ghost"
    >
      <Icon icon={ShuffleIcon} className="shrink-0" size={14} />
      Surprise me
    </Button>
  );
}

/** The generated Wiki: Daily reports and the page collections. While a
 * refresh runs, the pages it has written appear in their collections. */
function WikiOverview({
  refresh,
  tenantId,
}: {
  refresh: WikiRefreshStatus;
  tenantId: string;
}) {
  const { preview, refreshing } = refresh;
  const navigate = useNavigate();
  const collections = useWikiCollectionPages(tenantId);
  const nodes = useWikiGraphNodes(tenantId);
  const reports = usePeriodReports(tenantId, "daily");
  const previews = useMemo(() => wikiPreviewPages(preview), [preview]);
  const featured = useWikiLiveFocus(previews);
  const anotherMe = useAnotherMeActorId(tenantId);
  const [query, setQuery] = useState("");
  const searchBodies = useRef(
    new Map<string, { source: string; text: string }>(),
  );
  const t = useT();
  const base = `/t/${encodeURIComponent(tenantId)}/library/wiki`;
  const documentPath = (page: TeamHubDocument) =>
    `/t/${encodeURIComponent(tenantId)}/documents/${encodeURIComponent(page.id)}`;
  const daily = [...(reports.data ?? [])]
    .filter(reportDate)
    .sort((a, b) => (reportDate(b) ?? "").localeCompare(reportDate(a) ?? ""));
  const { recall, recent } = recallForToday(daily);
  const projects = collections.entries("projects", previews);
  const topics = collections.entries("topics", previews);
  const people = collections.entries("contacts", previews);
  const companies = collections.entries("clients", previews);
  const peopleById = new Map(
    people.map((entry) => [entry.key, entryName(entry)]),
  );
  const description = (entry: WikiEntry) =>
    entry.preview
      ? entry.preview.description
      : nodes.get(entry.key)?.description;
  const subtitle = (entry: WikiEntry) =>
    description(entry) ||
    (entry.published ? editedLabel(entry.published, t) : "");
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
  const searchGroups = needle
    ? (
        [
          { label: t(m.projects), entries: projects },
          { label: t(m.topics), entries: topics },
          { label: t(m.people), entries: people },
          { label: t(m.companies), entries: companies },
        ] as const
      )
        .map((group) => ({
          label: group.label,
          matches: group.entries.flatMap((entry) => {
            const match = matchWikiPage(
              {
                body: bodyText(entry),
                description: description(entry) ?? "",
                title: entryName(entry),
              },
              needle,
            );
            return match ? [{ entry, snippet: match.snippet }] : [];
          }),
        }))
        .filter((group) => group.matches.length > 0)
    : [];
  const totalMatches = searchGroups.reduce(
    (sum, group) => sum + group.matches.length,
    0,
  );
  const card = { documentPath, tenantId };
  const status = (empty: Message<string>) =>
    collections.pending ? (
      <p className="landing-empty">{t(commonMessages.loading)}</p>
    ) : collections.error ? (
      <p role="alert" className="landing-empty">
        {t(m.pagesUnavailable)}
      </p>
    ) : refreshing ? null : (
      <p className="landing-empty">{t(empty)}</p>
    );

  return (
    <>
      <div className="landing-notices">
        <WikiRefreshBanner {...refresh} agentActorId={anotherMe} />
        {refreshing && previews.length > 0 ? (
          <p className="mb-6">
            <Link
              className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={`${base}/writing`}
            >
              {`Read ${previews.length} ${previews.length === 1 ? "page" : "pages"} written so far`}
            </Link>
          </p>
        ) : null}
        {refreshing && featured ? (
          <WikiLiveWriting
            count={previews.length}
            page={featured}
            tenantId={tenantId}
          />
        ) : null}
      </div>
      <RecentWikiPagesStrip tenantId={tenantId} />
      <label className="mb-5 flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground transition-colors hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40">
        <Icon icon={Search01Icon} size={14} />
        <input
          aria-label="Search Wiki pages"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-app-placeholder"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key !== "Escape" || !query) return;
            event.preventDefault();
            setQuery("");
          }}
          placeholder="Search pages across all collections..."
          role="searchbox"
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label="Clear search"
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setQuery("")}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        ) : null}
      </label>
      {needle ? (
        <section
          aria-label="Search results"
          className="flex flex-col gap-6 pt-1"
        >
          {totalMatches === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {`No pages match “${needle}”.`}
              </p>
              <Button
                onClick={() => setQuery("")}
                size="compact"
                tone="secondary"
              >
                Clear search
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground" role="status">
                {`${totalMatches} ${totalMatches === 1 ? "match" : "matches"} across ${searchGroups.length} ${searchGroups.length === 1 ? "collection" : "collections"}`}
              </p>
              {searchGroups.map((group) => (
                <section aria-label={group.label} key={group.label}>
                  <h2 className="landing-section-title mb-3">
                    {group.label}
                    <span className="section-count">
                      {group.matches.length}
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {group.matches.map(({ entry, snippet }) => (
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
                          {snippet ?? subtitle(entry)}
                        </span>
                      </WikiEntryLink>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </section>
      ) : (
        <div className="landing-grid">
          <div className="landing-col landing-col-left">
            <section className="landing-section landing-daily">
              <SectionHeader
                title={t(m.dailyReport)}
                count={daily.length}
                to={`${base}/graph`}
              />
              {reports.isPending ? (
                <p className="landing-empty">{t(m.loadingReports)}</p>
              ) : reports.error ? (
                <p role="alert" className="landing-empty">
                  {t(m.reportsUnavailable)}
                </p>
              ) : daily.length ? (
                <>
                  {recall ? (
                    <OnThisDayRecall
                      onOpen={() =>
                        void navigate(
                          `${base}/graph?day=${encodeURIComponent(recall.day)}`,
                        )
                      }
                      recall={recall}
                      tenantId={tenantId}
                    />
                  ) : null}
                  {recent.length ? (
                    <div className="daily-list">
                      {recent.map((entry) => {
                        const day = reportDate(entry)!;
                        const open = () =>
                          void navigate(
                            `${base}/graph?day=${encodeURIComponent(day)}`,
                          );
                        return (
                          <WikiDailyCard
                            key={entry.id}
                            tenantId={tenantId}
                            day={day}
                            entry={entry}
                            onOpen={open}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="landing-empty">{t(m.noDailyReports)}</p>
              )}
            </section>
            <EntryCards
              {...card}
              className="landing-projects"
              title={t(m.projects)}
              to={`${base}/projects`}
              entries={projects}
              empty={status(m.noProjects)}
              description={description}
              members={(entry) =>
                [
                  ...new Set([
                    ...(nodes.get(entry.key)?.links ?? []),
                    ...(nodes.get(entry.key)?.backlinks ?? []),
                  ]),
                ]
                  .map((id) => peopleById.get(id))
                  .filter((name): name is string => Boolean(name))
                  .slice(0, 3)
              }
            />
            <EntryCards
              {...card}
              className="landing-topics"
              title={t(m.topics)}
              to={`${base}/topics`}
              entries={topics}
              empty={status(m.noTopics)}
              description={description}
              members={() => []}
            />
          </div>
          <div className="landing-col landing-col-right">
            <section className="landing-section landing-people">
              <SectionHeader
                title={t(m.people)}
                count={people.length}
                to={`${base}/contacts`}
              />
              {people.length ? (
                <div className="people-grid">
                  {people.slice(0, 4).map((entry, index) => (
                    <WikiEntryLink
                      {...card}
                      className="person-card"
                      entry={entry}
                      key={entry.key}
                    >
                      <span
                        className="person-avatar"
                        style={entityColors(index)}
                      >
                        {initials(entryName(entry))}
                      </span>
                      <span className="person-name">{entryName(entry)}</span>
                      <span className="person-role">{subtitle(entry)}</span>
                    </WikiEntryLink>
                  ))}
                </div>
              ) : (
                status(m.noPeople)
              )}
            </section>
            <section className="landing-section landing-companies">
              <SectionHeader
                title={t(m.companies)}
                count={companies.length}
                to={`${base}/clients`}
              />
              {companies.length ? (
                <div className="companies-grid">
                  {companies.slice(0, 6).map((entry, index) => (
                    <WikiEntryLink
                      {...card}
                      className="company-card"
                      entry={entry}
                      key={entry.key}
                    >
                      <span
                        className="company-icon"
                        style={entityColors(index)}
                      >
                        <Icon icon={Building03Icon} size={16} />
                      </span>
                      <span className="company-info">
                        <span className="company-name">{entryName(entry)}</span>
                        <span className="company-desc">{subtitle(entry)}</span>
                      </span>
                    </WikiEntryLink>
                  ))}
                </div>
              ) : (
                status(m.noCompanies)
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}

export function entryName(entry: WikiEntry) {
  return entry.preview ? entry.preview.name : pageName(entry.published);
}

/** A card opens its page: the published Document, or the page the running
 * refresh is writing, in the same page layout. */
export function WikiEntryLink({
  children,
  className,
  documentPath,
  entry,
  tenantId,
}: {
  children: ReactNode;
  className: string;
  documentPath: (page: TeamHubDocument) => string;
  entry: WikiEntry;
  tenantId: string;
}) {
  return (
    <Link
      className={className}
      to={
        entry.published
          ? documentPath(entry.published)
          : wikiPreviewPath(tenantId, entry.preview.path)
      }
    >
      {children}
    </Link>
  );
}

/** Projects and Topics: three cards with a description, edit date and members. */
function EntryCards({
  className,
  title,
  to,
  entries,
  empty,
  documentPath,
  tenantId,
  description,
  members,
}: {
  className: string;
  title: string;
  to: string;
  entries: WikiEntry[];
  empty: ReactNode;
  documentPath: (page: TeamHubDocument) => string;
  tenantId: string;
  description: (entry: WikiEntry) => string | undefined;
  members: (entry: WikiEntry) => string[];
}) {
  const t = useT();
  return (
    <section className={`landing-section ${className}`}>
      <SectionHeader title={title} count={entries.length} to={to} />
      {entries.length ? (
        <div className="projects-grid">
          {entries.slice(0, 3).map((entry) => (
            <WikiEntryLink
              className="project-card"
              documentPath={documentPath}
              entry={entry}
              key={entry.key}
              tenantId={tenantId}
            >
              <span className="project-card-title">{entryName(entry)}</span>
              <span className="project-card-desc">{description(entry)}</span>
              <span className="project-card-meta">
                <span className="project-card-time">
                  {entry.published ? editedLabel(entry.published, t) : ""}
                </span>
                <span className="project-involvers">
                  {members(entry).map((name) => (
                    <span
                      className="project-involver"
                      key={name}
                      style={{
                        background: `color-mix(in srgb, ${entityColors(name).color} 22%, var(--app-surface))`,
                      }}
                      title={name}
                    >
                      {initials(name)}
                    </span>
                  ))}
                </span>
              </span>
            </WikiEntryLink>
          ))}
        </div>
      ) : (
        empty
      )}
    </section>
  );
}

function SectionHeader({
  title,
  count,
  to,
}: {
  title: string;
  count: number;
  to: string;
}) {
  const t = useT();
  return (
    <header className="landing-section-header">
      <h2 className="landing-section-title">
        {title}
        <span className="section-count">{count}</span>
      </h2>
      <Link className="landing-view-all" to={to}>
        {t(m.viewAll)}
        <Icon icon={ArrowRight02Icon} size={14} />
      </Link>
    </header>
  );
}

export function WikiBack() {
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const t = useT();
  return (
    <Link
      aria-label={t(m.backToWiki)}
      className="wiki-back"
      to={`/t/${encodeURIComponent(tenantId)}/library/wiki?tab=wiki`}
    >
      <Icon icon={ArrowLeft02Icon} size={16} />
      {t(commonMessages.back)}
    </Link>
  );
}
