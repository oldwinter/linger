import { useState } from "react";

import { documentDownloadContent } from "@/features/rooms/documents/document-download-content";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { writeClipboardText } from "@/lib/clipboard";

import { useWikiCopyFeedback } from "./wiki-copy-feedback";

/**
 * Copies what Download saves for this Wiki page, on request and only then: the
 * page's Markdown, whole and unmodified. The page stays read-only.
 */
export function useWikiCopyMarkdown(documentId: string) {
  const { client } = useTeamHubRuntime();
  const feedback = useWikiCopyFeedback();
  const [pending, setPending] = useState(false);

  async function copy() {
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

  return { copy, feedback, pending };
}
