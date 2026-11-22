import { Search01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { formatLocale } from "@/i18n/language";
import { useTranslation } from "@/i18n/use-translation";

import "./wiki-knowledge-graph.css";
import {
  buildTimeline,
  nodeMoments,
  pageTitle,
  type NodeMoment,
  type TimeGranularity,
  type WikiGraphData,
  type WikiGraphNode,
} from "./wiki-graph-model";
import { graphNeighborhood } from "./graph-neighborhood";
import { GraphNeighborhoodView } from "./graph-neighborhood-view";
import { WikiGraphTimeline } from "./wiki-graph-timeline";
import { wikiTimelineMessages as m } from "./wiki-timeline.messages";
import {
  firstReelIndex,
  REEL_BEAT_MS,
  reelStep,
  titlesInBucket,
} from "./year-reel";

/** Daily or Weekly report cards above a ruler of dated Wiki pages. */
export function WikiKnowledgeGraph({
  graph,
  timelineMoments,
  renderTimeline,
  onReadingModeChange,
  dailyPanel,
}: {
  graph: WikiGraphData;
  timelineMoments?: Map<string, NodeMoment[]>;
  renderTimeline?: (
    pages: WikiGraphNode[],
    granularity: TimeGranularity,
    navigation: {
      focus?: { day: string; request: number };
      onPeriodChange: (day: string) => void;
    },
  ) => ReactNode;
  onReadingModeChange?: () => void;
  dailyPanel?: ReactNode;
}) {
  const { language, t } = useTranslation();
  const locale = formatLocale(language);
  const [granularity, setGranularity] = useState<TimeGranularity>("day");
  const [query, setQuery] = useState("");
  const moments = useMemo(
    () => timelineMoments ?? nodeMoments(graph),
    [graph, timelineMoments],
  );
  const timeline = useMemo(
    () => buildTimeline(moments, granularity, undefined, locale),
    [granularity, locale, moments],
  );
  const lastBucket = Math.max(0, timeline.buckets.length - 1);
  // The playhead starts on the latest bucket.
  const [cursor, setCursor] = useState(lastBucket);
  // True once a day is picked; Latest returns to the unfocused view.
  const [focused, setFocused] = useState(false);
  const [cardFocus, setCardFocus] = useState<{
    day: string;
    request: number;
  }>();
  const [playing, setPlaying] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [reelNotice, setReelNotice] = useState<string>();
  const focusBucket = (index: number) => {
    setCursor(index);
    setFocused(true);
    const day = timeline.buckets[index]?.start;
    if (day)
      setCardFocus((previous) => ({
        day,
        request: (previous?.request ?? 0) + 1,
      }));
  };
  const pickDay = (index: number) => {
    setPlaying(false);
    focusBucket(index);
  };
  const followCard = (day: string) => {
    setPlaying(false);
    const index = timeline.buckets.findIndex((bucket) => bucket.start === day);
    if (index < 0) return;
    setCursor(index);
    setFocused(true);
  };
  const showAll = useCallback(() => {
    setPlaying(false);
    setFocused(false);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const step = reelStep(timeline.buckets, cursor);
    const timer = window.setTimeout(() => {
      if (step === "end") {
        setPlaying(false);
        setReelNotice("That's the year.");
        return;
      }
      setQuiet(step.skipped);
      setCursor(step.index);
      setFocused(true);
      const day = timeline.buckets[step.index]?.start;
      if (day)
        setCardFocus((previous) => ({
          day,
          request: (previous?.request ?? 0) + 1,
        }));
    }, REEL_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [cursor, playing, timeline]);

  const changeGranularity = (next: TimeGranularity) => {
    if (next === granularity) return;
    setPlaying(false);
    onReadingModeChange?.();
    // Keep the playhead on the same day when switching between day and week buckets.
    const day = timeline.buckets[cursor]?.start;
    const nextTimeline = buildTimeline(moments, next);
    const locate = (day: string | undefined, fallback: number) => {
      if (!day) return fallback;
      let index = -1;
      nextTimeline.buckets.forEach((bucket, position) => {
        if (bucket.start <= day) index = position;
      });
      return index < 0 ? fallback : index;
    };
    const last = Math.max(0, nextTimeline.buckets.length - 1);
    const nextCursor = cursor === lastBucket ? last : locate(day, last);
    setCursor(nextCursor);
    setGranularity(next);
    const nextDay = nextTimeline.buckets[nextCursor]?.start;
    setCardFocus((previous) =>
      focused && nextDay
        ? { day: nextDay, request: (previous?.request ?? 0) + 1 }
        : undefined,
    );
  };

  const matchingPages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? graph.nodes.filter((node) =>
          [node.title, node.description, ...node.tags]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : graph.nodes;
  }, [graph, query]);
  const neighborhood = useMemo(
    () => graphNeighborhood(graph, query),
    [graph, query],
  );
  const landed = playing
    ? titlesInBucket(graph, timeline, cursor).join(", ")
    : "";

  return (
    <div className="wiki-graph-surface">
      <div className="wiki-graph-toolbar">
        <div
          aria-label={t(m.granularity)}
          className="wiki-graph-segmented"
          role="radiogroup"
        >
          {(["day", "week"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={granularity === value}
              onClick={() => changeGranularity(value)}
            >
              {t(value === "day" ? m.day : m.week)}
            </button>
          ))}
        </div>
        <label className="wiki-graph-search">
          <Icon icon={Search01Icon} size={14} />
          <input
            aria-label={t(m.searchPages)}
            onChange={(event) => {
              setPlaying(false);
              setQuery(event.target.value);
            }}
            placeholder={t(m.searchPages)}
            type="search"
            value={query}
          />
        </label>
        {firstReelIndex(timeline.buckets) !== undefined ? (
          <button
            className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              if (playing) {
                setPlaying(false);
                return;
              }
              const start = firstReelIndex(timeline.buckets);
              if (start === undefined) return;
              setReelNotice(undefined);
              setQuiet(false);
              focusBucket(start);
              setPlaying(true);
            }}
            type="button"
          >
            {playing ? "Stop the year" : "Play the year"}
          </button>
        ) : null}
        {playing && landed ? (
          <p className="text-sm text-foreground" role="status">
            {quiet ? `${landed}, after a quiet stretch` : landed}
          </p>
        ) : reelNotice ? (
          <p className="text-sm text-app-muted" role="status">
            {reelNotice}
          </p>
        ) : null}
      </div>

      {neighborhood ? (
        <GraphNeighborhoodView
          neighborhood={neighborhood}
          onOpen={(node) => {
            setPlaying(false);
            setQuery(pageTitle(node));
          }}
        />
      ) : null}

      <div className="wiki-graph-reading-row">
        {renderTimeline?.(matchingPages, granularity, {
          focus: cardFocus,
          onPeriodChange: followCard,
        }) ?? <p className="p-6 text-sm text-app-muted">{t(m.noReports)}</p>}
        {dailyPanel}
      </div>

      <WikiGraphTimeline
        buckets={timeline.buckets}
        granularity={granularity}
        cursor={cursor}
        focused={focused}
        onCursorChange={pickDay}
        onSelect={pickDay}
        onShowAll={showAll}
      />
    </div>
  );
}
