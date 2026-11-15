import { Copy01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { writeClipboardText } from "@/lib/clipboard";

import {
  wikiCollectionMarkdown,
  type WikiCollectionListPage,
} from "./wiki-collection-markdown";
import { useWikiCopyFeedback, WikiCopyFeedback } from "./wiki-copy-feedback";

/**
 * Copies the collection page's list exactly as shown. The caller passes the
 * pages the filter left visible, and nothing is written until it is asked for.
 */
export function WikiCollectionCopyList({
  label,
  pages,
}: {
  label: string;
  pages: readonly WikiCollectionListPage[];
}) {
  const feedback = useWikiCopyFeedback();

  function copyList() {
    feedback.begin();
    void writeClipboardText(
      wikiCollectionMarkdown({
        label,
        origin: window.location.origin,
        pages,
      }),
    ).then(feedback.copied, feedback.failed);
  }

  return (
    <div className="flex items-center gap-2">
      <WikiCopyFeedback state={feedback.state} />
      <Button
        disabled={pages.length === 0}
        onClick={copyList}
        size="compact"
        title="Copy the pages shown as a Markdown list"
        tone="ghost"
      >
        <Icon icon={Copy01Icon} className="shrink-0" size={14} />
        Copy list
      </Button>
    </div>
  );
}
