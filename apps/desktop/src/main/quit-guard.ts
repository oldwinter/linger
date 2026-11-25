export interface QuitEvent {
  preventDefault(): void;
}

export interface QuitGuardOptions {
  readonly isBusy: () => boolean;
  readonly isAutomaticQuit: () => boolean;
  readonly confirmBusyQuit: () => Promise<boolean>;
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

  const requestQuit = async (): Promise<void> => {
    if (quitting || confirming) return;
    if (options.isBusy() && !options.isAutomaticQuit()) {
      confirming = true;
      let proceed: boolean;
      try {
        proceed = await options.confirmBusyQuit();
      } finally {
        confirming = false;
      }
      if (!proceed) return;
    }
    confirmed = true;
    options.requestAppQuit();
  };

  const handleBeforeQuit = (event: QuitEvent): void => {
    if (quitting) {
      event.preventDefault();
      return;
    }
    const automatic = options.isAutomaticQuit();
    if (!automatic && !confirmed && options.isBusy()) {
      event.preventDefault();
      void requestQuit();
      return;
    }
    quitting = true;
    event.preventDefault();
    options.prepareQuit();
    void options.stopHost(automatic ? "update" : "quit").finally(() => {
      options.relaunchIfNeeded();
      options.exitApp();
    });
  };

  return { requestQuit, handleBeforeQuit };
}
