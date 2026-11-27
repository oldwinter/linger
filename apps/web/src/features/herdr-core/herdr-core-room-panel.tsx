import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useDesktopComputer } from "@/features/local-computer/desktop-computer";
import { localComputersQueryOptions } from "@/features/local-computer/local-computer-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { herdrCoreMessages as m } from "./herdr-core.messages";
import { HerdrCoreWorkbench } from "./herdr-core-workbench";

export interface HerdrCoreRoomPanelProps {
  readonly tenantId: string;
  readonly roomId: string;
  readonly hidden?: boolean;
}

/**
 * Lazy-loaded Room right-panel entry for the `herdr-core` Terminal Workbench.
 * Resolves the Tenant's Local Computers and prefers the desktop app's own
 * Computer or the first online Computer, scoping the default filter to `roomId`.
 */
export function HerdrCoreRoomPanel({
  tenantId,
  roomId,
  hidden = false,
}: HerdrCoreRoomPanelProps) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const desktop = useDesktopComputer();
  const [chosenComputerId, setChosenComputerId] = useState<string | null>(null);

  const computersQuery = useQuery({
    ...localComputersQueryOptions(client, tenantId),
    enabled: !hidden,
  });

  const computers = computersQuery.data?.items ?? [];
  const desktopComputerId = desktop?.status?.computerId;
  const preferredComputer =
    computers.find((c) => c.computer_id === chosenComputerId) ??
    computers.find(
      (c) => c.computer_id === desktopComputerId && c.status === "online",
    ) ??
    computers.find((c) => c.status === "online") ??
    computers[0];

  if (hidden) return null;

  if (!computersQuery.isLoading && !preferredComputer) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
        <p className="text-sm font-semibold text-foreground">
          {t(m.noComputersTitle)}
        </p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          {t(m.noComputersBody)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {computers.length > 1 ? (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-sidebar/40 px-3 py-1.5">
          <label
            className="text-[11px] font-medium text-muted-foreground"
            htmlFor="herdr-room-computer-picker"
          >
            {t(m.computerLabel)}
          </label>
          <select
            aria-label={t(m.selectComputer)}
            className="h-7 max-w-[200px] truncate rounded-md border border-border bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="herdr-room-computer-picker"
            onChange={(event) => setChosenComputerId(event.target.value)}
            value={preferredComputer?.computer_id ?? ""}
          >
            {computers.map((computer) => (
              <option key={computer.computer_id} value={computer.computer_id}>
                {computer.display_name}
                {computer.status === "offline"
                  ? ` (${t(m.machineOffline)})`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {preferredComputer ? (
        <HerdrCoreWorkbench
          computerId={preferredComputer.computer_id}
          isDesktopLocalComputer={
            Boolean(desktopComputerId) &&
            preferredComputer.computer_id === desktopComputerId
          }
          roomId={roomId}
        />
      ) : null}
    </div>
  );
}
