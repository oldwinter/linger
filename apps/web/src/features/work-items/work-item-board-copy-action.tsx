import { Copy01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { WorkItemCopyStatus } from "./work-item-copy-status";
import { useWorkItemClipboardCopy } from "./use-work-item-copy";

/** Copies the board as shown, reporting the outcome beside the button. */
export function WorkItemBoardCopyAction({ markdown }: { markdown: string }) {
  const { copy, copiedLabel, state } = useWorkItemClipboardCopy();

  return (
    <span className="relative inline-flex">
      <Button onClick={() => copy(markdown)} size="compact" tone="secondary">
        <Icon icon={Copy01Icon} size={14} />
        Copy board as Markdown
      </Button>
      <WorkItemCopyStatus copiedLabel={copiedLabel} state={state} />
    </span>
  );
}
