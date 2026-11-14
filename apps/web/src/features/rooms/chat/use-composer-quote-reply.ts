import { useState } from "react";

import type { StagedQuoteReply } from "./quote-reply";
import type { ComposerDraft } from "./use-composer-draft";

export interface ComposerQuoteReplyInput {
  draft: ComposerDraft;
}

/**
 * Stages a quoted reply at the head of the composer text. The quote is draft
 * text, so it saves, sends, and clears with the draft; only the strip that
 * names it lives here.
 */
export function useComposerQuoteReply({
  draft: { body, bodyRef, pendingCaretRef, updateBody },
}: ComposerQuoteReplyInput) {
  const [staged, setStaged] = useState<StagedQuoteReply | null>(null);
  // Sending clears the body, and an edited quote no longer heads it; either
  // way a strip over text that is gone would name a quote the person cannot
  // see.
  const stagedQuoteReply =
    staged && bodyHeadsQuote(body, staged.quote) ? staged : null;

  function stageQuoteReply(next: StagedQuoteReply) {
    const rest = withoutStagedQuote(bodyRef.current, stagedQuoteReply?.quote);
    pendingCaretRef.current = next.quote.length + 2;
    setStaged(next);
    updateBody(`${next.quote}\n\n${rest}`);
  }

  function dismissQuoteReply() {
    if (!stagedQuoteReply) return;
    const rest = withoutStagedQuote(bodyRef.current, stagedQuoteReply.quote);
    pendingCaretRef.current = rest.length;
    setStaged(null);
    updateBody(rest);
  }

  return { dismissQuoteReply, stageQuoteReply, stagedQuoteReply };
}

export type ComposerQuoteReply = ReturnType<typeof useComposerQuoteReply>;

function bodyHeadsQuote(body: string, quote: string) {
  return body === quote || body.startsWith(`${quote}\n`);
}

/** The text under a staged quote, with the quote block itself removed. Text
 * the person wrote outside the quote stays. */
function withoutStagedQuote(body: string, quote: string | undefined) {
  if (quote === undefined) return body;
  if (body.startsWith(`${quote}\n\n`)) return body.slice(quote.length + 2);
  if (body === quote) return "";
  return body;
}
