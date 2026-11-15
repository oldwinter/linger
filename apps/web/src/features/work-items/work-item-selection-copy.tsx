import { Copy01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { workItemLinksMarkdown } from "./work-item-markdown";
import { useWorkItemClipboardCopy } from "./use-work-item-copy";

/**
 * Copies the selected cards' links in the order the board shows them. The
 * selection stays put, so a refused clipboard write can be retried without
 * picking the cards again.
 */
export function WorkItemSelectionCopyLinks({
  disabled,
  items,
  tenantId,
}: {
  disabled: boolean;
  /** The selected cards, in display order. */
  items: readonly TeamHubWorkItem[];
  tenantId: string;
}) {
  const { copy, state } = useWorkItemClipboardCopy();

  return (
    <>
      <Button
        disabled={disabled}
        onClick={() =>
          copy(
            workItemLinksMarkdown({
              items,
              origin: window.location.origin,
              tenantId,
            }),
          )
        }
        size="compact"
        tone="secondary"
      >
        <Icon icon={Copy01Icon} size={14} />
        Copy links
      </Button>
      {state === "copied" ? (
        <p className="text-app-muted" role="status">
          Copied
        </p>
      ) : null}
      {state === "failed" ? (
        <p className="text-app-danger" role="alert">
          Copy failed
        </p>
      ) : null}
    </>
  );
}
