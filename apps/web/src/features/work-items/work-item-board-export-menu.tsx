import {
  ArrowDown01Icon,
  Copy01Icon,
  Download04Icon,
  Link01Icon,
  Share08Icon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { buttonClassName } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { triggerArtifactDownload } from "@/features/rooms/files/artifact-preview-loader";
import { useT } from "@/i18n/use-translation";

import { useWorkItemClipboardCopy } from "./use-work-item-copy";
import { workItemBoardCsvFilename } from "./work-item-board-csv";
import { workItemBoardViewUrl } from "./work-item-board-view-link";
import { WorkItemCopyStatus } from "./work-item-copy-status";
import type { WorkItemDashboardFilters } from "./work-item-dashboard-filters";
import type { WorkItemDashboardSort } from "./work-item-sort";
import type { WorkItemViewMode } from "./work-item-view-mode";
import { workItemsMessages as m } from "./work-items.messages";

/**
 * Collapses the board's CSV export, Markdown copy, and view-link copy into one
 * header menu beside New issue, reporting copy or download outcomes underneath.
 */
export function WorkItemBoardExportMenu({
  csv,
  csvDisabled,
  filters,
  markdown,
  sort,
  tenantId,
  viewMode,
}: {
  csv: string;
  csvDisabled: boolean;
  filters: WorkItemDashboardFilters;
  markdown: string;
  sort: WorkItemDashboardSort;
  tenantId: string;
  viewMode?: WorkItemViewMode;
}) {
  const t = useT();
  const { clear, copiedLabel, copy, state } = useWorkItemClipboardCopy();
  const [csvFailed, setCsvFailed] = useState(false);

  function downloadCsv() {
    clear();
    setCsvFailed(false);
    try {
      triggerArtifactDownload(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        workItemBoardCsvFilename(),
      );
    } catch {
      setCsvFailed(true);
    }
  }

  function copyMarkdown() {
    setCsvFailed(false);
    copy(markdown);
  }

  function copyViewLink() {
    setCsvFailed(false);
    copy(
      workItemBoardViewUrl({
        filters,
        origin: window.location.origin,
        sort,
        tenantId,
        viewMode,
      }),
    );
  }

  return (
    <span className="relative inline-flex">
      <ActionMenu
        buttonClassName={buttonClassName({
          size: "compact",
          tone: "secondary",
        })}
        items={[
          {
            disabled: csvDisabled,
            icon: <Icon icon={Download04Icon} size={14} />,
            label: t(m.exportCsv),
            onSelect: downloadCsv,
          },
          {
            icon: <Icon icon={Copy01Icon} size={14} />,
            label: t(m.copyBoardMarkdown),
            onSelect: copyMarkdown,
          },
          {
            icon: <Icon icon={Link01Icon} size={14} />,
            label: t(m.copyViewLink),
            onSelect: copyViewLink,
          },
        ]}
        label={t(m.exportAndShare)}
        menuClassName="app-popover-card fixed z-[100] w-56 p-1"
        trigger={
          <>
            <Icon icon={Share08Icon} size={14} />
            {t(m.exportAndShare)}
            <Icon icon={ArrowDown01Icon} size={14} />
          </>
        }
      />
      <WorkItemCopyStatus
        copiedLabel={copiedLabel}
        failedLabel={t(csvFailed ? m.downloadFailed : m.copyFailed)}
        state={csvFailed ? "failed" : state}
      />
    </span>
  );
}
