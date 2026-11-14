import { Copy01Icon, Download04Icon } from "@hugeicons/core-free-icons";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { buttonClassName } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { useWikiCopyMarkdown } from "./wiki-copy-markdown";
import { WikiCopyFeedback } from "./wiki-copy-feedback";

/**
 * The Wiki page's copy and download actions, gathered behind one header
 * control so the action row keeps its size beside Copy link and Send to Room.
 */
export function WikiPageActionsMenu({
  documentId,
  exportPending,
  onExport,
}: {
  documentId: string;
  exportPending: boolean;
  onExport: () => void;
}) {
  const copy = useWikiCopyMarkdown(documentId);
  const items: ActionMenuItem[] = [
    {
      disabled: copy.pending,
      icon: <Icon icon={Copy01Icon} size={14} />,
      label: "Copy as Markdown",
      onSelect: () => void copy.copy(),
    },
    {
      disabled: exportPending,
      icon: <Icon icon={Download04Icon} size={14} />,
      label: "Download",
      onSelect: onExport,
    },
  ];

  return (
    <>
      <WikiCopyFeedback state={copy.feedback.state} />
      <ActionMenu
        buttonClassName={buttonClassName({
          size: "compactIcon",
          tone: "ghost",
        })}
        items={items}
        label="More Wiki page actions"
        placement="bottom-end"
      />
    </>
  );
}
