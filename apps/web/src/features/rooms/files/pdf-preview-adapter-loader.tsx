import { Spinner } from "@/components/ui/spinner";
import { lazy, Suspense } from "react";
import { useT } from "@/i18n/use-translation";
import { filePreviewMessages as m } from "./file-preview.messages";

import type { PdfPreviewAdapterProps } from "./pdf-preview-adapter";

const PdfPreviewAdapter = lazy(async () => {
  const module = await import("./pdf-preview-adapter");
  return { default: module.PdfPreviewAdapter };
});

export function PdfPreviewAdapterLoader(props: PdfPreviewAdapterProps) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div
          className="flex h-full min-h-[420px] items-center justify-center gap-2 text-sm text-app-subtle"
          role="status"
        >
          <Spinner size={16} />
          {t(m.loadingPdfPreview)}
        </div>
      }
    >
      <PdfPreviewAdapter {...props} />
    </Suspense>
  );
}
