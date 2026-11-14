import { Download04Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { triggerArtifactDownload } from "@/features/rooms/files/artifact-preview-loader";

import { workItemBoardCsvFilename } from "./work-item-board-csv";
import { WorkItemCopyStatus } from "./work-item-copy-status";

/**
 * Saves the board as a CSV file. The file is built from what the board already
 * loaded, so this writes nothing and requests nothing; a refused save says so
 * beside the control instead of looking like a download.
 */
export function WorkItemBoardCsvAction({
  csv,
  disabled,
}: {
  csv: string;
  disabled: boolean;
}) {
  const [failed, setFailed] = useState(false);
  function download() {
    setFailed(false);
    try {
      triggerArtifactDownload(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        workItemBoardCsvFilename(),
      );
    } catch {
      setFailed(true);
    }
  }
  return (
    <span className="relative inline-flex">
      <Button
        disabled={disabled}
        onClick={download}
        size="compact"
        tone="secondary"
      >
        <Icon icon={Download04Icon} size={14} />
        Export CSV
      </Button>
      <WorkItemCopyStatus
        failedLabel="Download failed"
        state={failed ? "failed" : "idle"}
      />
    </span>
  );
}
