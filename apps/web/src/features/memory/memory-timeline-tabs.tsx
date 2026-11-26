import { Link } from "react-router";

import { useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { dayReviewPath } from "./day-review";
import { dayShapePath } from "./day-shape";
import { memorySubpagesMessages as m } from "./memory-subpages.messages";
import { weekMemoryPath } from "./week-memory";

export type MemoryTimelineTab = "day" | "day-shape" | "week";

/** Unified view switcher linking Day, Day shape, and Week memory routes. */
export function MemoryTimelineTabs({
  active,
  day,
  tenantId,
}: {
  active: MemoryTimelineTab;
  day?: string;
  tenantId: string;
}) {
  const t = useT();
  const items: Array<{ id: MemoryTimelineTab; label: string; to: string }> = [
    {
      id: "day",
      label: t(m.tabDay),
      to: day ? dayReviewPath(tenantId, day) : dayReviewPath(tenantId),
    },
    {
      id: "day-shape",
      label: t(m.tabDayShape),
      to: day
        ? dayShapePath(tenantId, day)
        : `/t/${encodeURIComponent(tenantId)}/library/day-shape`,
    },
    {
      id: "week",
      label: t(m.tabWeek),
      to: weekMemoryPath(tenantId),
    },
  ];

  return (
    <nav
      aria-label={t(m.timelineViews)}
      className="inline-flex w-fit items-center gap-1 rounded-xl border border-border bg-muted/60 p-1"
    >
      {items.map((item) => {
        const current = item.id === active;
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-app-hover hover:text-foreground",
            )}
            key={item.id}
            to={item.to}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
