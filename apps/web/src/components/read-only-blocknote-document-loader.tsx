import { lazy, Suspense } from "react";

import { documentEditorMessages } from "@/features/rooms/documents/document-editor.messages";
import { useT } from "@/i18n/use-translation";

import { Spinner } from "./ui/spinner";
import type { ReadOnlyBlockNoteDocumentProps } from "./read-only-blocknote-document";

const ReadOnlyBlockNoteDocument = lazy(() =>
  import("./read-only-blocknote-document").then((module) => ({
    default: module.ReadOnlyBlockNoteDocument,
  })),
);

export function ReadOnlyBlockNoteDocumentLoader(
  props: ReadOnlyBlockNoteDocumentProps,
) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center gap-2 p-4 text-sm text-app-muted"
          role="status"
        >
          <Spinner size={16} />
          {t(documentEditorMessages.loadingDocument)}
        </div>
      }
    >
      <ReadOnlyBlockNoteDocument {...props} />
    </Suspense>
  );
}
