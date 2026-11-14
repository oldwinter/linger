import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import type { components } from "@linger/wire-contracts/teamhub-public/types";

import type { CredentialStore } from "./computer-credential.js";
import type { DesktopConfig } from "./config.js";
import {
  discardDaemonIdentity,
  keepsDaemonIdentity,
} from "./daemon-identity.js";
import type { Module, ModuleContext } from "./modules.js";
import { sameOrigin } from "./navigation.js";

type Schemas = components["schemas"];
type CreateRequest = Schemas["LocalComputerEnrollmentCreateRequest"];
type Authorization = Schemas["LocalComputerEnrollmentAuthorization"];
type ExchangeRequest = Schemas["LocalComputerEnrollmentExchangeRequest"];
type CredentialBundle = Schemas["LocalComputerCredentialBundle"];

// The main process both creates and exchanges the enrollment, so nothing is
// ever redirected here. TeamHub still requires a loopback redirect URI.
const REDIRECT_URI = "http://127.0.0.1:9/callback";
const REQUEST_TIMEOUT_MS = 30_000;

export class EnrollmentError extends Error {
  constructor(
    readonly code:
      | "NOT_SIGNED_IN"
      | "NO_TENANT"
      | "REJECTED"
      | "ENROLLMENT_REMOVED"
      | "IDENTITY_IN_USE"
      | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
  }
}

export interface EnrollInput {
  readonly serverUrl: string;
  // Session cookie header of the signed-in web session. Used for the create
  // call only and never stored or logged.
  readonly cookie: string;
  readonly displayName: string;
  // Keeps the same Computer identity when enrolling again.
  readonly computerId?: string;
  readonly fetch?: typeof fetch;
}

export interface Enrolled {
  readonly computerId: string;
  readonly tenantId: string;
  // The account the credential acts for; runtime registrations are its.
  readonly ownerActorId: string;
  // The Runner Gateway the daemon connects to (ws or wss).
  readonly gatewayUrl: string;
  readonly credential: string;
}

// PKCE enrollment for this computer with the current web session:
// create (as the signed-in human) -> exchange (as the computer).
export const enrollComputer = async (input: EnrollInput): Promise<Enrolled> => {
  const request = input.fetch ?? fetch;
  const call = (
    pathname: string,
    init: { method?: string; body?: unknown; cookie?: string },
  ): Promise<Response> =>
    request(new URL(pathname, input.serverUrl), {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  const me = await call("/v0/me", { cookie: input.cookie });
  if (me.status === 401)
    throw new EnrollmentError("NOT_SIGNED_IN", "Sign in before enrolling");
  if (!me.ok) throw rejected("Reading the signed-in account", me.status);
  const tenantId = humanTenant(await me.json());
  if (!tenantId)
    throw new EnrollmentError("NO_TENANT", "The account has no workspace");

  const verifier = randomBytes(32).toString("base64url");
  const create = (computerId: string | undefined): Promise<Response> =>
    call(
      `/v0/tenants/${encodeURIComponent(tenantId)}/local-computer-enrollments`,
      {
        method: "POST",
        body: {
          display_name: input.displayName,
          redirect_uri: REDIRECT_URI,
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          ...(computerId ? { computer_id: computerId } : {}),
        } satisfies CreateRequest,
        cookie: input.cookie,
      },
    );
  let created = await create(input.computerId);
  // The server no longer knows that Computer: enroll this computer as a new
  // one, once. Retrying every renewal would loop on a server that refuses
  // the request for another reason.
  if (
    created.status === 404 &&
    input.computerId &&
    (await unknownComputer(created))
  )
    created = await create(undefined);
  if (created.status === 401)
    throw new EnrollmentError("NOT_SIGNED_IN", "Sign in before enrolling");
  if (!created.ok) throw rejected("Creating the enrollment", created.status);
  const authorization = (await created.json()) as Authorization;
  if (!authorization.enrollment_id || !authorization.authorization_code)
    throw invalid();

  const exchangeBody: ExchangeRequest = {
    authorization_code: authorization.authorization_code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  };
  const exchanged = await call(
    `/v0/local-computer-enrollments/${encodeURIComponent(authorization.enrollment_id)}/exchange`,
    { method: "POST", body: exchangeBody },
  );
  if (exchanged.status === 410)
    throw new EnrollmentError(
      "ENROLLMENT_REMOVED",
      "This Computer was removed; enroll it again",
    );
  if (!exchanged.ok)
    throw rejected("Exchanging the enrollment", exchanged.status);
  const bundle = (await exchanged.json()) as CredentialBundle;
  if (
    !bundle.computer_id ||
    bundle.computer_id !== authorization.computer_id ||
    bundle.tenant_id !== tenantId ||
    typeof bundle.gateway_token !== "string" ||
    bundle.gateway_token.length < 32 ||
    !isGatewayUrl(bundle.gateway_url)
  )
    throw invalid();
  const ownerActorId = credentialOwner(
    bundle.gateway_token,
    bundle.computer_id,
    bundle.tenant_id,
  );
  if (!ownerActorId) throw invalid();
  return {
    computerId: bundle.computer_id,
    tenantId: bundle.tenant_id,
    ownerActorId,
    gatewayUrl: bundle.gateway_url,
    credential: bundle.gateway_token,
  };
};

const isGatewayUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "wss:" || url.protocol === "ws:") && !!url.host;
  } catch {
    return false;
  }
};

