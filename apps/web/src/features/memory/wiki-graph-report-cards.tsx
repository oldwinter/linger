import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  buildTimeline,
  bucketStart,
  TIMELINE_EVENT_PREFIX,
  type NodeMoment,
  type TimeGranularity,
  type WikiGraphNode,
} from "./wiki-graph-model";
import { WikiDailyCard } from "../wiki/wiki-daily-card";
import { reportSearchItems, searchReports } from "./report-search";
import {
  reportDate,
  usePeriodReports,
  type PeriodReportKind,
} from "./wiki-period-reports";
import { wikiTimelineMessages as m } from "./wiki-timeline.messages";

export function WikiGraphReportCards({
  tenantId,
  pages,
  moments,
  granularity,
  onSelectReport,
  focus,
  onPeriodChange,
}: {
  tenantId: string;
  pages: WikiGraphNode[];
  moments: Map<string, NodeMoment[]>;
  granularity: TimeGranularity;
  onSelectReport: (kind: PeriodReportKind, day: string) => void;
  focus?: { day: string; request: number };
  onPeriodChange?: (day: string) => void;
}) {
  const kind = granularity === "day" ? "daily" : "weekly";
  // Reset the carousel when changing period; each query remains separately cached.
  return (
    <PeriodCards
      key={kind}
      {...{
        tenantId,
        pages,
        moments,
        granularity,
        onSelectReport,
        kind,
        focus,
        onPeriodChange,
      }}
    />
  );
}

