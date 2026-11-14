import { pageTitle, type WikiGraphNode } from "./wiki-graph-model";
import type { GraphNeighborhood } from "./graph-neighborhood";

/** The page a search landed on, and the pages the graph ties to it. */
export function GraphNeighborhoodView({
  neighborhood,
  onOpen,
}: {
  neighborhood: GraphNeighborhood;
  onOpen: (node: WikiGraphNode) => void;
}) {
  const { also, center, links, mentionedBy } = neighborhood;
  return (
    <section
      aria-label="Connected pages"
      className="mx-4 mb-4 flex flex-col gap-3 rounded-2xl border border-app-border bg-app-canvas px-4 py-4"
    >
      <p className="text-sm text-app-muted">{center.category}</p>
      <h2 className="text-xl text-foreground">{pageTitle(center)}</h2>
      {center.description ? (
        <p className="text-sm text-app-muted">{center.description}</p>
      ) : null}
      <NeighborGroup label="Links to" nodes={links} onOpen={onOpen} />
      <NeighborGroup label="Mentioned by" nodes={mentionedBy} onOpen={onOpen} />
      {links.length === 0 && mentionedBy.length === 0 ? (
        <p className="text-sm text-app-muted">
          Nothing else in the Wiki links here.
        </p>
      ) : null}
      {also.length > 0 ? (
        <NeighborGroup label="Also matches" nodes={also} onOpen={onOpen} />
      ) : null}
    </section>
  );
}

function NeighborGroup({
  label,
  nodes,
  onOpen,
}: {
  label: string;
  nodes: readonly WikiGraphNode[];
  onOpen: (node: WikiGraphNode) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-app-muted">{label}</h3>
      <ul className="flex flex-wrap gap-2">
        {nodes.map((node) => (
          <li key={node.id}>
            <button
              className="rounded-full border border-app-border bg-app-surface px-3 py-1 text-sm text-foreground hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
              onClick={() => onOpen(node)}
              type="button"
            >
              {pageTitle(node)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