// The owner the credential is scoped to for the tenant, read from its claims
// the way the Go daemon reads them (config.go tokenOwners). Not verified
// here: the gateway checks the signature.
export const credentialOwner = (
  credential: string,
  computerId: string,
  tenantId: string,
): string | undefined => {
  const [format, payload] = credential.split(".");
  if (format !== "sr1" || !payload) return undefined;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      runner_id?: unknown;
      tenant_owners?: { tenant_id?: unknown; owner_actor_id?: unknown }[];
    };
    if (claims.runner_id !== computerId) return undefined;
    const owner = claims.tenant_owners?.find(
      (item) => item.tenant_id === tenantId,
    )?.owner_actor_id;
    return typeof owner === "string" && owner ? owner : undefined;
  } catch {
    return undefined;
  }
};

export const humanTenant = (value: unknown): string | undefined => {
  const actors = (value as { actors?: unknown }).actors;
  if (!Array.isArray(actors)) return undefined;
  const human = actors.find(
    (a): a is { tenant_id: string } =>
      !!a &&
      typeof a === "object" &&
      (a as { kind?: unknown }).kind === "human" &&
      typeof (a as { tenant_id?: unknown }).tenant_id === "string",
  );
  return human?.tenant_id;
};

const rejected = (step: string, status: number): EnrollmentError =>
  new EnrollmentError("REJECTED", `${step} failed (${String(status)})`);
const invalid = (): EnrollmentError =>
  new EnrollmentError(
    "INVALID_RESPONSE",
    "The server returned an invalid enrollment",
  );
// TeamHub answers a renewal for a Computer it does not know with 404 and
// INVALID_ENROLLMENT; another 404 is a real failure.
const unknownComputer = async (response: Response): Promise<boolean> => {
  try {
    const body = (await response.clone().json()) as {
      error?: { code?: unknown };
    };
    return body.error?.code === "INVALID_ENROLLMENT";
  } catch {
    return false;
  }
};

// The Computer to enroll again: the configured one, or the one a reset local
// server kept while the address is still that server.
const renewalComputerId = (config: DesktopConfig): string | undefined => {
  if (config.computerId) return config.computerId;
  const renewal = config.renewalEnrollment;
  if (!renewal || !config.serverUrl) return undefined;
  return sameOrigin(renewal.origin, config.serverUrl)
    ? renewal.computerId
    : undefined;
};