function PeriodCards({
  tenantId,
  pages,
  moments,
  granularity,
  onSelectReport,
  kind,
  focus,
  onPeriodChange,
}: Parameters<typeof WikiGraphReportCards>[0] & { kind: PeriodReportKind }) {
  const reports = usePeriodReports(tenantId, kind);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef(new Map<number, HTMLElement>());
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollEdges, setScrollEdges] = useState({ start: true, end: false });
  const initialized = useRef(false);
  const followingRuler = useRef(false);
  const scrollTarget = useRef(0);
  const dragging = useRef<{
    pointerId: number;
    x: number;
    left: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const t = useT();
  const daily = kind === "daily";
  const entriesByDate = useMemo(
    () =>
      new Map((reports.data ?? []).map((entry) => [reportDate(entry)!, entry])),
    [reports.data],
  );
  const focusDay = focus?.day;
  const [query, setQuery] = useState("");
  const allCards = useMemo(() => {
    const dated = new Map<string, NodeMoment[]>();
    const pageDates = new Set<string>();
    for (const page of pages) {
      const dates = moments.get(page.id) ?? [];
      dated.set(page.id, dates);
      for (const day of new Set(
        dates.map((moment) => bucketStart(moment.day, granularity)),
      )) {
        pageDates.add(day);
      }
    }
    for (const [id, dates] of moments) {
      if (!id.startsWith(TIMELINE_EVENT_PREFIX)) continue;
      dated.set(id, dates);
      for (const moment of dates)
        pageDates.add(bucketStart(moment.day, granularity));
    }
    for (const day of entriesByDate.keys())
      dated.set(`report:${day}`, [{ day, strength: "event" }]);
    if (focusDay !== undefined)
      dated.set("playhead", [{ day: focusDay, strength: "event" }]);
    const buckets = buildTimeline(dated, granularity).buckets;
    return buckets
      .filter(
        (bucket, index) =>
          entriesByDate.has(bucket.start) ||
          pageDates.has(bucket.start) ||
          bucket.start === focusDay ||
          index === buckets.length - 1,
      )
      .map((bucket) => ({
        day: bucket.start,
        entry: entriesByDate.get(bucket.start),
      }));
  }, [entriesByDate, granularity, moments, pages, focusDay]);
  // The readable text is derived once per report list; a keystroke only scans
  // the prepared rows.
  const searchItems = useMemo(
    () => reportSearchItems(reports.data ?? []),
    [reports.data],
  );
  const searching = query.trim() !== "";
  const matchingDays = useMemo(
    () => new Set(searchReports(searchItems, query).map((item) => item.day)),
    [searchItems, query],
  );
  const cards = useMemo(
    () =>
      searching
        ? allCards.filter((card) => matchingDays.has(card.day))
        : allCards,
    [allCards, matchingDays, searching],
  );

  const updateActiveIndex = useCallback(() => {
    const track = trackRef.current;
    const first = cardsRef.current.get(0);
    const second = cardsRef.current.get(1);
    if (!track || !first) return;
    const stride = second
      ? second.offsetLeft - first.offsetLeft
      : first.offsetWidth;
    const start = track.scrollLeft <= 1;
    const end = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    setScrollEdges((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
    if (stride > 0)
      setActiveIndex(
        Math.min(
          track.childElementCount - 1,
          Math.max(0, Math.round(track.scrollLeft / stride)),
        ),
      );
  }, []);

  const scrollToCard = useCallback(
    (index: number, smooth = true) => {
      const track = trackRef.current;
      const card = cardsRef.current.get(index);
      if (!track || !card) return;
      scrollTarget.current = index;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      track.scrollTo({
        left:
          card.offsetLeft -
          Number.parseFloat(getComputedStyle(track).paddingLeft),
        behavior: smooth && !reduced ? "smooth" : "instant",
      });
      if (!smooth || reduced) updateActiveIndex();
    },
    [updateActiveIndex],
  );
  const hasCards = cards.length > 0;
  const focusIndex = focus
    ? cards.findIndex((card) => card.day === focus.day)
    : -1;
  useEffect(() => {
    if (initialized.current || reports.isPending || !cards.length) return;
    initialized.current = true;
    // Initial positioning follows Latest (or an explicitly selected date),
    // without treating the programmatic scroll as a user's date selection.
    followingRuler.current = true;
    scrollToCard(focusIndex >= 0 ? focusIndex : cards.length - 1, false);
  }, [cards, focusIndex, reports.isPending, scrollToCard]);

  useEffect(() => {
    if (!focus || reports.isPending) return;
    if (focusIndex < 0) return;
    followingRuler.current = true;
    scrollToCard(focusIndex);
  }, [focus, focusIndex, reports.isPending, scrollToCard]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || reports.isPending) return;
    let width = track.clientWidth;
    const observer = new ResizeObserver(() => {
      if (track.clientWidth === width) return;
      width = track.clientWidth;
      // Keep the selected card (including Latest) when the sidebar changes
      // the available width. A resize must not select another report date.
      followingRuler.current = true;
      scrollToCard(scrollTarget.current, false);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [hasCards, reports.isPending, scrollToCard]);

  function browseToCard(index: number) {
    followingRuler.current = false;
    scrollToCard(index);
  }

  function openReport(day: string) {
    onPeriodChange?.(day);
    onSelectReport(kind, day);
  }

  useEffect(() => {
    const track = trackRef.current;
    if (!track || reports.isPending) return;
    const wheel = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey) return;
      followingRuler.current = false;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      track.scrollBy({
        left: event.deltaY * (event.deltaMode === 1 ? 16 : 1),
        behavior: reduced ? "instant" : "smooth",
      });
    };
    track.addEventListener("wheel", wheel, { passive: false });
    return () => track.removeEventListener("wheel", wheel);
  }, [cards.length, reports.isPending]);

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    followingRuler.current = false;
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      (event.target as Element).closest("a")
    )
      return;
    const track = trackRef.current;
    if (!track) return;
    suppressClick.current = false;
    dragging.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      left: track.scrollLeft,
      moved: false,
    };
  }
  function drag(event: PointerEvent<HTMLDivElement>) {
    const current = dragging.current;
    const track = trackRef.current;
    if (!current || !track) return;
    const dx = event.clientX - current.x;
    if (!current.moved && Math.abs(dx) < 5) return;
    if (!current.moved) {
      current.moved = true;
      track.setPointerCapture(event.pointerId);
      track.dataset.dragging = "true";
    }
    event.preventDefault();
    track.scrollLeft = current.left - dx;
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const current = dragging.current;
    dragging.current = null;
    const track = trackRef.current;
    if (!track || !current?.moved) return;
    delete track.dataset.dragging;
    suppressClick.current = true;
    if (track.hasPointerCapture(event.pointerId))
      track.releasePointerCapture(event.pointerId);
    const first = cardsRef.current.get(0);
    const second = cardsRef.current.get(1);
    const stride =
      first && second
        ? second.offsetLeft - first.offsetLeft
        : (first?.offsetWidth ?? 1);
    if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 1) {
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      track.scrollTo({
        left: track.scrollWidth,
        behavior: reduced ? "instant" : "smooth",
      });
    } else {
      scrollToCard(
        Math.min(
          cards.length - 1,
          Math.max(0, Math.round(track.scrollLeft / stride)),
        ),
      );
    }
  }

  return (
    <section
      aria-label={t(daily ? m.dailyTimeline : m.weeklyTimeline)}
      className="wiki-report-timeline"
    >
      <div className="wiki-report-controls">
        <button
          type="button"
          aria-label={t(
            granularity === "day" ? m.previousDayCard : m.previousWeekCard,
          )}
          disabled={scrollEdges.start}
          onClick={() => browseToCard(activeIndex - 1)}
        >
          <Icon icon={ArrowLeft01Icon} size={16} />
        </button>
        <button
          type="button"
          aria-label={t(granularity === "day" ? m.nextDayCard : m.nextWeekCard)}
          disabled={scrollEdges.end}
          onClick={() => browseToCard(activeIndex + 1)}
        >
          <Icon icon={ArrowRight01Icon} size={16} />
        </button>
      </div>
      {!reports.isPending && allCards.length ? (
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
          <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground transition-colors hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40 sm:w-64">
            <Icon icon={Search01Icon} size={16} />
            <input
              aria-label="Search reports"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-app-placeholder"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by date or text"
              role="searchbox"
              type="text"
              value={query}
            />
            {query ? (
              <button
                aria-label="Clear report search"
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                onClick={() => setQuery("")}
                type="button"
              >
                <Icon icon={Cancel01Icon} size={14} />
              </button>
            ) : null}
          </label>
        </div>
      ) : null}
      {reports.error ? (
        <div role="alert" className="wiki-report-error">
          <p>{reports.error.message}</p>
          <button type="button" onClick={() => void reports.refetch()}>
            {t(m.retryReports)}
          </button>
        </div>
      ) : null}
      {reports.isPending ? (
        <p role="status" className="p-6 text-sm text-app-muted">
          {t(daily ? m.loadingDailyCards : m.loadingWeeklyCards)}
        </p>
      ) : !allCards.length ? (
        <p className="p-6 text-sm text-app-muted">
          {t(daily ? m.noDailyCards : m.noWeeklyCards)}
        </p>
      ) : !cards.length ? (
        <p className="p-6 text-sm text-app-muted">No reports match.</p>
      ) : (
        <>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer dragging for the report track; keyboard scrolling works through its tabIndex */}
          <div
            ref={trackRef}
            aria-label={t(daily ? m.dailyCards : m.weeklyCards)}
            className="wiki-report-track workspace-scrollbar"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard-focusable scroll region so keyboard users can scroll it
            tabIndex={0}
            onScroll={updateActiveIndex}
            onScrollEnd={() => {
              if (followingRuler.current) {
                return;
              }
              scrollTarget.current = activeIndex;
              const card = cards[activeIndex];
              if (card) onPeriodChange?.(card.day);
            }}
            onPointerDown={beginDrag}
            onPointerMove={drag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClickCapture={(event) => {
              if (suppressClick.current) {
                event.preventDefault();
                event.stopPropagation();
                suppressClick.current = false;
              }
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const target =
                event.key === "ArrowLeft"
                  ? activeIndex - 1
                  : event.key === "ArrowRight"
                    ? activeIndex + 1
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? cards.length - 1
                        : undefined;
              if (target !== undefined) {
                event.preventDefault();
                browseToCard(Math.min(cards.length - 1, Math.max(0, target)));
              }
            }}
          >
            {cards.map((card, index) => (
              <div
                key={card.day}
                className="wiki-report-card"
                ref={(element) => {
                  if (element) cardsRef.current.set(index, element);
                  else cardsRef.current.delete(index);
                }}
              >
                <WikiDailyCard
                  tenantId={tenantId}
                  kind={kind}
                  day={card.day}
                  entry={card.entry}
                  load={Math.abs(index - activeIndex) <= 2}
                  onOpen={() => openReport(card.day)}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
