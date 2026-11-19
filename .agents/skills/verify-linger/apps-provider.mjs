// Disposable Composio HTTP adapter for the real-TeamHub Apps proof.
import { createServer } from "node:http";
const port = Number(process.env.VERIFY_COMPOSIO_PORT ?? 28087);
const origin = `http://127.0.0.1:${port}`;
const configs = new Map();
const connections = new Map();
const connectorProof = process.env.VERIFY_CONNECTOR_CLI === "1";
const executions = [];
const drafts = new Map();
const proofTools = {
  GMAIL_FETCH_EMAILS: {
    type: "object",
    properties: {
      query: { type: "string" },
      max_results: { type: "integer", minimum: 1, maximum: 100 },
      include_payload: { type: "boolean" },
      include_spam_trash: { type: "boolean" },
      page_token: { type: "string" },
    },
    additionalProperties: false,
  },
  GMAIL_CREATE_EMAIL_DRAFT: {
    type: "object",
    properties: {
      recipient_email: { type: "string" },
      extra_recipients: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      body: { type: "string" },
      is_html: { type: "boolean" },
    },
    required: ["recipient_email", "subject", "body"],
    additionalProperties: false,
  },
  GMAIL_GET_DRAFT: {
    type: "object",
    properties: { draft_id: { type: "string" }, format: { type: "string" } },
    required: ["draft_id"],
    additionalProperties: false,
  },
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const send = (body, code = 200) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const input = raw ? JSON.parse(raw) : {};
  if (url.pathname === "/healthz") return send({ ok: true });
  if (connectorProof && url.pathname === "/proof/state")
    return send({ executions, drafts: [...drafts.values()] });
  if (connectorProof && url.pathname === "/api/v3.1/tools/execute/proxy") {
    if (input.endpoint === "/gmail/v1/users/me/profile")
      return send({
        status: 200,
        data: { emailAddress: "owner@example.test", historyId: "100" },
        headers: {},
      });
    return send({ status: 404, data: {}, headers: {} });
  }
  if (connectorProof && url.pathname.startsWith("/api/v3/tools/")) {
    const slug = url.pathname.split("/").at(-1);
    const inputSchema = proofTools[slug];
    if (!inputSchema) return send({}, 404);
    return send({
      slug,
      name: slug,
      description: "Disposable connector proof binding",
      version: "20261015_00",
      is_deprecated: false,
      toolkit: { slug: "gmail" },
      input_parameters: inputSchema,
    });
  }
  if (connectorProof && url.pathname.startsWith("/api/v3.1/tools/execute/")) {
    const slug = url.pathname.split("/").at(-1),
      args = input.arguments;
    const connection = connections.get(input.connected_account_id);
    if (!connection || connection.status !== "ACTIVE") return send({}, 403);
    executions.push({ slug, arguments: args });
    if (slug === "GMAIL_FETCH_EMAILS")
      return send({
        successful: true,
        data: {
          messages: [
            {
              messageId: "proof_message",
              threadId: "proof_thread",
              subject: "Connector CLI browser proof",
              sender: "Alice <alice@example.test>",
              messageTimestamp: "2026-10-16T10:00:00Z",
              labelIds: ["INBOX", "UNREAD"],
            },
          ],
        },
      });
    if (slug === "GMAIL_CREATE_EMAIL_DRAFT") {
      const id = `proof_draft_${drafts.size + 1}`;
      const draft = {
        id,
        message: {
          messageId: `${id}_message`,
          threadId: `${id}_thread`,
          to: args.recipient_email,
          subject: args.subject,
          payload: {
            mimeType: args.is_html ? "text/html" : "text/plain",
            headers: [
              { name: "To", value: args.recipient_email },
              { name: "Subject", value: args.subject },
            ],
            body: { data: Buffer.from(args.body).toString("base64url") },
          },
        },
      };
      drafts.set(id, draft);
      return send({ successful: true, data: draft });
    }
    if (slug === "GMAIL_GET_DRAFT" && drafts.has(args.draft_id))
      return send({ successful: true, data: drafts.get(args.draft_id) });
    return send({ successful: false, data: {} });
  }
  if (url.pathname === "/api/v3.1/auth_configs") {
    if (req.method === "GET") return send({ items: [...configs.values()] });
    const config = {
      id: `ac_${configs.size + 1}`,
      name: input.auth_config.name,
      auth_scheme: input.auth_config.auth_scheme,
      is_composio_managed: true,
      status: "ENABLED",
      toolkit: input.toolkit,
    };
    configs.set(config.id, config);
    return send({ toolkit: input.toolkit, auth_config: config });
  }
  if (url.pathname === "/api/v3.1/connected_accounts/link") {
    const id = `ca_${connections.size + 1}`;
    connections.set(id, { ...input, id, status: "INITIATED" });
    return send({
      connected_account_id: id,
      redirect_url: `${origin}/authorize/${id}`,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
  }
  if (url.pathname.startsWith("/authorize/")) {
    const connection = connections.get(url.pathname.split("/").at(-1));
    if (!connection) return send({}, 404);
    if (req.method === "POST") {
      connection.status = "ACTIVE";
      res.writeHead(303, { Location: connection.callback_url });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(
      `<html><body><h1>Authorize test account</h1><p>Disposable provider simulation</p><form method="post"><button>Authorize ${connectorProof ? "Gmail" : "Linear"}</button></form></body></html>`,
    );
  }
  if (url.pathname.startsWith("/api/v3.1/connected_accounts/")) {
    const connection = connections.get(url.pathname.split("/").at(-1));
    if (!connection) return send({}, 404);
    if (req.method === "DELETE") {
      connection.status = "REVOKED";
      return send({ success: true });
    }
    const config = configs.get(connection.auth_config_id);
    return send({
      status: connection.status,
      user_id: connection.user_id,
      toolkit: config.toolkit,
      auth_config: { id: config.id },
    });
  }
  return send({}, 404);
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close();
});
