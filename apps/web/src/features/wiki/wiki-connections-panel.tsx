import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { Icon } from "@/components/ui/icon";
import { useRecentDocumentsAccountId } from "@/features/library/use-recent-documents";
import type { WikiGraphNode } from "@/features/memory/wiki-graph-model";
import { cn } from "@/lib/cn";

import {
  readRecentWikiPages,
  subscribeRecentWikiPages,
  type RecentWikiPage,
} from "./recent-wiki-pages";
import { useWikiGraphNodes } from "./wiki-graph-queries";
import { mutualPage } from "./wiki-mutual-page";
import { useWikiPageHrefs } from "./wiki-page-links";
import { WikiReachNote } from "./wiki-reach-note";
import { pageKeyForHref, wikiReach } from "./wiki-reach";

/** Connections shown per direction before "Show all" reveals the rest. */
const VISIBLE_CONNECTIONS = 6;

interface WikiConnection {
  href: string;
  key: string;
  title: string;
}

/**
 * The page's graph edges in both directions. A page key without a graph node,
 * or with no resolvable edges, has no panel.
 */
export function WikiConnectionsPanel({
  className,
  pageKey,
  tenantId,
}: {
  className?: string;
  pageKey: string;
  tenantId: string;
}) {
  const nodes = useWikiGraphNodes(tenantId);
  const hrefs = useWikiPageHrefs(tenantId);
  const accountId = useRecentDocumentsAccountId();
  const [recent, setRecent] = useState<RecentWikiPage[]>([]);
  useEffect(() => {
    const refresh = () => setRecent(readRecentWikiPages(accountId, tenantId));
    refresh();
    return subscribeRecentWikiPages(refresh);
  }, [accountId, tenantId]);
  const node = nodes.get(pageKey);
  if (!node) return null;
  const linksTo = wikiConnections(node.links, nodes, hrefs);
  const linkedFrom = wikiConnections(node.backlinks, nodes, hrefs);
  const partner = mutualPage(pageKey, nodes);
  const earlierKey = recent
    .map((entry) => pageKeyForHref(hrefs, entry.path))
    .find((key) => key && key !== pageKey);
  const path =
    earlierKey && earlierKey !== pageKey
      ? wikiReach(nodes, earlierKey, pageKey)
      : undefined;
  if (!linksTo.length && !linkedFrom.length && !partner && !path) return null;
  const connections = linksTo.length > 0 || linkedFrom.length > 0;
  return (
    <div className={cn("mt-6", className)}>
      {path ? <WikiReachNote hrefs={hrefs} path={path} /> : null}
      {connections || partner ? (
        <details
          className={cn(
            "group border-t border-app-border pt-4",
            path && "mt-6",
          )}
          open
        >
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-semibold text-app-ink hover:text-app-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-focus [&::-webkit-details-marker]:hidden">
            <Icon
              className="transition-transform group-open:rotate-90"
              icon={ArrowRight01Icon}
              size={14}
            />
            Connections
          </summary>
          {connections ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <ConnectionList entries={linksTo} title="Links to" />
              <ConnectionList entries={linkedFrom} title="Linked from" />
            </div>
          ) : null}
          {partner ? (
            <PointedBackPage href={hrefs.get(partner.id)} page={partner} />
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function PointedBackPage({
  href,
  page,
}: {
  href?: string;
  page: WikiGraphNode;
}) {
  const title = page.title.trim() || page.id;
  return (
    <section aria-label="The page that points back" className="mt-4">
      <h3 className="text-sm font-medium text-app-ink">
        {href ? (
          <Link
            className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-focus"
            to={href}
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </h3>
      <p className="mt-1 text-sm whitespace-pre-wrap text-app-body">
        {page.body.trim()}
      </p>
    </section>
  );
}

function ConnectionList({
  entries,
  title,
}: {
  entries: WikiConnection[];
  title: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!entries.length) return null;
  const shown = expanded ? entries : entries.slice(0, VISIBLE_CONNECTIONS);
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium tracking-wide text-app-muted uppercase">
        {title}
      </h3>
      <ul className="mt-1.5 space-y-1">
        {shown.map((entry) => (
          <li key={entry.key}>
            <Link
              className="block truncate rounded-sm text-sm text-app-body hover:text-app-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-focus"
              to={entry.href}
            >
              {entry.title}
            </Link>
          </li>
        ))}
      </ul>
      {entries.length > VISIBLE_CONNECTIONS ? (
        <button
          aria-expanded={expanded}
          className="mt-1.5 text-xs text-app-muted hover:text-app-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-focus"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Show fewer" : `Show all ${entries.length}`}
        </button>
      ) : null}
    </section>
  );
}

/**
 * Resolves graph node ids to their page routes, dropping an id the loaded Wiki
 * pages cannot open and repeating nothing.
 */
export function wikiConnections(
  ids: readonly string[],
  nodes: ReadonlyMap<string, WikiGraphNode>,
  hrefs: ReadonlyMap<string, string>,
): WikiConnection[] {
  const seen = new Set<string>();
  const connections: WikiConnection[] = [];
  for (const id of ids) {
    const href = hrefs.get(id);
    if (!href || seen.has(id)) continue;
    seen.add(id);
    connections.push({
      href,
      key: id,
      title: nodes.get(id)?.title.trim() || wikiPageName(id),
    });
  }
  return connections;
}

/** The last key segment, named as a page when the target node is absent. */
function wikiPageName(key: string): string {
  const segments = key.split("/").filter(Boolean);
  const file = segments.at(-1) ?? key;
  if (/^index\.md$/iu.test(file)) return segments.at(-2) ?? file;
  return file.replace(/\.md$/iu, "");
}
