import type {
  WikiGraphData,
  WikiGraphNode,
} from "@/features/memory/wiki-graph-model";

/**
 * The sentence a page gains when it names exactly one other page and does not
 * link to it. Naming several pages, or linking to the named page, leaves the
 * page alone.
 */
export function wikiNamedSentence(
  pageKey: string,
  graph: WikiGraphData,
): string | undefined {
  const mentions = graph.edges.filter(
    (edge) => edge.kind === "mention" && edge.source === pageKey,
  );
  if (mentions.length !== 1) return undefined;
  const targetId = mentions[0]?.target;
  const named = graph.nodes.find((node) => node.id === targetId);
  if (!named) return undefined;
  return spoken(named);
}

function spoken(node: WikiGraphNode): string | undefined {
  const name = node.title.trim();
  const prose = node.description.trim() || firstProse(node.body);
  if (!name || !prose) return undefined;
  const sentence = prose.toLowerCase().includes(name.toLowerCase())
    ? prose
    : `${name} ${prose.charAt(0).toLowerCase()}${prose.slice(1)}`;
  const finished = /[.!?]$/u.test(sentence) ? sentence : `${sentence}.`;
  return finished.split(/\s+/u).length >= 4 ? finished : undefined;
}

function firstProse(body: string): string {
  const withoutFrontmatter = body.replace(
    /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u,
    "",
  );
  const paragraph = withoutFrontmatter
    .split(/\r?\n\s*\r?\n/u)
    .map((block) => block.trim())
    .find((block) => block && !/^#{1,6}(?:\s|$)/u.test(block));
  if (!paragraph) return "";
  const line = paragraph.replace(/\s+/gu, " ").trim();
  const end = line.search(/[.!?](?:\s|$)/u);
  return end === -1 ? line : line.slice(0, end + 1);
}
