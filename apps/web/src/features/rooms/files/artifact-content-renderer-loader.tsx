import { Spinner } from "@/components/ui/spinner";
import { lazy, Suspense, useEffect } from "react";

import { ReadOnlyBlockNoteDocumentLoader } from "@/components/read-only-blocknote-document-loader";
import type { ReadOnlyMarkdownPresentation } from "@/components/read-only-markdown-presentation";
import { translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import type { ArtifactReadingPosition } from "./artifact-preview-cache";
import type { ArtifactContentRendererProps } from "./artifact-content-renderer";
import type { ArtifactRendererKind } from "./artifact-renderer-policy";
import { DataPreviewAdapterLoader } from "./data-preview-adapter-loader";
import { filePreviewMessages as m } from "./file-preview.messages";
import { MediaPreviewAdapterLoader } from "./media-preview-adapter-loader";
import { OfficePreviewAdapterLoader } from "./office-preview-adapter-loader";
import { PdfPreviewAdapterLoader } from "./pdf-preview-adapter-loader";

const ArtifactContentRenderer = lazy(async () => {
  const module = await import("./artifact-content-renderer");
  return { default: module.ArtifactContentRenderer };
});

type ArtifactContentRendererLoaderProps = Omit<
  ArtifactContentRendererProps,
  "kind"
> & {
  blob?: Blob;
  readingPosition?: ArtifactReadingPosition;
  kind: Exclude<ArtifactRendererKind, "download">;
  mediaType?: string;
  onError?: (message: string) => void;
  presentation?: ReadOnlyMarkdownPresentation;
  sourceSizeBytes?: number;
};

export function ArtifactContentRendererLoader({
  kind,
  ...props
}: ArtifactContentRendererLoaderProps) {
  const t = useT();
  if (kind === "markdown") {
    return (
      <ReadOnlyBlockNoteDocumentLoader
        ariaLabel={t(m.readOnlyMarkdown)}
        assetBaseUrl={props.previewUrl}
        markdown={props.textContent ?? ""}
        presentation={props.presentation}
      />
    );
  }

  if (kind === "office") {
    return props.blob && props.mediaType ? (
      <OfficePreviewAdapterLoader
        blob={props.blob}
        filename={props.filename}
        mediaType={props.mediaType}
        onError={props.onError}
        readingPosition={props.readingPosition}
      />
    ) : (
      <UnavailablePreview
        message={m.officeContentUnavailable}
        onError={props.onError}
      />
    );
  }

  if (kind === "pdf") {
    return props.blob ? (
      <PdfPreviewAdapterLoader
        blob={props.blob}
        filename={props.filename}
        onError={props.onError}
        readingPosition={props.readingPosition}
      />
    ) : (
      <UnavailablePreview
        message={m.pdfContentUnavailable}
        onError={props.onError}
      />
    );
  }

  if (kind === "csv") {
    return props.blob && props.mediaType ? (
      <DataPreviewAdapterLoader
        blob={props.blob}
        filename={props.filename}
        mediaType={props.mediaType}
        onError={props.onError}
        sourceSizeBytes={props.sourceSizeBytes}
      />
    ) : (
      <UnavailablePreview
        message={m.tableContentUnavailable}
        onError={props.onError}
      />
    );
  }

  if (kind === "media") {
    return props.objectUrl && props.mediaType ? (
      <MediaPreviewAdapterLoader
        filename={props.filename}
        key={`${props.mediaType}:${props.objectUrl}`}
        mediaType={props.mediaType}
        objectUrl={props.objectUrl}
        onError={props.onError}
        sourceSizeBytes={props.sourceSizeBytes}
      />
    ) : (
      <UnavailablePreview
        message={m.mediaContentUnavailable}
        onError={props.onError}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <div
          className="flex h-full items-center justify-center gap-2 text-sm text-app-subtle"
          role="status"
        >
          <Spinner size={16} />
          {t(m.loadingRenderer)}
        </div>
      }
    >
      <ArtifactContentRenderer {...props} kind={kind} />
    </Suspense>
  );
}

/**
 * A renderer whose content never arrived. Rendering nothing here is
 * indistinguishable from a successful preview of an empty file, so say so and
 * report upward: the preview surfaces turn this into their own fallback with
 * Download and Retry.
 */
function UnavailablePreview({
  message,
  onError,
}: {
  message: Message<string>;
  onError?: (message: string) => void;
}) {
  const t = useT();
  useEffect(() => {
    onError?.(translate(message));
  }, [message, onError]);
  return (
    <div
      className="flex h-full min-h-[420px] items-center justify-center bg-app-surface-soft p-8 text-center text-sm text-app-muted"
      role="alert"
    >
      {t(message)}
    </div>
  );
}
