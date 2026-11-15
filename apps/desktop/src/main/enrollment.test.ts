import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CredentialStore } from "./computer-credential.js";
import { daemonIdentityPath } from "./daemon-identity.js";
import {
  EnrollmentError,
  EnrollmentModule,
  enrollComputer,
  IDENTITY_CONFLICT_MESSAGE,
} from "./enrollment.js";
import { EventBus } from "./modules.js";
import { stubModule, tempDirectory, testHost } from "./test-support.js";

const claims = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `sr1.${claims({
  runner_id: "computer_1",
  tenant_owners: [{ tenant_id: "tenant_acme", owner_actor_id: "actor_ann" }],
})}.${"s".repeat(43)}`;

interface Call {
  readonly url: string;
  readonly method: string;
  readonly cookie: string | undefined;
  readonly body: Record<string, unknown> | undefined;
}

const fakeServer = (
  overrides: {
    exchangeStatus?: number;
    bundle?: Record<string, unknown>;
    // The create answer for a renewal, which TeamHub refuses for a Computer
    // it does not know.
    renewal?: { status: number; body: unknown };
  } = {},
): { fetch: typeof fetch; calls: Call[] } => {
  const calls: Call[] = [];
  let challenge = "";
  const fetchImpl = (async (input: URL, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const body = init.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({
      url: input.pathname,
      method: init.method ?? "GET",
      cookie: headers.cookie,
      body,
    });
    const json = (value: unknown, status = 200): Response =>
      new Response(JSON.stringify(value), { status });
    if (input.pathname === "/v0/me")
      return json({ actors: [{ kind: "human", tenant_id: "tenant_acme" }] });
    if (input.pathname.endsWith("/local-computer-enrollments")) {
      if (overrides.renewal && body?.computer_id)
        return json(overrides.renewal.body, overrides.renewal.status);
      challenge = String(body?.code_challenge);
      return json({
        enrollment_id: "enr_1",
        computer_id: "computer_1",
        authorization_code: "code_1",
        expires_at: "2026-10-16T08:00:00Z",
      });
    }
    if (overrides.exchangeStatus) return json({}, overrides.exchangeStatus);
    const verifier = String(body?.code_verifier);
    if (createHash("sha256").update(verifier).digest("base64url") !== challenge)
      return json({}, 400);
    return json(
      overrides.bundle ?? {
        computer_id: "computer_1",
        tenant_id: "tenant_acme",
        gateway_url: "wss://linger.example.com/v1/runner",
        gateway_token: TOKEN,
        credential_expires_at: "2026-11-16T08:00:00Z",
      },
    );
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
};

const input = {
  serverUrl: "https://linger.example.com",
  cookie: "teamhub_session=abc",
  displayName: "Laptop",
};

describe("enrollComputer", () => {
  it("creates with the session cookie and exchanges as the computer", async () => {
    const server = fakeServer();
    const enrolled = await enrollComputer({ ...input, fetch: server.fetch });
    expect(enrolled).toEqual({
      computerId: "computer_1",
      tenantId: "tenant_acme",
      ownerActorId: "actor_ann",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      credential: TOKEN,
    });
    expect(server.calls.map((c) => [c.method, c.url, !!c.cookie])).toEqual([
      ["GET", "/v0/me", true],
      ["POST", "/v0/tenants/tenant_acme/local-computer-enrollments", true],
      ["POST", "/v0/local-computer-enrollments/enr_1/exchange", false],
    ]);
    expect(server.calls[1]?.body).not.toHaveProperty("computer_id");
  });

  it("keeps the Computer identity when enrolling again", async () => {
    const server = fakeServer();
    await enrollComputer({
      ...input,
      computerId: "computer_1",
      fetch: server.fetch,
    });
    expect(server.calls[1]?.body?.computer_id).toBe("computer_1");
  });

  it("rejects a bundle for another Computer", async () => {
    const server = fakeServer({
      bundle: {
        computer_id: "computer_2",
        tenant_id: "tenant_acme",
        gateway_url: "wss://linger.example.com/v1/runner",
        gateway_token: TOKEN,
        credential_expires_at: "2026-11-16T08:00:00Z",
      },
    });
    await expect(
      enrollComputer({ ...input, fetch: server.fetch }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a credential scoped to another tenant", async () => {
    const server = fakeServer({
      bundle: {
        computer_id: "computer_1",
        tenant_id: "tenant_acme",
        gateway_url: "wss://linger.example.com/v1/runner",
        gateway_token: `sr1.${claims({
          runner_id: "computer_1",
          tenant_owners: [
            { tenant_id: "tenant_other", owner_actor_id: "actor_ann" },
          ],
        })}.${"s".repeat(43)}`,
        credential_expires_at: "2026-11-16T08:00:00Z",
      },
    });
    await expect(
      enrollComputer({ ...input, fetch: server.fetch }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("reports a removed enrollment", async () => {
    const failure = await enrollComputer({
      ...input,
      fetch: fakeServer({ exchangeStatus: 410 }).fetch,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EnrollmentError);
    expect(failure).toMatchObject({ code: "ENROLLMENT_REMOVED" });
  });

  it("rejects a bundle without a WebSocket gateway", async () => {
    const server = fakeServer({
      bundle: {
        computer_id: "computer_1",
        tenant_id: "tenant_acme",
        gateway_url: "https://linger.example.com/v1/runner",
        gateway_token: TOKEN,
        credential_expires_at: "2026-11-16T08:00:00Z",
      },
    });
    await expect(
      enrollComputer({ ...input, fetch: server.fetch }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("enrolls a new Computer once when the server no longer knows the renewal", async () => {
    const server = fakeServer({
      renewal: {
        status: 404,
        body: { error: { code: "INVALID_ENROLLMENT", message: "invalid" } },
      },
    });
    const enrolled = await enrollComputer({
      ...input,
      computerId: "computer_gone",
      fetch: server.fetch,
    });
    expect(enrolled.computerId).toBe("computer_1");
    const creates = server.calls.filter((c) =>
      c.url.endsWith("/local-computer-enrollments"),
    );
    expect(creates).toHaveLength(2);
    expect(creates[0]?.body?.computer_id).toBe("computer_gone");
    expect(creates[1]?.body).not.toHaveProperty("computer_id");
  });

  it("does not retry a 404 for another reason", async () => {
    const server = fakeServer({
      renewal: { status: 404, body: { error: { code: "NOT_FOUND" } } },
    });
    await expect(
      enrollComputer({
        ...input,
        computerId: "computer_1",
        fetch: server.fetch,
      }),
    ).rejects.toMatchObject({ code: "REJECTED" });
    expect(
      server.calls.filter((call) =>
        call.url.endsWith("/local-computer-enrollments"),
      ),
    ).toHaveLength(1);
  });
});

const enrollmentModule = (
  defaults: Parameters<typeof testHost>[1],
  fetcher?: typeof fetch,
) => {
  const directory = tempDirectory();
  const credentials = new CredentialStore(`${directory}/credential.json`);
  const identityFile = daemonIdentityPath(directory);
  const bus = new EventBus();
  const module = new EnrollmentModule({
    sessionCookie: async () => "teamhub_session=abc",
    defaultDisplayName: "Laptop",
    credentials,
    daemonIdentityFile: identityFile,
    ...(fetcher ? { fetch: fetcher } : {}),
  });
  const host = testHost([stubModule("Config"), module], defaults, bus);
  // What the Go daemon writes before it first connects.
  const writeIdentity = (): void => {
    mkdirSync(path.dirname(identityFile), { recursive: true });
    writeFileSync(identityFile, '{"public_key":"","private_key":""}\n');
  };
  return { host, module, credentials, bus, identityFile, writeIdentity };
};

describe("EnrollmentModule", () => {
  const enrolled = {
    serverUrl: "https://linger.example.com",
    computerId: "computer_1",
    tenantId: "tenant_acme",
    ownerActorId: "actor_ann",
  };

  it("keeps the Computer for renewal when the local server is reset", async () => {
    const server = fakeServer();
    const f = enrollmentModule(enrolled, server.fetch);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    await f.host.start();
    await f.module.resetLocalServer();
    expect(f.credentials.read()).toBeUndefined();
    expect(f.host.ctx.config.get()).toMatchObject({
      computerId: undefined,
      tenantId: undefined,
      ownerActorId: undefined,
      renewalEnrollment: {
        computerId: "computer_1",
        origin: "https://linger.example.com",
      },
    });
    // The next setup enrolls the same Computer and drops the reference.
    await f.module.enroll();
    const creates = server.calls.filter((call) =>
      call.url.endsWith("/local-computer-enrollments"),
    );
    expect(creates[0]?.body?.computer_id).toBe("computer_1");
    expect(f.host.ctx.config.get().renewalEnrollment).toBeUndefined();
    expect(f.host.ctx.config.get().computerId).toBe("computer_1");
  });

  it("keeps the Daemon Identity the renewed Computer already uses", async () => {
    const server = fakeServer();
    const f = enrollmentModule(enrolled, server.fetch);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();
    await f.module.resetLocalServer();

    await f.module.enroll();

    expect(f.host.ctx.config.get().computerId).toBe("computer_1");
    expect(existsSync(f.identityFile)).toBe(true);
  });

  it("gives up the Daemon Identity when TeamHub no longer knows its Computer", async () => {
    // The server refuses the renewal as it would for a Computer removed from
    // another installation, so this setup enrolls a new Computer.
    const server = fakeServer({
      renewal: {
        status: 404,
        body: { error: { code: "INVALID_ENROLLMENT", message: "invalid" } },
      },
    });
    const f = enrollmentModule(
      { ...enrolled, computerId: "computer_old" },
      server.fetch,
    );
    f.credentials.write({
      computerId: "computer_old",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();
    await f.module.resetLocalServer();

    await f.module.enroll();

    // The Daemon Identity stays with the Computer it belongs to; the daemon
    // makes one for the Computer now enrolled.
    expect(f.host.ctx.config.get().computerId).toBe("computer_1");
    expect(existsSync(f.identityFile)).toBe(false);
  });

  it("gives up the Daemon Identity a new local server cannot renew", async () => {
    const server = fakeServer();
    const f = enrollmentModule(
      {
        ...enrolled,
        computerId: undefined,
        renewalEnrollment: {
          computerId: "computer_old",
          origin: "https://old.example.com",
        },
      },
      server.fetch,
    );
    f.writeIdentity();
    await f.host.start();

    await f.module.enroll();

    const creates = server.calls.filter((call) =>
      call.url.endsWith("/local-computer-enrollments"),
    );
    expect(creates[0]?.body).not.toHaveProperty("computer_id");
    expect(existsSync(f.identityFile)).toBe(false);
  });

  it("keeps the Daemon Identity when the enrollment fails", async () => {
    const server = fakeServer({
      renewal: { status: 404, body: { error: { code: "NOT_FOUND" } } },
    });
    const f = enrollmentModule(
      { ...enrolled, computerId: "computer_old" },
      server.fetch,
    );
    f.credentials.write({
      computerId: "computer_old",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();
    await f.module.resetLocalServer();

    await expect(f.module.enroll()).rejects.toMatchObject({
      code: "REJECTED",
    });
    expect(existsSync(f.identityFile)).toBe(true);
  });

  it("gives up the Daemon Identity the Gateway refused as another Computer's", async () => {
    const f = enrollmentModule(enrolled);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();
    f.bus.emit("computer.identity_conflict", true);

    await f.module.resetLocalServer();

    expect(existsSync(f.identityFile)).toBe(false);
    // The Computer itself is still kept for renewal.
    expect(f.host.ctx.config.get().renewalEnrollment).toEqual({
      computerId: "computer_1",
      origin: "https://linger.example.com",
    });
  });

  it("keeps the Daemon Identity across a reset that saw no conflict", async () => {
    const f = enrollmentModule(enrolled);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();

    await f.module.resetLocalServer();

    expect(existsSync(f.identityFile)).toBe(true);
  });

  it("keeps the conflict across a daemon restart", async () => {
    const f = enrollmentModule(enrolled);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();
    f.bus.emit("computer.identity_conflict", true);

    // A daemon that exits and starts again reports no error before it has
    // heard from the Gateway, which says nothing about the identity.
    f.bus.emit("computer.connection", "disconnected");
    f.bus.emit("computer.identity_conflict", false);
    f.bus.emit("computer.connection", "connecting");

    await f.module.resetLocalServer();
    expect(existsSync(f.identityFile)).toBe(false);
  });

  it("keeps the Daemon Identity once the Gateway accepts this Computer", async () => {
    const f = enrollmentModule(enrolled);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();
    f.bus.emit("computer.identity_conflict", true);

    // The other Computer was removed and this one connected with its identity,
    // which proves the identity is this Computer's.
    f.bus.emit("computer.connection", "online");

    await f.module.resetLocalServer();
    expect(existsSync(f.identityFile)).toBe(true);
  });

  it("refuses to reconnect while the Gateway reports the conflict", async () => {
    const server = fakeServer();
    const f = enrollmentModule(enrolled, server.fetch);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();
    f.bus.emit("computer.identity_conflict", true);

    await expect(f.module.enroll()).rejects.toMatchObject({
      code: "IDENTITY_IN_USE",
      message: IDENTITY_CONFLICT_MESSAGE,
    });
    // Nothing was requested and nothing was discarded: the identity is still
    // the one another Computer may hold.
    expect(server.calls).toHaveLength(0);
    expect(existsSync(f.identityFile)).toBe(true);

    // Set Up Again is the way out: it discards the refused identity, and the
    // next enrollment starts clean.
    await f.module.resetLocalServer();
    await f.module.enroll();
    expect(f.host.ctx.config.get().computerId).toBe("computer_1");
    expect(existsSync(f.identityFile)).toBe(false);
  });

  it("keeps the Daemon Identity when the credential cannot be written", async () => {
    const server = fakeServer({
      renewal: {
        status: 404,
        body: { error: { code: "INVALID_ENROLLMENT" } },
      },
    });
    const f = enrollmentModule(
      { ...enrolled, computerId: "computer_old" },
      server.fetch,
    );
    f.credentials.write({
      computerId: "computer_old",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();
    await f.module.resetLocalServer();
    const write = vi
      .spyOn(f.credentials, "write")
      .mockImplementationOnce(() => {
        throw new Error("credential write failed");
      });

    await expect(f.module.enroll()).rejects.toThrow("credential write failed");

    // The enrollment did not land, so the reset and the identity still stand.
    expect(f.host.ctx.config.get().renewalEnrollment?.computerId).toBe(
      "computer_old",
    );
    expect(existsSync(f.identityFile)).toBe(true);

    // Retrying completes the same recovery.
    write.mockRestore();
    await f.module.enroll();
    expect(f.host.ctx.config.get().computerId).toBe("computer_1");
    expect(existsSync(f.identityFile)).toBe(false);
  });

  it("forgets the renewal when another server is set", async () => {
    const f = enrollmentModule(enrolled);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    await f.host.start();
    await f.module.resetLocalServer();
    f.bus.emit("server.changed", "https://other.example.com");
    await vi.waitFor(() =>
      expect(f.host.ctx.config.get().renewalEnrollment).toBeUndefined(),
    );
  });

  it("keeps the renewal when the same server is set again", async () => {
    const f = enrollmentModule(enrolled);
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    await f.host.start();
    await f.module.resetLocalServer();
    f.bus.emit("server.changed", "https://linger.example.com/workspace");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.host.ctx.config.get().renewalEnrollment).toEqual({
      computerId: "computer_1",
      origin: "https://linger.example.com",
    });
  });

  it("does not renew against another server", async () => {
    const server = fakeServer();
    const f = enrollmentModule(
      {
        serverUrl: "https://other.example.com",
        ownerActorId: "actor_ann",
        renewalEnrollment: {
          computerId: "computer_1",
          origin: "https://linger.example.com",
        },
      },
      server.fetch,
    );
    await f.host.start();
    await f.module.enroll();
    const creates = server.calls.filter((call) =>
      call.url.endsWith("/local-computer-enrollments"),
    );
    expect(creates[0]?.body).not.toHaveProperty("computer_id");
  });

  it("remembers a persisted identity conflict across restarts and clears it on reset", async () => {
    const server = fakeServer();
    const f = enrollmentModule(
      { ...enrolled, identityConflict: true },
      server.fetch,
    );
    f.credentials.write({
      computerId: "computer_1",
      gatewayUrl: "wss://linger.example.com/v1/runner",
      token: TOKEN,
    });
    f.writeIdentity();
    await f.host.start();

    await expect(f.module.enroll()).rejects.toMatchObject({
      code: "IDENTITY_IN_USE",
    });

    await f.module.resetLocalServer();
    expect(existsSync(f.identityFile)).toBe(false);
    expect(f.host.ctx.config.get().identityConflict).toBeUndefined();
    await f.module.enroll();
    expect(f.host.ctx.config.get().computerId).toBe("computer_1");
  });
});