export interface EnrollmentOptions {
  // Reads the web session cookie from the renderer session.
  readonly sessionCookie: (serverUrl: string) => Promise<string | undefined>;
  readonly defaultDisplayName: string;
  // Where the Gateway credential is kept for the daemon.
  readonly credentials: CredentialStore;
  // The Daemon Identity the daemon presents, which TeamHub keeps with the
  // Computer that first presented it.
  readonly daemonIdentityFile: string;
  readonly fetch?: typeof fetch;
}

// The Runner Gateway refused this computer's Daemon Identity because another
// Computer registered it first. Only a new setup enrolls this computer again.
export const IDENTITY_CONFLICT_MESSAGE =
  "This computer's identity is already registered to another Computer. Reset the local server and set it up again.";

// Stores the credential for the daemon; the app config keeps only the
// non-secret Computer id.
export class EnrollmentModule implements Module {
  readonly name = "Enrollment";
  readonly dependsOn = ["Config"];
  readonly #options: EnrollmentOptions;
  #ctx: ModuleContext | undefined;
  #pending: Promise<{ computerId: string }> | undefined;
  #offServerChanged: (() => void) | undefined;
  #offIdentityConflict: (() => void) | undefined;
  #offConnection: (() => void) | undefined;
  // The Gateway refused this computer's Daemon Identity as another Computer's.
  // A restarting daemon reports no error before it reports this one again, so
  // only a successful connection (which proves the identity is this
  // Computer's) or handling the identity clears the fact.
  #identityConflict = false;

