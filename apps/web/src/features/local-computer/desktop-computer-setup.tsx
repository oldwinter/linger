import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import { computerSetupMessages } from "./computer-setup.messages";
import type {
  DesktopComputer,
  DesktopComputerStatus,
} from "./desktop-computer";

// The desktop app connects its own computer and finds Codex and Claude Code
// by itself, so it never asks the user to run setup commands.
export function DesktopComputerSetup({
  desktop,
}: {
  desktop: DesktopComputer;
}) {
  const t = useT();
  if (!desktop.status) return null;
  if (!desktop.status.computerId) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-app-muted">
          {t(computerSetupMessages.desktopConnectIntro)}
        </p>
        <Button
          tone="primary"
          disabled={desktop.connecting}
          onClick={desktop.connect}
        >
          {t(
            desktop.connecting
              ? computerSetupMessages.connecting
              : computerSetupMessages.connectThisComputer,
          )}
        </Button>
        {desktop.error ? (
          <p role="alert" className="text-xs text-app-danger">
            {desktop.error}
          </p>
        ) : null}
      </div>
    );
  }
  // The search only ends once the computer comes online, so a state it cannot
  // leave by itself is shown instead of a spinner that never stops.
  const problem = desktopSetupProblem(desktop.status);
  if (problem) {
    return (
      <p role="alert" className="text-xs text-app-danger">
        {t(problem)}
      </p>
    );
  }
  return (
    <p
      className="flex items-center gap-1.5 text-xs text-app-muted"
      role="status"
    >
      <Spinner size={13} />
      {t(computerSetupMessages.lookingForApps)}
    </p>
  );
}

// Same states as the desktop tray summary (apps/desktop/src/main/status.ts).
function desktopSetupProblem(
  status: DesktopComputerStatus,
): Message<string> | undefined {
  switch (status.bridge) {
    case "auth_failed":
      return computerSetupMessages.desktopAuthFailed;
    case "identity_conflict":
      return computerSetupMessages.desktopIdentityConflict;
    case "upgrade_required":
      return computerSetupMessages.desktopUpgradeRequired;
    case "disconnected":
      return computerSetupMessages.desktopDisconnected;
  }
  if (status.runtime === "crashed")
    return computerSetupMessages.desktopRuntimeCrashed;
  return undefined;
}
