#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../..");
const DEFAULT_TIMEOUT_MS = Number(
  process.env.AGENT_BROWSER_DEFAULT_TIMEOUT ?? "25000",
);

function fail(message, code = 1) {
  process.stderr.write(`playwright-browser-session: ${message}\n`);
  process.exit(code);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function importPlaywright() {
  const entry = path.join(REPO_ROOT, "node_modules/@playwright/test/index.mjs");
  if (existsSync(entry)) {
    return import(pathToFileURL(entry).href);
  }
  return import("@playwright/test");
}

async function findCachedChromiumExecutable() {
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright"),
  ].filter(Boolean);
  const relCandidates = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "chrome-headless-shell-mac-x64/chrome-headless-shell",
    "chrome-linux/chrome",
    "chrome-linux64/chrome",
    "chrome-headless-shell-linux64/chrome-headless-shell",
  ];
  for (const root of cacheRoots) {
    if (!existsSync(root)) {
      continue;
    }
    const entries = (await readdir(root).catch(() => []))
      .filter((name) => name.startsWith("chromium"))
      .sort()
      .reverse();
    for (const entry of entries) {
      for (const rel of relCandidates) {
        const full = path.join(root, entry, rel);
        if (existsSync(full)) {
          return full;
        }
      }
    }
  }
  return undefined;
}

async function launchChromium() {
  const { chromium } = await importPlaywright();
  const attempts = [];
  const defaultExec = chromium.executablePath();
  if (defaultExec && existsSync(defaultExec)) {
    attempts.push({ label: "bundled chromium", options: { headless: true } });
  }
  const cachedExec = await findCachedChromiumExecutable();
  if (cachedExec && cachedExec !== defaultExec) {
    attempts.push({
      label: `cached chromium (${path.basename(path.dirname(path.dirname(cachedExec)))})`,
      options: { executablePath: cachedExec, headless: true },
    });
  }
  attempts.push(
    { label: "system chrome", options: { channel: "chrome", headless: true } },
    { label: "system msedge", options: { channel: "msedge", headless: true } },
  );
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.options);
    } catch (error) {
      errors.push(
        `${attempt.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `Could not launch any Chromium browser. Install Chromium with \`pnpm exec playwright install chromium\`.\n${errors.join("\n")}`,
  );
}

function resolveTarget(page, target) {
  if (/^@e\d+$/.test(target)) {
    return page.locator(`[data-linger-verify-ref="${target.slice(1)}"]`);
  }
  return page.locator(target);
}

