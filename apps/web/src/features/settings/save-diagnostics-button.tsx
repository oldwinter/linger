import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/use-translation";

import { settingsMessages } from "./settings.messages";

// The desktop app's Save Diagnostics… (`window.lingerDesktop.diagnostics`);
// absent in a browser, which cannot read the app's logs, and in desktop
// builds that predate it.
interface DesktopDiagnostics {
  save(): Promise<void>;
}

function desktopDiagnostics(): DesktopDiagnostics | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as { lingerDesktop?: { diagnostics?: DesktopDiagnostics } })
        .lingerDesktop?.diagnostics;
}

/**
 * Runs the tray's Save Diagnostics… from Settings. The desktop app writes the
 * zip and shows it in its folder; the page only reports a failure.
 */
export function SaveDiagnosticsButton() {
  const t = useT();
  const [api] = useState(desktopDiagnostics);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (typeof api?.save !== "function") return null;

  const save = () => {
    setFailed(false);
    setSaving(true);
    api
      .save()
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-3 flex flex-col items-start gap-1">
      <Button loading={saving} onClick={save} size="compact" tone="ghost">
        {t(settingsMessages.saveDiagnostics)}
      </Button>
      {failed ? (
        <p className="px-2.5 text-xs text-app-danger" role="alert">
          {t(settingsMessages.saveDiagnosticsFailed)}
        </p>
      ) : null}
    </div>
  );
}
