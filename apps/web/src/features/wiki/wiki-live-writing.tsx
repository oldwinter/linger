import { Link } from "react-router";

import { wikiCollectionLabels } from "./wiki-display-state";
import { wikiPreviewPath } from "./wiki-preview-page";
import { wikiPageExcerpt } from "./wiki-live-focus";
import type { WikiPreviewPage } from "./wiki-preview-pages";

/**
 * The page Another Me just wrote, on one surface. It changes when a later
 * preview arrives; it does not ask the reader to step through the pages.
 */
export function WikiLiveWriting({
  count,
  page,
  tenantId,
}: {
  count: number;
  page: WikiPreviewPage;
  tenantId: string;
}) {
  const excerpt = wikiPageExcerpt(page.markdown);
  return (
    <section
      aria-label="Wiki being written"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-app-border bg-app-canvas px-5 py-5"
    >
      <p className="text-sm text-app-muted">
        Another Me just wrote · {wikiCollectionLabels[page.collection]}
      </p>
      <h2 className="text-2xl text-foreground">{page.name}</h2>
      {page.description ? (
        <p className="text-sm text-app-muted">{page.description}</p>
      ) : null}
      {excerpt ? (
        <p className="text-[15px] leading-6 text-foreground">{excerpt}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          className="inline-flex h-9 items-center rounded-lg bg-app-ink px-3 text-sm text-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
          to={wikiPreviewPath(tenantId, page.path)}
        >
          Open page
        </Link>
        <p className="text-sm text-app-muted">
          {count === 1
            ? "1 page written so far"
            : `${count} pages written so far`}
        </p>
      </div>
    </section>
  );
}
