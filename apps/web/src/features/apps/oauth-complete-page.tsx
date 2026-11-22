import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { connectorMessages as m } from "./connectors.messages";

export const OAUTH_COMPLETE_PATH = "/oauth/composio-complete";

// The window waits at most this long for TeamHub to take the completion.
const COMPLETE_WAIT_MS = 3000;

type CompletionPhase = "pending" | "complete" | "failed" | "timeout";

export function OAuthCompletePage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const [phase, setPhase] = useState<CompletionPhase>("pending");

  useEffect(() => {
    // TeamHub checks the account with Composio; returning here is never
    // evidence that authorization succeeded.
    const connectedAccountId =
      new URLSearchParams(window.location.search).get("connected_account_id") ??
      undefined;
    let active = true;
    const timer = setTimeout(() => {
      if (!active) return;
      active = false;
      setPhase("timeout");
    }, COMPLETE_WAIT_MS);

    void client
      .completeExternalConnectionAuthorization(connectedAccountId)
      .then(
        () => {
          if (!active) return;
          active = false;
          clearTimeout(timer);
          setPhase("complete");
        },
        () => {
          if (!active) return;
          active = false;
          clearTimeout(timer);
          setPhase("failed");
        },
      );

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client]);

  useEffect(() => {
    if (phase !== "pending") {
      window.close();
    }
  }, [phase]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="max-w-md">
        {phase === "pending" ? (
          <>
            <h1 className="flex items-center justify-center gap-2 text-lg">
              <Spinner size={16} />
              Finishing authorization…
            </h1>
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              Confirming your connection with Linger.
            </p>
          </>
        ) : phase === "complete" ? (
          <>
            <h1 className="text-lg">{t(m.authorizationComplete)}</h1>
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {t(m.canCloseWindow)}
            </p>
          </>
        ) : phase === "timeout" ? (
          <>
            <h1 className="text-lg">Still verifying authorization</h1>
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              Return to Linger to check your connection. You can close this
              window.
            </p>
          </>
        ) : (
          <div role="alert">
            <h1 className="text-lg text-app-danger">
              Authorization could not be confirmed
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Return to Linger and try connecting again. You can close this
              window.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