async function runSnapshot(page, interactiveOnly) {
  if (!interactiveOnly) {
    return await page.locator("body").ariaSnapshot();
  }
  return await page.evaluate(() => {
    const { document, Element, Node, getComputedStyle } = globalThis;
    for (const stale of document.querySelectorAll("[data-linger-verify-ref]")) {
      stale.removeAttribute("data-linger-verify-ref");
    }

    const INTERACTIVE_ROLES = new Set([
      "button",
      "link",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "option",
      "checkbox",
      "radio",
      "switch",
      "combobox",
      "searchbox",
      "textbox",
      "slider",
      "spinbutton",
    ]);
    const LANDMARK_ROLES = new Set([
      "navigation",
      "region",
      "complementary",
      "dialog",
      "alertdialog",
      "tablist",
      "listbox",
      "menu",
      "group",
      "toolbar",
      "main",
    ]);

    function isVisible(el) {
      if (!(el instanceof Element)) return false;
      if (el.hasAttribute("hidden")) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      if (el.closest("[inert]")) return false;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    }

    function normalizeSpace(text) {
      return (text ?? "").replace(/\s+/g, " ").trim();
    }

    function textFromNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
      }
      if (!(node instanceof Element)) {
        return "";
      }
      if (node.hasAttribute("hidden")) return "";
      if (node.getAttribute("aria-hidden") === "true") return "";
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return "";
      if (node.tagName === "IMG") {
        return node.getAttribute("alt") ?? "";
      }
      const ariaLabel = node.getAttribute("aria-label");
      if (
        ariaLabel &&
        (node.tagName === "SVG" || node.getAttribute("role") === "img")
      ) {
        return ariaLabel;
      }
      let out = "";
      for (const child of node.childNodes) {
        const piece = textFromNode(child);
        if (piece) {
          out += (out ? " " : "") + piece;
        }
      }
      return out;
    }

    function accessibleName(el) {
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.trim()) {
        return normalizeSpace(ariaLabel);
      }
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const parts = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((refEl) => normalizeSpace(textFromNode(refEl)))
          .filter(Boolean);
        if (parts.length > 0) {
          return parts.join(" ");
        }
      }
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT"
      ) {
        const labels = "labels" in el && el.labels ? [...el.labels] : [];
        if (labels.length > 0) {
          const text = labels
            .map((labelEl) => {
              const clone = labelEl.cloneNode(true);
              for (const nested of clone.querySelectorAll(
                "input, textarea, select, button",
              )) {
                nested.remove();
              }
              return normalizeSpace(clone.textContent);
            })
            .filter(Boolean)
            .join(" ");
          if (text) return text;
        }
        const placeholder = el.getAttribute("placeholder");
        if (placeholder && placeholder.trim()) {
          return normalizeSpace(placeholder);
        }
      }
      const title = el.getAttribute("title");
      const content = normalizeSpace(textFromNode(el));
      if (content) return content;
      if (title && title.trim()) return normalizeSpace(title);
      return "";
    }

    function implicitRole(el) {
      const explicit = el.getAttribute("role");
      if (explicit) {
        return explicit.trim().split(/\s+/)[0];
      }
      const tag = el.tagName;
      if (tag === "A" && el.hasAttribute("href")) return "link";
      if (tag === "BUTTON") return "button";
      if (tag === "TEXTAREA") return "textbox";
      if (tag === "SELECT") return "combobox";
      if (tag === "NAV") return "navigation";
      if (tag === "ASIDE") return "complementary";
      if (tag === "MAIN") return "main";
      if (tag === "DIALOG") return "dialog";
      if (
        tag === "SECTION" &&
        (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby"))
      ) {
        return "region";
      }
      if (tag === "INPUT") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (type === "hidden") return "";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "search") return "searchbox";
        if (type === "button" || type === "submit" || type === "reset") {
          return "button";
        }
        return "textbox";
      }
      if (el.getAttribute("contenteditable") === "true") {
        return "textbox";
      }
      return "";
    }

    let nextRef = 1;
    const lines = [];

    function walk(node, depth) {
      if (!(node instanceof Element)) return;
      if (node.hasAttribute("hidden")) return;
      if (node.getAttribute("aria-hidden") === "true") return;
      if (node.hasAttribute("inert")) return;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return;

      const role = implicitRole(node);
      const isInteractive = INTERACTIVE_ROLES.has(role) && isVisible(node);
      const isLandmark = LANDMARK_ROLES.has(role);

      if (isInteractive) {
        const ref = `e${nextRef++}`;
        node.setAttribute("data-linger-verify-ref", ref);
        const name = accessibleName(node).slice(0, 160);
        const flags = [`ref=${ref}`];
        if (
          node.hasAttribute("disabled") ||
          node.getAttribute("aria-disabled") === "true"
        ) {
          flags.push("disabled");
        }
        if (node.getAttribute("aria-pressed") === "true") {
          flags.push("pressed");
        }
        if (node.getAttribute("aria-selected") === "true") {
          flags.push("selected");
        }
        if (
          node.getAttribute("aria-checked") === "true" ||
          (node.tagName === "INPUT" &&
            "checked" in node &&
            Boolean(node.checked))
        ) {
          flags.push("checked");
        }
        if (node.getAttribute("aria-expanded") === "true") {
          flags.push("expanded");
        }
        const quotedName = name ? ` ${JSON.stringify(name)}` : "";
        lines.push(
          `${"  ".repeat(depth)}- ${role}${quotedName} [${flags.join(", ")}]`,
        );
        // Walk children only if an interactive widget wraps nested interactive widgets (rare).
        if (role !== "textbox" && role !== "searchbox") {
          for (const child of node.children) {
            walk(child, depth + 1);
          }
        }
        return;
      }

      if (isLandmark) {
        const beforeCount = lines.length;
        const name = accessibleName(node).slice(0, 120);
        const header = `${"  ".repeat(depth)}- ${role}${name ? ` ${JSON.stringify(name)}` : ""}:`;
        lines.push(header);
        for (const child of node.children) {
          walk(child, depth + 1);
        }
        if (lines.length === beforeCount + 1) {
          lines.pop();
        }
        return;
      }

      for (const child of node.children) {
        walk(child, depth);
      }
    }

    walk(document.body, 0);
    return lines.join("\n");
  });
}

