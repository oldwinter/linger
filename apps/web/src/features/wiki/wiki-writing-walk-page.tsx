import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useT } from "@/i18n/use-translation";

import { usePersonalWikiRefresh } from "./wiki-refresh";
import { wikiPreviewPath } from "./wiki-routes";
import { wikiSubpagesMessages as m } from "./wiki-subpages.messages";
import { wikiWritingPages, type WikiWritingPage } from "./wiki-writing-walk";

/**
 * Walks the pages Another Me has written in the current Wiki refresh, before
 * they are published. The first non-empty preview stays put so a later poll
 * does not skip the page you are reading.
 */
export function WikiWritingWalk() {
  const t = useT();
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
    <LibrarySubpageShell
      backLabel={t(m.backToWiki)}
      backTo={home}
      title={t(m.writingTitle)}
    >
      {seen === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          {refresh.refreshing ? t(m.writingNotReady) : t(m.notWritingNow)}
        </p>
      ) : finished ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-xs">
          <h2 className="text-lg font-medium text-foreground">
            {t(m.readPagesSoFar)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {refresh.refreshing ? t(m.stillWriting) : t(m.pagesInWikiNow)}
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
              {t(m.checkForNewPages)}
            </Button>
          ) : null}
        </section>
      ) : current ? (
        <section
          aria-label={current.name}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs"
        >
          <p className="text-sm text-muted-foreground">
            {t(m.pageOfCollection, {
              collection: current.collectionLabel,
              current: step + 1,
              total: pages.length,
            })}
          </p>
          <h2 className="text-2xl font-semibold text-foreground">
            {current.name}
          </h2>
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
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              className="inline-flex h-9 items-center rounded-lg bg-app-ink px-3 text-sm text-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
              to={wikiPreviewPath(tenantId, current.path)}
            >
              {t(m.openPage)}
            </Link>
            <Button
              disabled={step === 0}
              onClick={() => setStep((value) => value - 1)}
              size="compact"
              tone="ghost"
            >
              {t(m.previous)}
            </Button>
            <Button
              onClick={() => setStep((value) => value + 1)}
              size="compact"
              tone="secondary"
            >
              {step + 1 === pages.length ? t(m.finish) : t(m.next)}
            </Button>
          </div>
        </section>
      ) : null}
    </LibrarySubpageShell>
  );
}
