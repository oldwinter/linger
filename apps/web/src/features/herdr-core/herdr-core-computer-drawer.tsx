import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import type { TeamHubApi } from "@/features/teamhub/teamhub-api";
import { useT } from "@/i18n/use-translation";

import type { HerdrCoreClient } from "./api";
import { herdrCoreMessages as m } from "./herdr-core.messages";
import { HerdrCoreWorkbench } from "./herdr-core-workbench";

export interface HerdrCoreComputerDialogProps {
  readonly computerId: string;
  readonly computerName: string;
  readonly isDesktopLocalComputer: boolean;
  readonly initialAddress?: string;
  readonly client?: HerdrCoreClient;
  readonly teamHubApi?: TeamHubApi;
  readonly onClose: () => void;
}

/**
 * Lazy-loaded modal workbench launched from Settings › Computers and
 * Settings › System so opening those pages never loads herdr-core workbench
 * or xterm upfront.
 */
export function HerdrCoreComputerDialog({
  computerId,
  computerName,
  isDesktopLocalComputer,
  initialAddress,
  client,
  teamHubApi,
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
      <div className="h-[min(78vh,700px)] min-h-[380px] w-full">
        <HerdrCoreWorkbench
          client={client}
          computerId={computerId}
          embedded
          initialAddress={initialAddress}
          isDesktopLocalComputer={isDesktopLocalComputer}
          teamHubApi={teamHubApi}
        />
      </div>
    </ModalDialog>
  );
}
