import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { writeClipboardText } from "@/lib/clipboard";

import { wikiDocumentPath } from "./wiki-routes";

/** Long enough to read, matching the other copy actions. */
const copiedDurationMs = 1200;

type LinkCopyState = "copied" | "failed";

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
  const [state, setState] = useState<LinkCopyState>();
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function copyLink() {
    window.clearTimeout(resetTimer.current);
    setState(undefined);
    void writeClipboardText(
      new URL(
        wikiDocumentPath(tenantId, documentId),
        window.location.origin,
      ).toString(),
    )
      .then(() => {
        setState("copied");
        resetTimer.current = window.setTimeout(
          () => setState(undefined),
          copiedDurationMs,
        );
      })
      .catch(() => setState("failed"));
  }

  return (
    <>
      {state === "copied" ? (
        <span className="text-xs leading-4 text-app-muted" role="status">
          Copied
        </span>
      ) : null}
      {state === "failed" ? (
        <span className="text-xs leading-4 text-app-danger" role="alert">
          Copy failed
        </span>
      ) : null}
      <Button onClick={copyLink} size="compact" tone="ghost">
        Copy link
      </Button>
    </>
  );
}
