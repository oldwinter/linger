import type { TeamHubLocalRuntimeType } from "@/features/teamhub/teamhub-types";
import { RichMessage, useT } from "@/i18n/use-translation";

import { appNames } from "./computer-readiness";
import { computerSetupMessages } from "./computer-setup.messages";
import { loginCommands } from "./local-runtime-commands";

export function LocalRuntimeAuthenticationGuidance({
  runtimeType,
  computerName,
}: {
  runtimeType: TeamHubLocalRuntimeType;
  computerName: string;
}) {
  const t = useT();
  const app = appNames[runtimeType];
  return (
    <>
      <p className="font-medium">
        {t(computerSetupMessages.signInRequired, { app })}
      </p>
      <p className="mt-1 text-muted-foreground">
        <RichMessage
          message={computerSetupMessages.signInGuidance}
          tags={{ code: (text) => <code className="font-mono">{text}</code> }}
          values={{
            app,
            command: loginCommands[runtimeType],
            computer: computerName,
          }}
        />
      </p>
      {runtimeType === "pi" && (
        <p className="mt-1 text-muted-foreground">
          {t(computerSetupMessages.piSignIn)}
        </p>
      )}
      {runtimeType === "antigravity" && (
        <p className="mt-1 text-muted-foreground">
          {t(computerSetupMessages.antigravitySignIn)}
        </p>
      )}
    </>
  );
}
