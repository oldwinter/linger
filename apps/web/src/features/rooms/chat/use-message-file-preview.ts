import { useCallback, useRef, useState } from "react";

import type {
  TeamHubMessageDocumentSegment,
  TeamHubMessageFileSegment,
} from "@/features/teamhub/teamhub-types";
import { translate } from "@/i18n/language";

import { chatMessages } from "./chat.messages";

/** Opens a Message file and reports only the latest request's failure. */
export function useMessageFilePreview(
  onOpenMessageFile: (
    segment: TeamHubMessageFileSegment | TeamHubMessageDocumentSegment,
  ) => Promise<void>,
) {
  const [filePreviewError, setFilePreviewError] = useState<string>();
  const filePreviewRequestRef = useRef(0);
  const previewMessageFile = useCallback(
    (segment: TeamHubMessageFileSegment | TeamHubMessageDocumentSegment) => {
      void (async () => {
        const requestId = ++filePreviewRequestRef.current;
        setFilePreviewError(undefined);
        try {
          await onOpenMessageFile(segment);
          if (filePreviewRequestRef.current !== requestId) {
            return;
          }
        } catch {
          if (filePreviewRequestRef.current === requestId) {
            setFilePreviewError(translate(chatMessages.filePreviewUnavailable));
          }
        }
      })();
    },
    [onOpenMessageFile],
  );
  return { filePreviewError, previewMessageFile };
}
