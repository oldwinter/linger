import {
  FileAddIcon,
  FileImportIcon,
  FolderAddIcon,
  FolderUploadIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { type RefObject, useRef } from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { buttonClassName } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";

import { libraryMessages as m } from "./library.messages";

/** The Library heading with the New menu and its hidden file pickers. */
export function LibraryDocumentsHeader({
  createBusy,
  importRef,
  onCreateDocument,
  onImport,
  onImportPick,
  onNewFolder,
  onUploadFolder,
}: {
  createBusy: boolean;
  importRef: RefObject<HTMLInputElement | null>;
  onCreateDocument: () => void;
  onImport: (file: File) => void;
  onImportPick: () => void;
  onNewFolder: () => void;
  onUploadFolder: (files: File[]) => void;
}) {
  const t = useT();
  const folderInputRef = useRef<HTMLInputElement>(null);
  return (
    <header className="workspace-files-heading">
      <h1>{t(m.title)}</h1>
      <div className="ml-auto flex items-center gap-1">
        <input
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onImport(file);
          }}
          ref={importRef}
          type="file"
        />
        <input
          data-testid="library-folder-upload-input"
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length > 0) onUploadFolder(files);
          }}
          ref={(input) => {
            folderInputRef.current = input;
            // React does not type the non-standard directory picker attribute.
            input?.setAttribute("webkitdirectory", "");
          }}
          type="file"
        />
        <ActionMenu
          buttonClassName={buttonClassName({ size: "large", tone: "primary" })}
          items={[
            {
              disabled: createBusy,
              icon: <Icon icon={FileAddIcon} size={14} />,
              label: t(m.newFile),
              onSelect: onCreateDocument,
            },
            {
              disabled: createBusy,
              icon: <Icon icon={FolderAddIcon} size={14} />,
              label: t(m.newFolder),
              onSelect: onNewFolder,
            },
            {
              disabled: createBusy,
              icon: <Icon icon={FileImportIcon} size={14} />,
              label: t(m.importFile),
              onSelect: onImportPick,
            },
            {
              disabled: createBusy,
              icon: <Icon icon={FolderUploadIcon} size={14} />,
              label: t(m.uploadFolder),
              onSelect: () => folderInputRef.current?.click(),
            },
          ]}
          label={t(m.createInMyPages)}
          placement="bottom-end"
          trigger={
            <>
              <Icon icon={PlusSignIcon} size={16} />
              {t(m.newMenu)}
            </>
          }
        />
      </div>
    </header>
  );
}
