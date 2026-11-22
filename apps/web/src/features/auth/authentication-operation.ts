import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { translate } from "@/i18n/language";

import { authMessages as m } from "./auth.messages";

// The race also bounds adapters that ignore AbortSignal (including response-body reads).
export async function authenticationOperation<T>(
  signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(
    () =>
      controller.abort(
        new TeamHubError({
          code: "AUTHENTICATION_TIMEOUT",
          message: translate(m.timedOut),
          status: 408,
        }),
      ),
    10_000,
  );
  let rejectAbort!: () => void;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
      }),
      run(controller.signal),
    ]);
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