  constructor(options: EnrollmentOptions) {
    this.#options = options;
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.#ctx = ctx;
    // An enrollment belongs to one server; switching servers drops it,
    // including a renewal kept for the server being left.
    this.#offServerChanged = ctx.bus.on("server.changed", (serverUrl) => {
      const config = ctx.config.get();
      const renewal = config.renewalEnrollment;
      if (
        !config.computerId &&
        (!renewal || sameOrigin(renewal.origin, serverUrl))
      )
        return;
      void this.unenroll().catch((error: unknown) =>
        ctx.log.warn("enrollment.clear_failed", { error: String(error) }),
      );
    });
    this.#offIdentityConflict = ctx.bus.on(
      "computer.identity_conflict",
      (conflict) => {
        if (conflict) this.#identityConflict = true;
      },
    );
    this.#offConnection = ctx.bus.on("computer.connection", (state) => {
      // The Gateway accepted this Computer, so its identity is this one's.
      if (state === "online") this.#identityConflict = false;
    });
    // Enrollments made before the owner was kept, or whose credential did
    // not carry over from the bridge, are renewed for the same Computer.
    const config = ctx.config.get();
    if (
      config.computerId &&
      (!config.ownerActorId ||
        this.#options.credentials.read()?.computerId !== config.computerId)
    ) {
      void this.enroll().catch((error: unknown) =>
        ctx.log.warn("enrollment.renew_failed", { error: String(error) }),
      );
    }
  }

  async stop(): Promise<void> {
    this.#offServerChanged?.();
    this.#offIdentityConflict?.();
    this.#offConnection?.();
  }

  // Whether the Gateway refused this computer's Daemon Identity as another
  // Computer's and nothing has proven otherwise since.
  identityConflict(): boolean {
    return this.#identityConflict;
  }

  // Whether the window holds a valid session for the configured server.
  async signedIn(): Promise<boolean> {
    const serverUrl = this.#ctx!.config.get().serverUrl;
    if (!serverUrl) return false;
    const cookie = await this.#options.sessionCookie(serverUrl);
    if (!cookie) return false;
    try {
      const response = await (this.#options.fetch ?? fetch)(
        new URL("/v0/me", serverUrl),
        {
          headers: { accept: "application/json", cookie },
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  enroll(): Promise<{ computerId: string }> {
    // The Gateway refused this identity as another Computer's. Enrolling again
    // would renew the same Computer and keep it, so the conflict would repeat;
    // Set Up Again is the way out, and it discards the identity.
    if (this.#identityConflict)
      return Promise.reject(
        new EnrollmentError("IDENTITY_IN_USE", IDENTITY_CONFLICT_MESSAGE),
      );
    // Concurrent clicks share one enrollment instead of creating two.
    this.#pending ??= this.#enroll().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  // Another server: its enrollment does not apply here, so nothing of it is
  // kept.
  async unenroll(): Promise<void> {
    const ctx = this.#ctx!;
    this.#options.credentials.clear();
    ctx.config.update({
      computerId: undefined,
      tenantId: undefined,
      ownerActorId: undefined,
      renewalEnrollment: undefined,
    });
    this.#identityConflict = false;
    ctx.bus.emit("computer.changed", undefined);
    ctx.log.info("enrollment.cleared");
  }

  // The local server this computer runs is set up again: the credential is
  // gone, but the Computer is kept so the next enrollment against the same
  // origin renews it instead of creating another. A Daemon Identity the
  // Gateway already refused as another Computer's is not this Computer's to
  // reuse, so it goes too and the daemon makes a new one.
  async resetLocalServer(): Promise<void> {
    const ctx = this.#ctx!;
    const { computerId, serverUrl } = ctx.config.get();
    const discardIdentity = this.#identityConflict;
    this.#options.credentials.clear();
    ctx.config.update({
      computerId: undefined,
      tenantId: undefined,
      ownerActorId: undefined,
      renewalEnrollment:
        computerId && serverUrl
          ? { computerId, origin: new URL(serverUrl).origin }
          : undefined,
    });
    // Only once the reset is stored: TeamHub binds an identity only to an
    // unbound Computer, so a discard that outran it would leave no way back.
    if (discardIdentity) {
      if (existsSync(this.#options.daemonIdentityFile)) {
        discardDaemonIdentity(this.#options.daemonIdentityFile);
        ctx.log.info("enrollment.identity_discarded", {
          ...(computerId ? { computer_id: computerId } : {}),
          reason: "identity_conflict",
        });
      }
      this.#identityConflict = false;
    }
    ctx.bus.emit("computer.changed", undefined);
    ctx.log.info("enrollment.kept_for_renewal", {
      ...(computerId ? { computer_id: computerId } : {}),
    });
  }

  async #enroll(): Promise<{ computerId: string }> {
    const ctx = this.#ctx!;
    const config = ctx.config.get();
    if (!config.serverUrl) throw new Error("Server address is not set");
    const cookie = await this.#options.sessionCookie(config.serverUrl);
    if (!cookie)
      throw new EnrollmentError("NOT_SIGNED_IN", "Sign in before enrolling");
    const computerId = renewalComputerId(config);
    const enrolled = await enrollComputer({
      serverUrl: config.serverUrl,
      cookie,
      displayName: config.displayName ?? this.#options.defaultDisplayName,
      ...(computerId ? { computerId } : {}),
      ...(this.#options.fetch ? { fetch: this.#options.fetch } : {}),
    });
    this.#options.credentials.write({
      computerId: enrolled.computerId,
      gatewayUrl: enrolled.gatewayUrl,
      token: enrolled.credential,
    });
    ctx.config.update({
      computerId: enrolled.computerId,
      tenantId: enrolled.tenantId,
      ownerActorId: enrolled.ownerActorId,
      renewalEnrollment: undefined,
    });
    // The identity belongs to the Computer it served, and TeamHub would refuse
    // it to another Computer for good, so it goes before the daemon starts on
    // the one this enrollment returned, but only after that enrollment is
    // stored: a discard that outran it would leave this computer no way back.
    if (
      !keepsDaemonIdentity({
        computerId,
        enrolledComputerId: enrolled.computerId,
        present: existsSync(this.#options.daemonIdentityFile),
      })
    ) {
      discardDaemonIdentity(this.#options.daemonIdentityFile);
      ctx.log.info("enrollment.identity_discarded", {
        computer_id: enrolled.computerId,
      });
    }
    ctx.bus.emit("computer.changed", enrolled.computerId);
    ctx.log.info("enrollment.completed", { computer_id: enrolled.computerId });
    return { computerId: enrolled.computerId };
  }
}
