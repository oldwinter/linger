import type {
  WikiGraphData,
  WikiGraphNode,
} from "@/features/memory/wiki-graph-model";

const SHARED_WORDS = 8;
const CARRIED_WORDS = 4;

/**
 * The sentence that follows a line this page shares with exactly one other
 * page. The shared line stays where it is; only the other page's next
 * sentence is carried across.
 */
export function wikiCarriedSentence(
  pageKey: string,
  graph: WikiGraphData,
): string | undefined {
  const here = graph.nodes.find((node) => node.id === pageKey);
  if (!here) return undefined;
  const own = sentences(here);
  const ownKeys = new Set(own.map(sentenceKey));
  let best: { followed: string; words: number } | undefined;
  for (const other of graph.nodes) {
    if (other.id === pageKey) continue;
    const theirs = sentences(other);
    const shared = own.filter((sentence) => {
      const key = sentenceKey(sentence);
      return (
        wordCount(sentence) >= SHARED_WORDS &&
        theirs.some((candidate) => sentenceKey(candidate) === key)
      );
    });
    for (const sentence of shared) {
      const pages = graph.nodes.filter((node) =>
        sentences(node).some(
          (candidate) => sentenceKey(candidate) === sentenceKey(sentence),
        ),
      );
      if (pages.length !== 2) continue;
      const index = theirs.findIndex(
        (candidate) => sentenceKey(candidate) === sentenceKey(sentence),
      );
      const next = index < 0 ? undefined : theirs[index + 1];
      if (!next || wordCount(next) < CARRIED_WORDS) continue;
      if (ownKeys.has(sentenceKey(next))) continue;
      const words = wordCount(sentence);
      if (!best || words > best.words) best = { followed: next, words };
    }
  }
  return best?.followed;
}

function sentences(node: WikiGraphNode): string[] {
  const text = node.body
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "")
    .replace(/^#{1,6} .*$/gmu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[*_`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function sentenceKey(sentence: string): string {
  return sentence.toLowerCase().replace(/\s+/gu, " ").trim();
}

function wordCount(sentence: string): number {
  return sentence.split(/\s+/u).filter(Boolean).length;
}
