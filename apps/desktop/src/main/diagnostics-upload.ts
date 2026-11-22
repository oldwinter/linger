import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import http from "node:http";
import https from "node:https";

import { z } from "zod";

import type { Translate } from "../i18n/language.js";
import type { SetupDiagnosticsSend } from "../shared/setup.js";
import { dialogMessages as m } from "./dialogs.messages.js";

// Sends the diagnostics zip to a receiver that implements
// docs/diagnostics-upload.md: one POST asks for a report id and a
// one-time upload URL, one PUT sends the zip there.

export const DIAGNOSTICS_UPLOAD_SCHEMA = "linger.diagnostics-upload/v1";

// The hosted receiver, which the release pipeline provides at build time
// (LINGER_DIAGNOSTICS_UPLOAD_URL, see build.mjs). Builds without it (forks,
// local and self-hosted builds) and tests have none, so Send Diagnostics
// shows only when config.json names a receiver in diagnosticsUploadUrl.
declare const __HOSTED_DIAGNOSTICS_UPLOAD_URL__: string | null | undefined;
export const HOSTED_DIAGNOSTICS_UPLOAD_URL: string | undefined =
  (typeof __HOSTED_DIAGNOSTICS_UPLOAD_URL__ === "undefined"
    ? undefined
    : __HOSTED_DIAGNOSTICS_UPLOAD_URL__) ?? undefined;

// Receivers may accept less; this keeps a runaway log from leaving at all.
export const MAX_DIAGNOSTICS_UPLOAD_BYTES = 50 * 1024 * 1024;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// https, or http to this computer for a receiver under development. No
// user name or password in the URL, since it is shown on the consent
// screen and logged.
export const isUploadUrl = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK.has(url.hostname))
  );
};

// The receiver this app sends to, or none: then Send Diagnostics is hidden.
export const diagnosticsUploadUrl = (
  config: { readonly diagnosticsUploadUrl?: string | undefined },
  hosted: string | undefined = HOSTED_DIAGNOSTICS_UPLOAD_URL,
): string | undefined => config.diagnosticsUploadUrl ?? hosted;

const uploadTicket = z.object({
  schema: z.literal(DIAGNOSTICS_UPLOAD_SCHEMA),
  reportId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{3,63}$/),
  upload: z.object({
    method: z.literal("PUT"),
    url: z.string().refine(isUploadUrl, "Upload URL must use https"),
    headers: z.record(z.string(), z.string()).default({}),
  }),
});

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// Set by the client itself; a receiver cannot override them.
const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
]);

export class DiagnosticsUploadError extends Error {
  constructor(
    message: string,
    // Whether trying again can help: not for a refused or invalid bundle.
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DiagnosticsUploadError";
  }
}

export interface DiagnosticsUploadOptions {
  readonly endpoint: string;
  readonly file: string;
  readonly bytes: number;
  readonly client: {
    readonly version: string;
    readonly platform: string;
  };
  readonly onProgress?: (sent: number) => void;
}

const sha256File = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const refusal = async (response: Response): Promise<DiagnosticsUploadError> => {
  const body = errorEnvelope.safeParse(
    await response.json().catch(() => undefined),
  );
  const said = body.success ? `: ${body.data.error.message}` : "";
  if (response.status === 413)
    return new DiagnosticsUploadError(
      `The diagnostics are too large for the server${said}`,
      false,
    );
  if (response.status === 429) {
    const after = Number(response.headers.get("retry-after"));
    return new DiagnosticsUploadError(
      Number.isFinite(after) && after > 0
        ? `Too many reports were sent. Try again in ${Math.ceil(after / 60)} min.`
        : "Too many reports were sent. Try again later.",
      true,
    );
  }
  return new DiagnosticsUploadError(
    `The server refused the report (HTTP ${response.status})${said}`,
    response.status >= 500,
  );
};

