import { Button } from "@/components/ui/button";
import { writeClipboardText } from "@/lib/clipboard";

import { useWikiCopyFeedback, WikiCopyFeedback } from "./wiki-copy-feedback";
import { wikiDocumentPath } from "./wiki-routes";

/**
 * Copies the page's canonical URL, origin included, and reports the clipboard's
 * answer so a refused write never reads as success.
 */
export function WikiCopyLink({
  documentId,
  tenantId,
}: {
  documentId: string;
  tenantId: string;
}) {
  const feedback = useWikiCopyFeedback();

  function copyLink() {
    feedback.begin();
    void writeClipboardText(
      new URL(
        wikiDocumentPath(tenantId, documentId),
        window.location.origin,
      ).toString(),
    ).then(feedback.copied, feedback.failed);
  }

  return (
    <>
      <WikiCopyFeedback state={feedback.state} />
      <Button onClick={copyLink} size="compact" tone="ghost">
        Copy link
      </Button>
    </>
  );
}