async function executeFind(page, args, timeout) {
  const mode = args[0];
  const rest = args.slice(1);
  if (!mode) {
    throw new Error("find requires a locator mode (role, label, text, testid)");
  }

  let locator;
  let remaining = [];

  if (mode === "role") {
    const role = rest[0];
    if (!role) {
      throw new Error("find role requires a role name");
    }
    let name;
    let exact = false;
    let nth = 0;
    for (let i = 1; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === "--name") {
        name = rest[i + 1];
        if (name === undefined) {
          throw new Error("--name requires a value");
        }
        i += 1;
      } else if (token === "--exact") {
        exact = true;
      } else if (token === "--nth") {
        nth = Number(rest[i + 1] ?? "0");
        i += 1;
      } else {
        remaining.push(token);
      }
    }
    const roleOptions = {};
    if (name !== undefined) {
      roleOptions.name = name;
    }
    if (exact) {
      roleOptions.exact = true;
    }
    locator = page.getByRole(role, roleOptions).nth(nth);
  } else if (mode === "label" || mode === "text" || mode === "testid") {
    const query = rest[0];
    if (query === undefined) {
      throw new Error(`find ${mode} requires a query string`);
    }
    let exact = false;
    let nth = 0;
    for (let i = 1; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === "--exact") {
        exact = true;
      } else if (token === "--nth") {
        nth = Number(rest[i + 1] ?? "0");
        i += 1;
      } else {
        remaining.push(token);
      }
    }
    if (mode === "label") {
      locator = page.getByLabel(query, { exact }).nth(nth);
    } else if (mode === "text") {
      locator = page.getByText(query, { exact }).nth(nth);
    } else {
      locator = page.getByTestId(query).nth(nth);
    }
  } else {
    throw new Error(`Unsupported find mode: ${mode}`);
  }

  const [action, ...actionArgs] = remaining;
  if (!action) {
    throw new Error(
      `find ${mode} requires an action (click, fill, type, hover, scrollintoview, text)`,
    );
  }
  switch (action) {
    case "click":
      await locator.click({ timeout });
      return "";
    case "hover":
      await locator.hover({ timeout });
      return "";
    case "scrollintoview":
      await locator.scrollIntoViewIfNeeded({ timeout });
      return "";
    case "fill":
      await locator.fill(actionArgs.join(" "), { timeout });
      return "";
    case "type":
      await locator.click({ timeout });
      await page.keyboard.type(actionArgs.join(" "));
      return "";
    case "text":
      return (await locator.textContent({ timeout })) ?? "";
    case "wait":
      await locator.waitFor({ state: "visible", timeout });
      return "";
    default:
      throw new Error(`Unsupported find action: ${action}`);
  }
}

