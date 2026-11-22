import { lazy, Suspense, useState } from "react";

import { useT } from "@/i18n/use-translation";

import { documentEditorMessages as m } from "./document-editor.messages";
import {
  getPreloadedDocumentEditor,
  preloadDocumentEditor,
} from "./document-editor-preload";

import type { RoomDocumentBlockNoteEditorProps } from "./room-document-blocknote-editor";

const LazyRoomDocumentBlockNoteEditor = lazy(() =>
  preloadDocumentEditor().then((module) => ({
    default: module.RoomDocumentBlockNoteEditor,
  })),
);

export function RoomDocumentBlockNoteEditor(
  props: RoomDocumentBlockNoteEditorProps,
) {
  const t = useT();
  // Keep the selected component type for this mount: switching from lazy to
  // direct after hydration would remount the editor and lose its selection.
  const [Editor] = useState(
    () => getPreloadedDocumentEditor() ?? LazyRoomDocumentBlockNoteEditor,
  );
  return (
    <Suspense
      fallback={
        <section
          aria-busy="true"
          aria-label={t(m.loadingEditor)}
          className="room-document-blocknote min-h-[420px]"
          role="status"
        />
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
