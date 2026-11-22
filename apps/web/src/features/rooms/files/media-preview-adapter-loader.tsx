import { Spinner } from "@/components/ui/spinner";
import { lazy, Suspense } from "react";
import { useT } from "@/i18n/use-translation";
import { filePreviewMessages as m } from "./file-preview.messages";

import type { MediaPreviewAdapterProps } from "./media-preview-adapter";

const LazyMediaPreviewAdapter = lazy(async () => {
  const module = await import("./media-preview-adapter");
  return { default: module.MediaPreviewAdapter };
});

export function MediaPreviewAdapterLoader(props: MediaPreviewAdapterProps) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div
          className="flex h-full min-h-[420px] items-center justify-center gap-2 text-sm text-app-subtle"
          role="status"
        >
          <Spinner size={16} />
          {t(m.loadingMediaPlayer)}
        </div>
      }
    >
      <LazyMediaPreviewAdapter {...props} />
    </Suspense>
  );
}
