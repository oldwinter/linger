import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

const CALLBACK_PREFIX = "/oauth/connector/";
const CALLBACK_TTL = 15 * 60_000;
const MAX_CALLBACKS = 32;
type ReturnHandler = (connectedAccountId?: string) => void;

export class ConnectorOAuth {
  #server?: Server;
  #origin?: Promise<string>;
  readonly #pending = new Map<
    string,
    { expires: number; onReturn: ReturnHandler }
  >();

  async prepare(onReturn: ReturnHandler): Promise<string> {
    const origin = await (this.#origin ??= this.#listen());
    const now = Date.now();
    for (const [key, attempt] of this.#pending) {
      if (attempt.expires <= now) this.#pending.delete(key);
    }
    if (this.#pending.size >= MAX_CALLBACKS) {
      throw new Error("Too many connector authorizations in progress");
    }
    const pathname = CALLBACK_PREFIX + randomBytes(24).toString("hex");
    this.#pending.set(pathname, { expires: now + CALLBACK_TTL, onReturn });
    return origin + pathname;
  }

  #listen(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const server = createServer({ requestTimeout: 10_000 }, (req, res) => {
        const address = server.address();
        const host =
          address && typeof address !== "string"
            ? `127.0.0.1:${address.port}`
            : "";
        res.setHeader("Cache-Control", "no-store");
        if (
          !host ||
          req.method !== "GET" ||
          req.headers.host !== host ||
          !req.url?.startsWith(CALLBACK_PREFIX)
        ) {
          res.writeHead(404).end("Authorization callback not found.");
          return;
        }
        const url = new URL(req.url, `http://${host}`);
        const attempt = this.#pending.get(url.pathname);
        if (!attempt || attempt.expires <= Date.now()) {
          res.writeHead(404).end("Authorization callback not found.");
          return;
        }
        this.#pending.delete(url.pathname);
        const account = url.searchParams.get("connected_account_id");
        res
          .writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": "default-src 'none'",
            "Referrer-Policy": "no-referrer",
          })
          .end(
            "<!doctype html><html lang=en><meta charset=utf-8><title>Linger authorization</title><h1>Go back to Linger</h1><p>Linger received the authorization response. Check the connector status in the app. You can close this tab.</p>",
          );
        attempt.onReturn(
          account && /^[a-zA-Z0-9_-]{1,256}$/.test(account)
            ? account
            : undefined,
        );
      });
      this.#server = server;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        const address = server.address();
        if (address && typeof address !== "string")
          resolve(`http://127.0.0.1:${address.port}`);
      });
    }).catch((error: unknown) => {
      this.#origin = undefined;
      throw error;
    });
  }

  stop(): void {
    this.#pending.clear();
    this.#server?.close();
    this.#server?.closeAllConnections();
  }
}
