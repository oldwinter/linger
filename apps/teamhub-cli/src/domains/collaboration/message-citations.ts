import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { inputIssue, invalidInput } from "../../input-issues.js";

const markdown = unified().use(remarkParse).use(remarkGfm).freeze();

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

/** Validate the entire batch before any message or sequence is published. */
export function assertMessageCitations(messages: readonly string[]): void {
  const cited = messages.flatMap((message, index) =>
    hasCitation(markdown.parse(message))
      ? [
          inputIssue(
            messages.length === 1 ? "content" : `messages[${index}]`,
            "invalid_value",
            "replace provider-internal citations with Markdown links [source title](real URL); do not invent a missing URL, and put literal citation syntax in code.",
          ),
        ]
      : [],
  );
  if (cited.length)
    throw invalidInput(
      "No messages were sent: a message contains a provider-internal citation.",
      cited,
    );
}

function hasCitation(node: MarkdownNode): boolean {
  if (node.type === "code" || node.type === "inlineCode") return false;
  return Boolean(
    node.value?.includes("\uE200cite\uE202") ||
    node.children?.some(hasCitation),
  );
}
