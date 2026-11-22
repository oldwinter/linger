import type { TeamHubLocalRuntimeType } from "@/features/teamhub/teamhub-types";
import { RichMessage, useT } from "@/i18n/use-translation";

import type { ComputerPlatform } from "./computer-platform";
import { appNames } from "./computer-readiness";
import { computerSetupMessages } from "./computer-setup.messages";
import { installCommand } from "./local-runtime-commands";

export function LocalRuntimeInstallGuidance({
  runtimeTypes,
  platform,
  computerName,
}: {
  runtimeTypes: readonly TeamHubLocalRuntimeType[];
  platform?: ComputerPlatform;
  computerName: string;
}) {
  const t = useT();
  if (runtimeTypes.length === 0) return null;
  return (
    <div className="text-xs text-muted-foreground">
      <p>
        {t(
          platform === "win32"
            ? computerSetupMessages.installRuntimePowerShell
            : computerSetupMessages.installRuntime,
          { computer: computerName },
        )}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {runtimeTypes.map((runtimeType) => (
          <li key={runtimeType}>
            <RichMessage
              message={computerSetupMessages.runtimeCommand}
              tags={{
                code: (text) => (
                  <code className="select-all font-mono text-foreground">
                    {text}
                  </code>
                ),
              }}
              values={{
                app: appNames[runtimeType],
                command: installCommand(runtimeType, platform),
              }}
            />
          </li>
        ))}
      </ul>
      {runtimeTypes.some((runtimeType) => runtimeType !== "claude") ? (
        <p className="mt-2">{t(computerSetupMessages.npmNeedsNode)}</p>
      ) : null}
    </div>
  );
}
