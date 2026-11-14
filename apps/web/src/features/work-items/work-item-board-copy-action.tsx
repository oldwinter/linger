import { Copy01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { WorkItemCopyStatus } from "./work-item-copy-status";
import { useWorkItemClipboardCopy } from "./use-work-item-link-copy";

/** Copies the board as shown, reporting the outcome beside the button. */
export function WorkItemBoardCopyAction({ markdown }: { markdown: string }) {
  const { copy, state } = useWorkItemClipboardCopy();

  return (
    <span className="relative inline-flex">
      <Button onClick={() => copy(markdown)} size="compact" tone="secondary">
        <Icon icon={Copy01Icon} size={14} />
        Copy as Markdown
      </Button>
      <WorkItemCopyStatus copiedMessage="Copied" state={state} />
    </span>
  );
}
