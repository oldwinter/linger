import { TeamHubError } from "@/features/teamhub/teamhub-error";
import type { TeamHubBrowserConnectionStatus } from "@/features/teamhub/teamhub-types";
import type { Translate } from "@/i18n/language";

import { computersMessages } from "../computers.messages";

export const PLAYWRIGHT_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";

type BrowserConnectionTone = "success" | "warning" | "neutral";

export function browserConnectionStateCopy(
  state: TeamHubBrowserConnectionStatus["state"],
  t: Translate,
): { label: string; short: string; tone: BrowserConnectionTone } {
  switch (state) {
    case "connected":
      return {
        short: t(computersMessages.connected),
        label: t(computersMessages.browserConnectedLabel),
        tone: "success",
      };
    case "token_invalid":
      return {
        short: t(computersMessages.tokenExpired),
        label: t(computersMessages.tokenExpiredLabel),
        tone: "warning",
      };
    case "browser_unavailable":
      return {
        short: t(computersMessages.chromeUnavailable),
        label: t(computersMessages.chromeUnavailableLabel),
        tone: "warning",
      };
    case "extension_unavailable":
      return {
        short: t(computersMessages.extensionUnavailable),
        label: t(computersMessages.extensionNotFound),
        tone: "warning",
      };
    case "not_connected":
      return {
        short: t(computersMessages.notConnected),
        label: t(computersMessages.notConnectedLabel),
        tone: "warning",
      };
    case "isolated":
      return {
        short: t(computersMessages.notConnected),
        label: t(computersMessages.isolatedLabel),
        tone: "neutral",
      };
    case "unsupported":
      return {
        short: t(computersMessages.notSupported),
        label: t(computersMessages.unsupportedLabel),
        tone: "neutral",
      };
    default:
      // A newer Computer may report a state this Web build does not know.
      return {
        short: t(computersMessages.browserStatus),
        label: t(computersMessages.browserStatusUnknown),
        tone: "neutral",
      };
  }
}

export function browserConnectionErrorMessage(
  error: unknown,
  t: Translate,
): string {
  const code = error instanceof TeamHubError ? error.code : undefined;
  switch (code) {
    case "INVALID_BROWSER_TOKEN":
      return t(computersMessages.browserInvalidToken);
    case "LOCAL_COMPUTER_OFFLINE":
      return t(computersMessages.browserComputerOffline);
    case "LOCAL_COMPUTER_NOT_FOUND":
      return t(computersMessages.browserComputerNotFound);
    case "BROWSER_CONNECTION_UNSUPPORTED":
      return t(computersMessages.browserOutdated);
    case "BROWSER_CONNECTION_TIMEOUT":
      return t(computersMessages.browserTimeout);
    case "BROWSER_TOKEN_REJECTED":
      return t(computersMessages.browserTokenRejected);
    case "BROWSER_EXTENSION_UNAVAILABLE":
      return t(computersMessages.extensionNotFound);
    case "BROWSER_UNAVAILABLE":
      return t(computersMessages.chromeNotInstalled);
    case "BROWSER_BUSY":
      return t(computersMessages.browserBusy);
    case "BROWSER_CONNECTION_INVALID":
      return t(computersMessages.browserConnectionDamaged);
    case "BROWSER_CONNECTION_FAILED":
      return t(computersMessages.browserConnectFailed);
    default:
      return t(computersMessages.browserConnectUnavailable);
  }
}
