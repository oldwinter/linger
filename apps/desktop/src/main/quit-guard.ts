export interface QuitEvent {
  preventDefault(): void;
}

export interface QuitGuardOptions {
  readonly isBusy: () => boolean;
  readonly isAutomaticQuit: () => boolean;
  readonly confirmBusyQuit: () => Promise<boolean>;
  readonly stopTasksBeforeQuit?: () => Promise<void>;
  readonly prepareQuit: () => void;
  readonly stopHost: (reason: "quit" | "update") => Promise<void>;
  readonly requestAppQuit: () => void;
  readonly relaunchIfNeeded: () => void;
  readonly exitApp: () => void;
}

export interface QuitGuard {
  requestQuit(): Promise<void>;
  handleBeforeQuit(event: QuitEvent): void;
}

/**
 * Coordinates every quit entry point (Tray Quit, Cmd+Q, Dock/App menu Quit,
 * updater restarts, and installer `--quit`) through one confirmation and
 * shutdown sequence.
 */
export function createQuitGuard(options: QuitGuardOptions): QuitGuard {
  let quitting = false;
  let confirming = false;
  let confirmed = false;
  let stopTasksOnQuit = false;

  const requestQuit = async (): Promise<void> => {
    if (quitting || confirming) return;
    let shouldStopTasks = false;
    if (options.isBusy() && !options.isAutomaticQuit()) {
      confirming = true;
      let proceed: boolean;
      try {
        proceed = await options.confirmBusyQuit();
      } catch {
        return;
      } finally {
        confirming = false;
      }
      if (!proceed || quitting) return;
      shouldStopTasks = true;
    }
    confirmed = true;
    stopTasksOnQuit = shouldStopTasks;
    options.requestAppQuit();
  };

  const handleBeforeQuit = (event: QuitEvent): void => {
    if (quitting) {
      event.preventDefault();
      return;
    }
    const automatic = options.isAutomaticQuit();
    if (!automatic && confirming) {
      event.preventDefault();
      return;
    }
    if (!automatic && !confirmed && options.isBusy()) {
      event.preventDefault();
      void requestQuit();
      return;
    }
    const shouldStopTasks = !automatic && stopTasksOnQuit;
    quitting = true;
    confirmed = false;
    stopTasksOnQuit = false;
    event.preventDefault();
    options.prepareQuit();
    const shutdown =
      shouldStopTasks && options.stopTasksBeforeQuit
        ? Promise.resolve()
            .then(() => options.stopTasksBeforeQuit!())
            .catch(() => {})
            .then(() => options.stopHost("quit"))
        : options.stopHost(automatic ? "update" : "quit");
    void shutdown.finally(() => {
      options.relaunchIfNeeded();
      options.exitApp();
    });
  };

  return { requestQuit, handleBeforeQuit };
}
