import { useQuery } from "@tanstack/react-query";
import { useLibraryTreeState } from "@/features/library/use-library-tree-state";
import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";
import type { WikiGraphData } from "@/features/memory/wiki-graph-model";
import { removePreferenceKeys } from "@/lib/local-preference-keys";

const WIKI_DISPLAY_PREFIX = "linger:wiki-display:v1:";

import { wikiMessages as m } from "./wiki.messages";

/** The wording of each collection, by its route and data key. */
export const wikiCollections = {
  projects: {
    count: m.projectCount,
    files: m.projectFiles,
    label: m.projects,
    noMatch: m.noProjectsMatch,
    noneGenerated: m.noGeneratedProjects,
    search: m.searchProjects,
  },
  topics: {
    count: m.topicCount,
    files: m.topicFiles,
    label: m.topics,
    noMatch: m.noTopicsMatch,
    noneGenerated: m.noGeneratedTopics,
    search: m.searchTopics,
  },
  contacts: {
    count: m.peopleCount,
    files: m.peopleFiles,
    label: m.people,
    noMatch: m.noPeopleMatch,
    noneGenerated: m.noGeneratedPeople,
    search: m.searchPeople,
  },
  clients: {
    count: m.companyCount,
    files: m.companyFiles,
    label: m.companies,
    noMatch: m.noCompaniesMatch,
    noneGenerated: m.noGeneratedCompanies,
    search: m.searchCompanies,
  },
} as const;
export type WikiCollection = keyof typeof wikiCollections;
export function isWikiCollection(value: string): value is WikiCollection {
  return Object.hasOwn(wikiCollections, value);
}
export function wikiPagePath(document: TeamHubDocument) {
  return (
    document.from.find((source) => source.binding_kind === "wiki_page")
      ?.page_key ?? document.title
  );
}
export function wikiPageKey(path: string) {
  return path
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "")
    .replace(/\/index$/i, "");
}
export function wikiCollection(
  document: TeamHubDocument,
): WikiCollection | null {
  const first = wikiPagePath(document).replace(/^\/+/, "").split("/")[0];
  return first && isWikiCollection(first) ? first : null;
}
export type WikiDisplayDecisions = Record<string, "keep" | "delete">;

export function clearAllWikiDisplayState(): void {
  removePreferenceKeys([WIKI_DISPLAY_PREFIX]);
}

export function useWikiDisplayState(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const accountId = identity.data?.account.id;
  const key = `${WIKI_DISPLAY_PREFIX}${tenantId}:${accountId ?? "pending"}`;
  const [decisions, setDecisions] = useLibraryTreeState<WikiDisplayDecisions>(
    tenantId,
    key,
    () => {
      try {
        const value: unknown = JSON.parse(
          window.localStorage.getItem(key) ?? "{}",
        );
        if (!value || typeof value !== "object" || Array.isArray(value))
          return {};
        return Object.fromEntries(
          Object.entries(value).filter(
            ([, choice]) => choice === "keep" || choice === "delete",
          ),
        );
      } catch {
        return {};
      }
    },
  );
  return {
    decisions,
    ready: Boolean(accountId),
    decide(path: string, choice: "keep" | "delete") {
      if (!accountId) return;
      const next = { ...decisions, [wikiPageKey(path)]: choice };
      setDecisions(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Keep session state when browser storage is unavailable. */
      }
    },
  };
}
export function filterWikiGraph(
  graph: WikiGraphData,
  decisions: WikiDisplayDecisions,
): WikiGraphData {
  const visible = (id: string) => decisions[wikiPageKey(id)] !== "delete";
  const nodes = graph.nodes
    .filter((node) => visible(node.id))
    .map((node) => ({
      ...node,
      links: node.links.filter(visible),
      backlinks: node.backlinks.filter(visible),
    }));
  const ids = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target),
    ),
  };
}
