import { describe, expect, it } from "vitest";

import type { TeamHubExternalConnection } from "@/features/teamhub/teamhub-types";

import {
  accountIdentityText,
  activeExternalConnections,
  connectLinkOpen,
  establishedExternalConnections,
  externalConnectionUnconfirmed,
  usableConnectUrl,
} from "./connection-state";

const baseConnection = {
  auto_reminders: true,
  created_at: "2026-09-03T12:00:00.000Z",
  id: "connection",
  provider: "gmail",
  revision: 1,
  updated_at: "2026-09-03T12:00:00.000Z",
} satisfies Omit<TeamHubExternalConnection, "status">;

function connection(
  id: string,
  status: TeamHubExternalConnection["status"],
  statusErrorCode?: string,
): TeamHubExternalConnection {
  return { ...baseConnection, id, status, status_error_code: statusErrorCode };
}

describe("external connection state projection", () => {
  const connections = [
    connection("active", "active"),
    connection("pending", "pending"),
    connection("pending-error", "pending", "discord_guild_required"),
    connection("pending-retry", "pending", "provider_identity_unavailable"),
    connection("pending-duplicate", "pending", "duplicate_remote_principal"),
    connection("expired", "expired"),
    connection("failed", "failed"),
    connection("duplicate", "failed", "duplicate_remote_principal"),
    connection("disconnecting", "disconnecting"),
    connection("revoke-pending", "revoke_pending"),
    connection("revoked", "revoked"),
  ];

  it("treats only active authorization as connected and usable", () => {
    expect(
      activeExternalConnections(connections).map((item) => item.id),
    ).toEqual(["active"]);
  });

  it("lists only successfully connected accounts in the manage list", () => {
    expect(
      establishedExternalConnections(connections).map((item) => item.id),
    ).toEqual(["active", "disconnecting", "revoke-pending"]);
  });

  it("treats a pending connection with a check failure as unconfirmed, except a duplicate", () => {
    expect(
      connections.filter(externalConnectionUnconfirmed).map((item) => item.id),
    ).toEqual(["pending-error", "pending-retry"]);
  });
});

describe("Connect Link reuse", () => {
  const connectUrl = "https://connect.example.test/link";

  it("reuses a pending link only until it expires", () => {
    expect(
      usableConnectUrl({
        connect_url: connectUrl,
        connect_expires_at: "2999-01-01T00:00:00Z",
      }),
    ).toBe(connectUrl);
    expect(
      usableConnectUrl({
        connect_url: connectUrl,
        connect_expires_at: "2026-01-01T00:00:00Z",
      }),
    ).toBeUndefined();
    expect(usableConnectUrl({})).toBeUndefined();
    expect(usableConnectUrl(undefined)).toBeUndefined();
  });

  it("treats a pending attempt without an expiry as open", () => {
    expect(connectLinkOpen({})).toBe(true);
    expect(
      connectLinkOpen({ connect_expires_at: "2026-01-01T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("accountIdentityText", () => {
  it("shows an Outlook label as the sign-in name, not a mailbox", () => {
    expect(accountIdentityText("outlook", "me@example.net")).toBe(
      "Signed in as me@example.net",
    );
    expect(accountIdentityText("gmail", "me@example.com")).toBe(
      "me@example.com",
    );
    expect(accountIdentityText("outlook", "")).toBeUndefined();
    expect(accountIdentityText("outlook", undefined)).toBeUndefined();
  });
});
