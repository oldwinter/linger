import {
  featuredMemory,
  localCalendarDay,
  memoryRecallLabel,
  reportsBesideRecall,
  type MemoryRecall,
} from "@/features/memory/on-this-day";
import type { TeamHubMemoryEntry } from "@/features/teamhub/teamhub-types";

import { WikiDailyCard } from "./wiki-daily-card";

export function recallForToday(entries: readonly TeamHubMemoryEntry[]) {
  const recall = featuredMemory(entries, localCalendarDay());
  return {
    recall,
    recent: reportsBesideRecall(entries, recall, 2),
  };
}

/** The Wiki home's featured memory, opened like any other Daily card. */
export function OnThisDayRecall({
  onOpen,
  recall,
  tenantId,
}: {
  onOpen: () => void;
  recall: MemoryRecall;
  tenantId: string;
}) {
  const label = memoryRecallLabel(recall);
  return (
    <section aria-label={label} className="mt-3 flex flex-col gap-2">
      <p className="text-xs font-medium text-app-muted">{label}</p>
      <WikiDailyCard
        day={recall.day}
        entry={recall.entry}
        onOpen={onOpen}
        tenantId={tenantId}
      />
    </section>
  );
}
