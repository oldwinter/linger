import { Spinner } from "@/components/ui/spinner";
import { lazy, Suspense } from "react";
import { useT } from "@/i18n/use-translation";
import { filePreviewMessages as m } from "./file-preview.messages";

import type { DataPreviewAdapterProps } from "./data-preview-adapter";

const DataPreviewAdapter = lazy(async () => {
  const module = await import("./data-preview-adapter");
  return { default: module.DataPreviewAdapter };
});

export function DataPreviewAdapterLoader(props: DataPreviewAdapterProps) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div
          className="flex h-full min-h-[420px] items-center justify-center gap-2 text-sm text-app-subtle"
          role="status"
        >
          <Spinner size={16} />
          {t(m.loadingDataPreview)}
        </div>
      }
    >
      <DataPreviewAdapter {...props} />
    </Suspense>
  );
}
