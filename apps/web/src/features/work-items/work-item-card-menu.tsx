import {
  Copy01Icon,
  CopyPlusIcon,
  Note01Icon,
} from "@hugeicons/core-free-icons";

import { ActionMenu } from "@/components/ui/action-menu";
import { Icon } from "@/components/ui/icon";
import type { TeamHubWorkItem } from "@/features/teamhub/teamhub-types";

import { WorkItemCopyStatus } from "./work-item-copy-status";
import { useWorkItemCopy } from "./use-work-item-copy";

/** The board card's actions, kept out of the card link so a click here never opens the Item. */
export function WorkItemCardMenu({
  item,
  onDuplicate,
  tenantId,
}: {
  item: TeamHubWorkItem;
  onDuplicate: (item: TeamHubWorkItem) => void;
  tenantId: string;
}) {
  const { copiedLabel, copyLink, copyMarkdown, state } = useWorkItemCopy(
    tenantId,
    item,
  );

  return (
    <span className="relative inline-flex">
      <ActionMenu
        buttonClassName="flex size-6 items-center justify-center rounded-md text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
        items={[
          {
            icon: <Icon icon={Copy01Icon} size={14} />,
            label: "Copy link",
            onSelect: copyLink,
          },
          {
            icon: <Icon icon={Note01Icon} size={14} />,
            label: "Copy as Markdown",
            onSelect: copyMarkdown,
          },
          {
            icon: <Icon icon={CopyPlusIcon} size={14} />,
            label: "Duplicate",
            onSelect: () => onDuplicate(item),
          },
        ]}
        label={`Actions for ${item.title}`}
        menuClassName="app-popover-card fixed z-[100] w-44 p-1"
      />
      <WorkItemCopyStatus copiedLabel={copiedLabel} state={state} />
    </span>
  );
}
