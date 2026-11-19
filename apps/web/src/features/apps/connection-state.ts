import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubExternalConnection } from "@/features/teamhub/teamhub-types";

const NEEDS_ATTENTION = new Set<TeamHubExternalConnection["status"]>([
  "expired",
  "failed",
]);

export function externalConnectionNeedsAttention(
  connection: TeamHubExternalConnection,
) {
  return (
    NEEDS_ATTENTION.has(connection.status) &&
    connection.status_error_code !== "duplicate_remote_principal"
  );
}

/**
 * The pending connection of an app whose authorization can still be resumed,
 * so a new attempt reuses it instead of creating another row.
 */
export function openPendingExternalConnection(
  connections: TeamHubExternalConnection[],
  appKey: string,
) {
  return connections.find(
    (connection) =>
      connection.provider === appKey &&
      connection.status === "pending" &&
      !connection.status_error_code,
  );
}

export function establishedExternalConnections(
  connections: TeamHubExternalConnection[],
) {
  return connections.filter((connection) =>
    ["active", "disconnecting", "revoke_pending"].includes(connection.status),
  );
}

export function activeExternalConnections(
  connections: TeamHubExternalConnection[],
) {
  return connections.filter((connection) => connection.status === "active");
}

/**
 * Whether the Connect Link of a pending connection or reauthorization can
 * still be opened. An expired link needs a new authorization.
 */
export function connectLinkOpen(authorization: {
  connect_expires_at?: string;
}) {
  return (
    !authorization.connect_expires_at ||
    Date.parse(authorization.connect_expires_at) > Date.now()
  );
}

/** The Connect Link of a pending authorization while it can still be opened. */
export function usableConnectUrl(authorization?: {
  connect_url?: string;
  connect_expires_at?: string;
}) {
  return authorization?.connect_url && connectLinkOpen(authorization)
    ? authorization.connect_url
    : undefined;
}

/**
 * The Connect Link that reauthorizes a connection: the open link of one in
 * progress, otherwise a new reauthorization's.
 */
export async function startReauthorization(
  client: Pick<TeamHubClient, "createExternalConnectionReauthorization">,
  connection: TeamHubExternalConnection,
) {
  return (
    reauthorizationConnectUrl(connection) ??
    reauthorizationConnectUrl(
      await client.createExternalConnectionReauthorization(
        connection.id,
        connection.revision,
      ),
    )
  );
}

/** The open Connect Link of a reauthorization in progress, if any. */
export function reauthorizationConnectUrl(connection?: {
  reauthorizing?: boolean;
  reauthorization_connect_url?: string;
  reauthorization_connect_expires_at?: string;
}) {
  if (!connection?.reauthorizing) return undefined;
  return usableConnectUrl({
    connect_url: connection.reauthorization_connect_url,
    connect_expires_at: connection.reauthorization_connect_expires_at,
  });
}

/**
 * A connection's identity label as display text, or undefined when it has
 * none. An Outlook label is the Microsoft account's sign-in name, which can
 * belong to another mail provider, so it is never shown as the mailbox.
 */
export function accountIdentityText(
  provider: string,
  label: string | null | undefined,
): string | undefined {
  if (!label) return undefined;
  return provider === "outlook" ? `Signed in as ${label}` : label;
}
