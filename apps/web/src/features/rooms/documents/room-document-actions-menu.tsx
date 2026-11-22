import {
  Clock04Icon,
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
  FolderTransferIcon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icon";
import { ActionMenu } from "@/components/ui/action-menu";
import { libraryMessages } from "@/features/library/library.messages";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { documentPageMessages as m } from "./document-page.messages";

export interface RoomDocumentMenuActions {
  busy?: boolean;
  canDelete?: boolean;
  canDuplicate?: boolean;
  canExport?: boolean;
  canUseVersion: boolean;
  onCopyLink: () => void;
  onRename?: () => void;
  canRename?: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onShowHistory?: () => void;
  onCopyToMyDocuments?: () => void;
}

export function DocumentActionsMenu({
  actions,
  contextOnly = false,
  label,
  buttonClassName = "flex size-8 shrink-0 items-center justify-center rounded-sm text-app-muted hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus",
}: {
  actions: RoomDocumentMenuActions;
  contextOnly?: boolean;
  label?: string;
  buttonClassName?: string;
}) {
  const t = useT();
  const canExport = actions.canExport ?? actions.canUseVersion;
  const canDuplicate = actions.canDuplicate ?? actions.canUseVersion;
  const canDelete = actions.canDelete ?? true;

  return (
    <ActionMenu
      buttonClassName={buttonClassName}
      items={[
        ...(!contextOnly
          ? [
              {
                disabled: actions.busy,
                icon: <Icon icon={Copy01Icon} size={14} />,
                label: t(libraryMessages.copyLink),
                onSelect: actions.onCopyLink,
              },
              ...(actions.onRename
                ? [
                    {
                      disabled: actions.busy || !actions.canRename,
                      icon: <Icon icon={PencilEdit01Icon} size={14} />,
                      label: t(libraryMessages.rename),
                      onSelect: actions.onRename,
                    },
                  ]
                : []),
              {
                disabled: actions.busy || !canExport,
                icon: <Icon icon={Download04Icon} size={14} />,
                label: t(libraryMessages.download),
                onSelect: actions.onExport,
              },
              {
                disabled: actions.busy || !canDuplicate,
                icon: <Icon icon={Copy01Icon} size={14} />,
                label: t(libraryMessages.duplicate),
                onSelect: actions.onDuplicate,
              },
            ]
          : []),
        ...(actions.onShowHistory
          ? [
              {
                disabled: actions.busy,
                icon: <Icon icon={Clock04Icon} size={14} />,
                label: t(m.pageHistory),
                onSelect: actions.onShowHistory,
              },
            ]
          : []),
        ...(actions.onCopyToMyDocuments
          ? [
              {
                disabled: actions.busy || !canDuplicate,
                icon: <Icon icon={FolderTransferIcon} size={14} />,
                label: t(libraryMessages.copyToMyDocuments),
                onSelect: actions.onCopyToMyDocuments,
              },
            ]
          : []),
        ...(!contextOnly
          ? [
              {
                danger: true,
                disabled: actions.busy || !canDelete,
                icon: <Icon icon={Delete02Icon} size={14} />,
                label: t(commonMessages.delete),
                onSelect: actions.onDelete,
                separatorBefore: true,
                voiceRisk: "never" as const,
              },
            ]
          : []),
      ]}
      label={label ?? t(m.moreActions)}
      trigger={
        actions.busy ? (
          <Spinner size={16} />
        ) : (
          <Icon icon={MoreHorizontalIcon} />
        )
      }
    />
  );
}
