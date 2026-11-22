import { Spinner } from "@/components/ui/spinner";
import { lazy, Suspense } from "react";
import { useT } from "@/i18n/use-translation";
import { filePreviewMessages as m } from "./file-preview.messages";
import type { OfficePreviewAdapterProps } from "./office-preview-adapter";
import { loadOfficePreviewAdapter } from "./office-preview-preparation";

const OfficePreviewAdapter = lazy(() =>
  loadOfficePreviewAdapter().then((module) => ({
    default: module.OfficePreviewAdapter,
  })),
);

export function OfficePreviewAdapterLoader(props: OfficePreviewAdapterProps) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div
          className="flex h-full min-h-[420px] items-center justify-center gap-2 bg-app-surface-soft text-sm text-app-subtle"
          role="status"
        >
          <Spinner size={16} />
          {t(m.loadingOfficePreview)}
        </div>
      }
    >
      <OfficePreviewAdapter {...props} />
    </Suspense>
  );
}
