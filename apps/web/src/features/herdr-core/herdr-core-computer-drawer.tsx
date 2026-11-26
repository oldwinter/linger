import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { useT } from "@/i18n/use-translation";

import { herdrCoreMessages as m } from "./herdr-core.messages";
import { HerdrCoreWorkbench } from "./herdr-core-workbench";

export interface HerdrCoreComputerDialogProps {
  readonly computerId: string;
  readonly computerName: string;
  readonly isDesktopLocalComputer: boolean;
  readonly onClose: () => void;
}

/**
 * Lazy-loaded modal workbench launched from Settings › Computers so opening
 * a Computer's details never loads herdr-core or xterm upfront.
 */
export function HerdrCoreComputerDialog({
  computerId,
  computerName,
  isDesktopLocalComputer,
  onClose,
}: HerdrCoreComputerDialogProps) {
  const t = useT();
  return (
    <ModalDialog
      description={computerName}
      footer={
        <Button data-voice-close onClick={onClose} tone="secondary">
          {t(m.closePanel)}
        </Button>
      }
      onClose={onClose}
      size="xl"
      title={t(m.workbenchTitle)}
    >
      <div className="h-[min(75vh,680px)] min-h-[360px] w-full">
        <HerdrCoreWorkbench
          computerId={computerId}
          isDesktopLocalComputer={isDesktopLocalComputer}
        />
      </div>
    </ModalDialog>
  );
}