// Asks the receiver for a report id and an upload URL, uploads the zip and
// returns the report id.
export const uploadDiagnostics = async (
  options: DiagnosticsUploadOptions,
): Promise<string> => {
  if (!isUploadUrl(options.endpoint))
    throw new DiagnosticsUploadError(
      "The upload address must use https",
      false,
    );
  if (options.bytes > MAX_DIAGNOSTICS_UPLOAD_BYTES)
    throw new DiagnosticsUploadError(
      `The diagnostics are larger than ${MAX_DIAGNOSTICS_UPLOAD_BYTES / 1024 / 1024} MB`,
      false,
    );
  let response: Response;
  try {
    response = await fetch(options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        schema: DIAGNOSTICS_UPLOAD_SCHEMA,
        size: options.bytes,
        sha256: await sha256File(options.file),
        client: { name: "linger-desktop", ...options.client },
      }),
      // A redirect could leave https; receivers answer directly.
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new DiagnosticsUploadError(
      `Couldn't reach ${new URL(options.endpoint).host}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      true,
    );
  }
  if (!response.ok) throw await refusal(response);
  const ticket = uploadTicket.safeParse(
    await response.json().catch(() => undefined),
  );
  if (!ticket.success)
    throw new DiagnosticsUploadError(
      "The server gave an answer this version of Linger doesn't understand",
      false,
    );
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(ticket.data.upload.headers))
    if (!RESERVED_HEADERS.has(name.toLowerCase())) headers[name] = value;
  await put(ticket.data.upload.url, headers, options);
  return ticket.data.reportId;
};

// Streams the file with a Content-Length, which object stores require of
// a presigned PUT, and reports the bytes sent.
const put = (
  url: string,
  headers: Record<string, string>,
  options: DiagnosticsUploadOptions,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const fail = (message: string, retryable = true) =>
      reject(new DiagnosticsUploadError(message, retryable));
    const request = (target.protocol === "https:" ? https : http).request(
      target,
      {
        method: "PUT",
        headers: { ...headers, "content-length": String(options.bytes) },
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else
          fail(
            `The upload was refused (HTTP ${status})`,
            status >= 500 || status === 403,
          );
      },
    );
    request.setTimeout(60_000, () =>
      request.destroy(new Error("The upload stalled")),
    );
    request.on("error", (error) => fail(`The upload failed: ${error.message}`));
    let sent = 0;
    const source = createReadStream(options.file);
    source.on("data", (chunk) => {
      sent += chunk.length;
      options.onProgress?.(sent);
    });
    source.on("error", (error) => request.destroy(error));
    source.pipe(request);
  });

const PROGRESS_INTERVAL_MS = 150;

// A bundle built and waiting for the person's consent, or kept after a
// failed upload so Try Again sends the same files.
export interface PreparedDiagnostics {
  readonly file: string;
  readonly entries: readonly string[];
  readonly bytes: number;
}

export interface DiagnosticsSenderOptions {
  readonly endpoint: () => string | undefined;
  readonly prepare: () => Promise<PreparedDiagnostics>;
  readonly upload: (
    endpoint: string,
    bundle: PreparedDiagnostics,
    onProgress: (sent: number) => void,
  ) => Promise<string>;
  readonly discard: (file: string) => Promise<void>;
  readonly onChange?: (state: SetupDiagnosticsSend) => void;
}

// The send flow every surface shares: build the zip, wait for consent,
// upload, then show the report id or why it failed. Nothing leaves this
// computer before confirm().
export class DiagnosticsSender {
  readonly #options: DiagnosticsSenderOptions;
  #state: SetupDiagnosticsSend = { phase: "idle" };
  #bundle: PreparedDiagnostics | undefined;
  #endpoint: string | undefined;

  constructor(options: DiagnosticsSenderOptions) {
    this.#options = options;
  }

  state(): SetupDiagnosticsSend {
    return this.#state;
  }

  // Whether start() may run now; one send at a time.
  idle(): boolean {
    return ["idle", "sent", "failed"].includes(this.#state.phase);
  }

  async start(): Promise<void> {
    if (!this.idle()) return;
    await this.#drop();
    const endpoint = this.#options.endpoint();
    if (!endpoint) {
      this.#set({
        phase: "failed",
        error: "No diagnostics server is set up.",
        retry: false,
      });
      return;
    }
    this.#endpoint = endpoint;
    this.#set({ phase: "preparing" });
    try {
      this.#bundle = await this.#options.prepare();
    } catch (error) {
      this.#set({
        phase: "failed",
        error: `Couldn't collect the diagnostics: ${message(error)}`,
        retry: true,
      });
      return;
    }
    if (this.#bundle.bytes > MAX_DIAGNOSTICS_UPLOAD_BYTES) {
      await this.#drop();
      this.#set({
        phase: "failed",
        error: `The diagnostics are larger than ${MAX_DIAGNOSTICS_UPLOAD_BYTES / 1024 / 1024} MB. Use Save Diagnostics instead.`,
        retry: false,
      });
      return;
    }
    this.#set({
      phase: "confirm",
      host: new URL(endpoint).host,
      files: this.#bundle.entries,
      bytes: this.#bundle.bytes,
    });
  }

  // The person agreed to the files shown; uploads them.
  async confirm(): Promise<void> {
    const bundle = this.#bundle;
    const endpoint = this.#endpoint;
    if (this.#state.phase !== "confirm" || !bundle || !endpoint) return;
    await this.#upload(endpoint, bundle);
  }

  // After a failure: uploads the same files again, or collects them again
  // when collecting was what failed.
  async retry(): Promise<void> {
    if (this.#state.phase !== "failed" || !this.#state.retry) return;
    const bundle = this.#bundle;
    const endpoint = this.#endpoint;
    if (bundle && endpoint) await this.#upload(endpoint, bundle);
    else {
      this.#set({ phase: "idle" });
      await this.start();
    }
  }

  // Declines, or closes the result; the zip is deleted either way.
  async cancel(): Promise<void> {
    if (this.#state.phase === "preparing" || this.#state.phase === "sending")
      return;
    await this.#drop();
    this.#set({ phase: "idle" });
  }

  async #upload(endpoint: string, bundle: PreparedDiagnostics): Promise<void> {
    const host = new URL(endpoint).host;
    const total = bundle.bytes;
    this.#set({ phase: "sending", host, sent: 0, total });
    // Each chunk would be a state push; a few per second draw the bar.
    let shown = 0;
    try {
      const reportId = await this.#options.upload(endpoint, bundle, (sent) => {
        const now = Date.now();
        if (sent < total && now - shown < PROGRESS_INTERVAL_MS) return;
        shown = now;
        this.#set({ phase: "sending", host, sent, total });
      });
      await this.#drop();
      this.#set({ phase: "sent", host, reportId });
    } catch (error) {
      const retry =
        error instanceof DiagnosticsUploadError ? error.retryable : true;
      if (!retry) await this.#drop();
      this.#set({ phase: "failed", error: message(error), retry });
    }
  }

  async #drop(): Promise<void> {
    const bundle = this.#bundle;
    this.#bundle = undefined;
    if (bundle) await this.#options.discard(bundle.file).catch(() => {});
  }

  #set(state: SetupDiagnosticsSend): void {
    this.#state = state;
    this.#options.onChange?.(state);
  }
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.ceil(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// What the consent prompt says, for the native dialog of the tray and the
// start failure page; the setup page draws the same facts itself.
export const consentText = (
  state: Extract<SetupDiagnosticsSend, { phase: "confirm" }>,
  t: Translate,
  shown = 12,
): { readonly message: string; readonly detail: string } => {
  const files = state.files.slice(0, shown).map((file) => `  ${file}`);
  if (state.files.length > shown)
    files.push(
      `  ${t(m.sendConsentMore, { count: state.files.length - shown })}`,
    );
  return {
    message: t(m.sendConsent, { host: state.host }),
    detail: [
      t(m.sendConsentFiles, {
        count: state.files.length,
        size: formatBytes(state.bytes),
      }),
      t(m.sendConsentRedacted),
      t(m.sendConsentReaders, { host: state.host }),
      "",
      ...files,
    ].join("\n"),
  };
};

// The questions a surface without its own page asks (the tray, the start
// failure page): consent, then the report id, or the failure with Try
// Again.
export interface DiagnosticsPrompts {
  consent(
    state: Extract<SetupDiagnosticsSend, { phase: "confirm" }>,
  ): Promise<boolean>;
  sent(state: Extract<SetupDiagnosticsSend, { phase: "sent" }>): Promise<void>;
  // Resolves true to try again.
  failed(
    state: Extract<SetupDiagnosticsSend, { phase: "failed" }>,
  ): Promise<boolean>;
  // Another send is still running, from the setup page.
  busy(): Promise<void>;
}

// Walks one send through native prompts. A report still waiting for
// consent, say from a setup window that was closed, is asked about here
// instead of blocking the send.
export const sendWithPrompts = async (
  sender: DiagnosticsSender,
  prompts: DiagnosticsPrompts,
): Promise<void> => {
  if (sender.state().phase !== "confirm") {
    if (!sender.idle()) return prompts.busy();
    await sender.start();
  }
  for (;;) {
    const state = sender.state();
    if (state.phase === "confirm") {
      if (await prompts.consent(state)) await sender.confirm();
      else return sender.cancel();
    } else if (state.phase === "sent") {
      await prompts.sent(state);
      return sender.cancel();
    } else if (state.phase === "failed") {
      if (state.retry && (await prompts.failed(state))) await sender.retry();
      else {
        if (!state.retry) await prompts.failed(state);
        return sender.cancel();
      }
    } else return;
  }
};
