import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";

import { usePersonalWikiRefresh } from "./wiki-refresh";
import { wikiPreviewPath } from "./wiki-preview-page";
import { wikiWritingPages, type WikiWritingPage } from "./wiki-writing-walk";

/**
 * Walks the pages Another Me has written in the current Wiki refresh, before
 * they are published. The first non-empty preview stays put so a later poll
 * does not skip the page you are reading.
 */
export function WikiWritingWalk() {
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const refresh = usePersonalWikiRefresh(tenantId);
  const live = useMemo(
    () => wikiWritingPages(refresh.preview),
    [refresh.preview],
  );
  const [seen, setSeen] = useState<WikiWritingPage[] | null>(null);
  const [step, setStep] = useState(0);
  const home = `/t/${encodeURIComponent(tenantId)}/library/wiki?tab=wiki`;

  useEffect(() => {
    if (seen || live.length === 0) return;
    setSeen(live);
  }, [live, seen]);

  const pages = seen ?? [];
  const current = pages[step];
  const finished = seen !== null && step >= pages.length;

  return (
    <main className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app-surface">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl text-foreground">Pages being written</h1>
          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            to={home}
          >
            Back to Wiki
          </Link>
        </header>
        {seen === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {refresh.refreshing
              ? "Another Me is writing. No page is ready yet."
              : "Another Me is not writing the Wiki right now."}
          </p>
        ) : finished ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg text-foreground">
              You've read the pages written so far.
            </h2>
            <p className="text-sm text-muted-foreground">
              {refresh.refreshing
                ? "Another Me is still writing."
                : "Those pages are in the Wiki now."}
            </p>
            {refresh.refreshing ? (
              <Button
                onClick={() => {
                  setSeen(null);
                  setStep(0);
                }}
                size="compact"
                tone="secondary"
              >
                Check for new pages
              </Button>
            ) : null}
          </section>
        ) : current ? (
          <section aria-label={current.name} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {step + 1} of {pages.length} · {current.collectionLabel}
            </p>
            <h2 className="text-2xl text-foreground">{current.name}</h2>
            {current.description ? (
              <p className="text-sm text-muted-foreground">
                {current.description}
              </p>
            ) : null}
            {current.excerpt ? (
              <p className="text-[15px] leading-6 text-foreground">
                {current.excerpt}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Link
                className="inline-flex h-9 items-center rounded-lg bg-app-ink px-3 text-sm text-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                to={wikiPreviewPath(tenantId, current.path)}
              >
                Open page
              </Link>
              <Button
                disabled={step === 0}
                onClick={() => setStep((value) => value - 1)}
                size="compact"
                tone="ghost"
              >
                Previous
              </Button>
              <Button
                onClick={() => setStep((value) => value + 1)}
                size="compact"
                tone="secondary"
              >
                {step + 1 === pages.length ? "Finish" : "Next"}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