async function executeCommand(page, args, timeout) {
  const [command, ...rest] = args;
  if (!command) {
    throw new Error("Missing browser command");
  }
  switch (command) {
    case "open": {
      const url = rest[0];
      if (!url) throw new Error("open requires a URL");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      return "";
    }
    case "reload": {
      await page.reload({ waitUntil: "domcontentloaded", timeout });
      return "";
    }
    case "get": {
      const [what, target] = rest;
      if (what === "url") return page.url();
      if (what === "title") return await page.title();
      if (what === "text") {
        if (!target) throw new Error("get text requires a target");
        return (
          (await resolveTarget(page, target)
            .first()
            .textContent({ timeout })) ?? ""
        );
      }
      if (what === "value") {
        if (!target) throw new Error("get value requires a target");
        return await resolveTarget(page, target)
          .first()
          .inputValue({ timeout });
      }
      throw new Error(`Unsupported get target: ${String(what)}`);
    }
    case "set": {
      const [what, w, h] = rest;
      if (what === "viewport") {
        const width = Number(w);
        const height = Number(h);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          throw new Error("set viewport requires numeric width and height");
        }
        await page.setViewportSize({ width, height });
        return "";
      }
      throw new Error(`Unsupported set target: ${String(what)}`);
    }
    case "screenshot": {
      let fullPage = false;
      let outPath;
      for (const token of rest) {
        if (token === "--full" || token === "--full-page") {
          fullPage = true;
        } else {
          outPath = token;
        }
      }
      if (!outPath) throw new Error("screenshot requires an output path");
      const resolved = path.resolve(outPath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await page.screenshot({ path: resolved, fullPage });
      return resolved;
    }
    case "snapshot": {
      const interactiveOnly =
        rest.includes("-i") || rest.includes("--interactive");
      return await runSnapshot(page, interactiveOnly);
    }
    case "wait": {
      if (rest[0] === "--load") {
        const state = rest[1] ?? "load";
        await page.waitForLoadState(state, { timeout });
        return "";
      }
      if (rest[0] === "--text") {
        const text = rest[1];
        if (text === undefined) throw new Error("wait --text requires text");
        await page
          .getByText(text)
          .first()
          .waitFor({ state: "visible", timeout });
        return "";
      }
      if (rest[0] === "--fn") {
        const expr = rest[1];
        if (!expr) throw new Error("wait --fn requires an expression");
        await page.waitForFunction(expr, undefined, { timeout });
        return "";
      }
      const target = rest[0];
      if (!target) throw new Error("wait requires a selector or flag");
      await resolveTarget(page, target).first().waitFor({
        state: "visible",
        timeout,
      });
      return "";
    }
    case "click": {
      const target = rest[0];
      if (!target) throw new Error("click requires a target");
      await resolveTarget(page, target).first().click({ timeout });
      return "";
    }
    case "hover": {
      const target = rest[0];
      if (!target) throw new Error("hover requires a target");
      await resolveTarget(page, target).first().hover({ timeout });
      return "";
    }
    case "scrollintoview": {
      const target = rest[0];
      if (!target) throw new Error("scrollintoview requires a target");
      await resolveTarget(page, target)
        .first()
        .scrollIntoViewIfNeeded({ timeout });
      return "";
    }
    case "fill": {
      const [target, ...valueParts] = rest;
      if (!target) throw new Error("fill requires a target and value");
      await resolveTarget(page, target).first().fill(valueParts.join(" "), {
        timeout,
      });
      return "";
    }
    case "type": {
      const [target, ...valueParts] = rest;
      if (!target) throw new Error("type requires a target and value");
      await resolveTarget(page, target).first().click({ timeout });
      await page.keyboard.type(valueParts.join(" "));
      return "";
    }
    case "keyboard": {
      if (rest[0] === "type") {
        await page.keyboard.type(rest.slice(1).join(" "));
        return "";
      }
      if (rest[0] === "press") {
        await page.keyboard.press(rest[1] ?? "");
        return "";
      }
      throw new Error(`Unsupported keyboard subcommand: ${String(rest[0])}`);
    }
    case "press": {
      const key = rest[0];
      if (!key) throw new Error("press requires a key name");
      await page.keyboard.press(key);
      return "";
    }
    case "eval": {
      const expr = rest.join(" ");
      if (!expr) throw new Error("eval requires a JavaScript expression");
      const value = await page.evaluate((source) => (0, eval)(source), expr);
      return value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2);
    }
    case "find": {
      return await executeFind(page, rest, timeout);
    }
    default:
      throw new Error(`Unsupported browser command: ${command}`);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function cmdServe(stateFile) {
  if (!stateFile) {
    fail("serve requires --state-file <path>", 2);
  }
  const browser = await launchChromium();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const token = randomBytes(24).toString("hex");
  let queue = Promise.resolve();
  let closing = false;

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await rm(stateFile, { force: true }).catch(() => undefined);
    process.exit(0);
  };

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          pid: process.pid,
          url: page.url(),
        }),
      );
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }
    if (req.method === "POST" && url === "/close") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      void shutdown();
      return;
    }
    if (req.method === "POST" && url === "/cmd") {
      queue = queue
        .then(async () => {
          const body = await readJsonBody(req);
          const timeout =
            Number.isFinite(body.timeoutMs) && body.timeoutMs > 0
              ? body.timeoutMs
              : DEFAULT_TIMEOUT_MS;
          const stdout = await executeCommand(page, body.args ?? [], timeout);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, stdout }));
        })
        .catch((error) => {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const tmpFile = `${stateFile}.tmp.${process.pid}`;
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(
    tmpFile,
    `${JSON.stringify({ pid: process.pid, port, token, started_at: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(tmpFile, 0o600);
  await rename(tmpFile, stateFile);

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

async function readSessionState(stateFile) {
  if (!existsSync(stateFile)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    return null;
  }
}

async function probeSession(state) {
  if (!state?.port || !isPidAlive(state.pid)) {
    return false;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/healthz`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureSession(stateFile, logFile) {
  const existing = await readSessionState(stateFile);
  if (await probeSession(existing)) {
    return existing;
  }
  await rm(stateFile, { force: true }).catch(() => undefined);
  await mkdir(path.dirname(logFile), { recursive: true });
  const fd = openSync(logFile, "a", 0o600);
  let childPid;
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "serve", "--state-file", stateFile],
      {
        cwd: REPO_ROOT,
        env: process.env,
        detached: true,
        stdio: ["ignore", fd, fd],
      },
    );
    childPid = child.pid;
    child.unref();
  } finally {
    closeSync(fd);
  }
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (childPid && !isPidAlive(childPid)) {
      const logTail = await readFile(logFile, "utf8").catch(() => "");
      throw new Error(
        `Playwright browser daemon exited before becoming ready:\n${logTail.trim()}`,
      );
    }
    const candidate = await readSessionState(stateFile);
    if (await probeSession(candidate)) {
      return candidate;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Playwright browser daemon");
}

async function cmdExec(stateFile, logFile, passthrough) {
  if (!stateFile) {
    fail("exec requires --state-file <path>", 2);
  }
  if (passthrough.length === 0) {
    fail("exec requires browser arguments after --", 2);
  }
  if (passthrough[0] === "close") {
    const existing = await readSessionState(stateFile);
    if (existing && (await probeSession(existing))) {
      await fetch(`http://127.0.0.1:${existing.port}/close`, {
        method: "POST",
        headers: { authorization: `Bearer ${existing.token}` },
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    }
    await rm(stateFile, { force: true }).catch(() => undefined);
    return;
  }

  const session = await ensureSession(
    stateFile,
    logFile ?? path.join(path.dirname(stateFile), "logs/browser.log"),
  );
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const response = await fetch(`http://127.0.0.1:${session.port}/cmd`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ args: passthrough, timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 10_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    fail(payload.error || `HTTP ${response.status}`);
  }
  if (payload.stdout) {
    process.stdout.write(
      payload.stdout.endsWith("\n") ? payload.stdout : `${payload.stdout}\n`,
    );
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const dashIndex = rest.indexOf("--");
  const head = dashIndex === -1 ? rest : rest.slice(0, dashIndex);
  const passthrough = dashIndex === -1 ? [] : rest.slice(dashIndex + 1);
  let stateFile;
  let logFile;
  for (let i = 0; i < head.length; i += 1) {
    if (head[i] === "--state-file") {
      stateFile = head[i + 1];
      i += 1;
    } else if (head[i] === "--log-file") {
      logFile = head[i + 1];
      i += 1;
    } else if (head[i] === "--help" || head[i] === "-h") {
      process.stdout.write(
        "Usage: playwright-browser-session.mjs (serve|exec) --state-file <path> [--log-file <path>] [-- <args...>]\n",
      );
      return;
    }
  }
  if (command === "serve") {
    await cmdServe(stateFile);
    return;
  }
  if (command === "exec") {
    await cmdExec(stateFile, logFile, passthrough);
    return;
  }
  fail(`Unknown command: ${String(command)}`, 2);
}

void main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
});
