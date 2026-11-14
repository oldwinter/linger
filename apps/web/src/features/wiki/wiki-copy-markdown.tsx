import { useState } from "react";

import { Button } from "@/components/ui/button";
import { documentDownloadContent } from "@/features/rooms/documents/document-download-content";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { writeClipboardText } from "@/lib/clipboard";

import { useWikiCopyFeedback, WikiCopyFeedback } from "./wiki-copy-feedback";

/**
 * Copies what Download saves for this Wiki page, on request and only then: the
 * page's Markdown, whole and unmodified. The page stays read-only.
 */
export function WikiCopyMarkdown({ documentId }: { documentId: string }) {
  const { client } = useTeamHubRuntime();
  const feedback = useWikiCopyFeedback();
  const [pending, setPending] = useState(false);

  async function copyMarkdown() {
    if (pending) return;
    setPending(true);
    feedback.begin();
    try {
      const content = await documentDownloadContent(client, documentId);
      await writeClipboardText(await content.blob.text());
      feedback.copied();
    } catch {
      // A refused clipboard and a page that cannot be read need the same reply.
      feedback.failed();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <WikiCopyFeedback state={feedback.state} />
      <Button
        loading={pending}
        onClick={() => void copyMarkdown()}
        size="compact"
        tone="ghost"
      >
        Copy as Markdown
      </Button>
    </>
  );
}
