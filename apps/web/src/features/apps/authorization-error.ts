import { type Translate, translate } from "@/i18n/language";

import { connectorMessages as m } from "./connectors.messages";

/**
 * The English of `connectorMessages.insufficientPermission`, for comparing
 * with. Show the message itself, so it follows the language on screen.
 */
export const INSUFFICIENT_PERMISSION_MESSAGE = m.insufficientPermission.source;

export function connectionStatusErrorMessage(
  statusErrorCode: string | null | undefined,
  t: Translate = translate,
): string | undefined {
  switch (statusErrorCode) {
    case "discord_guild_required":
      return t(m.discordUnconfirmedFromApps);
    case "duplicate_remote_principal":
      return t(m.accountAlreadyConnected);
    case "provider_auth_failed":
      return t(m.insufficientPermission);
    default:
      return undefined;
  }
}

export function connectionAuthorizationError(
  connection: {
    status: string;
    status_error_code?: string | null;
  },
  t: Translate = translate,
): string | undefined {
  return (
    connectionStatusErrorMessage(connection.status_error_code, t) ??
    (connection.status === "failed" || connection.status === "expired"
      ? t(m.authorizationFailed)
      : undefined)
  );
}
