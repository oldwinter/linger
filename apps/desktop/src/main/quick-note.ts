import {
  BrowserWindow,
  ipcMain,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Session,
} from "electron";
import { z } from "zod";

import type { components } from "@linger/wire-contracts/teamhub-public/types";

import { localizePage } from "../i18n/page.js";
import messagesHtml from "../shell/messages.html";
import quickNoteHtml from "../shell/quick-note.html";
import { quickNoteMessages } from "../shell/quick-note.messages.js";
import { QUICK_NOTE_IPC, type QuickNoteResult } from "../shared/quick-note.js";
import type { LanguageModule } from "./language.js";
import type { Module, ModuleContext } from "./modules.js";
import { currentShellColors, onShellThemeChange } from "./shell-theme.js";

type Schemas = components["schemas"];
type PocketNotePage = Schemas["PocketNotePage"];
type PocketNoteUpdateRequest = Schemas["PocketNoteUpdateRequest"];

export const QUICK_NOTE_URL = "app://quick-note/";
// Its own session: the capture window never sees the server's cookies.
const PARTITION = "linger-quick-note";
const REQUEST_TIMEOUT_MS = 30_000;
// Long enough to read the confirmation before the window goes away.
const CLOSE_DELAY_MS = 900;
const MAXIMUM_NOTE_LENGTH = 20_000;

const noteInput = z.string().max(MAXIMUM_NOTE_LENGTH);

export interface QuickNoteOptions {
  readonly preload: string;
  // Session cookie header of the signed-in web session, which the window
  // itself cannot see. Never logged.
  readonly sessionCookie: (serverUrl: string) => Promise<string | undefined>;
}

// The tray's "New Note" capture window. It appends the typed text to today's
// Pocket Note through TeamHub, using the web session's cookie.
export class QuickNoteModule implements Module {
  readonly name = "QuickNote";
  readonly dependsOn = ["Config", "Language"];
  readonly #options: QuickNoteOptions;
  #ctx: ModuleContext | undefined;
  #window: BrowserWindow | undefined;
  #closeTimer: NodeJS.Timeout | undefined;
  #submitQueue: Promise<unknown> = Promise.resolve();
  readonly #unsubscribe: (() => void)[] = [];

  constructor(options: QuickNoteOptions) {
    this.#options = options;
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.#ctx = ctx;
    const pages = this.#session();
    pages.protocol.handle("app", (request) => this.#serve(request));
    const fromCapture = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
      event.sender === this.#window?.webContents &&
      !!event.senderFrame?.url.startsWith(QUICK_NOTE_URL);
    const cancel = (event: IpcMainEvent): void => {
      if (!fromCapture(event)) return;
      this.#close();
    };
    ipcMain.handle(
      QUICK_NOTE_IPC.submit,
      (event: IpcMainInvokeEvent, text: unknown) => {
        if (!fromCapture(event)) throw new Error("Not allowed");
        return this.#submit(text);
      },
    );
    ipcMain.on(QUICK_NOTE_IPC.cancel, cancel);
    this.#unsubscribe.push(
      () => ipcMain.removeHandler(QUICK_NOTE_IPC.submit),
      () => ipcMain.removeListener(QUICK_NOTE_IPC.cancel, cancel),
      () => pages.protocol.unhandle("app"),
      onShellThemeChange((colors) => {
        if (this.#window && !this.#window.isDestroyed())
          this.#window.setBackgroundColor(colors.content);
      }),
      ctx.bus.on("language.changed", () => {
        if (this.#window && !this.#window.isDestroyed()) {
          this.#window.setTitle(this.#t(quickNoteMessages.pageTitle));
          this.#window.webContents.reload();
        }
      }),
    );
  }

  async stop(): Promise<void> {
    for (const off of this.#unsubscribe.splice(0)) off();
    this.#clearCloseTimer();
    this.#window?.destroy();
    this.#window = undefined;
  }

  show(): void {
    this.#clearCloseTimer();
    if (this.#window && !this.#window.isDestroyed()) {
      this.#window.show();
      this.#window.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 460,
      height: 240,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: this.#t(quickNoteMessages.pageTitle),
      backgroundColor: currentShellColors().content,
      ...(process.platform === "darwin" ? {} : { autoHideMenuBar: true }),
      webPreferences: {
        preload: this.#options.preload,
        session: this.#session(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    });
    const contents = window.webContents;
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });
    window.on("closed", () => {
      if (this.#window === window) this.#window = undefined;
      this.#clearCloseTimer();
    });
    this.#window = window;
    void window.loadURL(QUICK_NOTE_URL).catch(() => undefined);
  }

  #submit(value: unknown): Promise<QuickNoteResult> {
    const run = this.#submitQueue.then(async (): Promise<QuickNoteResult> => {
      const parsed = noteInput.safeParse(value);
      if (!parsed.success)
        return { ok: false, message: this.#t(quickNoteMessages.tooLong) };
      const note = parsed.data.trim();
      if (!note)
        return { ok: false, message: this.#t(quickNoteMessages.empty) };
      try {
        const result = await this.#appendToToday(note);
        if (result.ok) this.#closeSoon();
        return result;
      } catch (error) {
        this.#ctx?.log.warn("quick_note.failed", { error: String(error) });
        return { ok: false, message: this.#t(quickNoteMessages.saveFailed) };
      }
    });
    this.#submitQueue = run.catch(() => undefined);
    return run;
  }

  async #appendToToday(note: string): Promise<QuickNoteResult> {
    const ctx = this.#ctx!;
    const { serverUrl, tenantId } = ctx.config.get();
    if (!serverUrl || !tenantId)
      return { ok: false, message: this.#t(quickNoteMessages.notConnected) };
    const cookie = await this.#options.sessionCookie(serverUrl);
    if (!cookie)
      return { ok: false, message: this.#t(quickNoteMessages.notSignedIn) };
    const request = (
      pathname: string,
      init: { method?: string; body?: unknown } = {},
    ): Promise<Response> =>
      fetch(new URL(pathname, serverUrl), {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          cookie,
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    const base = `/v0/tenants/${encodeURIComponent(tenantId)}/me/pocket-notes`;
    const page = await request(base);
    if (page.status === 401)
      return { ok: false, message: this.#t(quickNoteMessages.sessionEnded) };
    if (!page.ok)
      return { ok: false, message: this.#t(quickNoteMessages.readFailed) };
    const body = (await page.json()) as PocketNotePage;
    if (typeof body.today !== "string" || !Array.isArray(body.items))
      return { ok: false, message: this.#t(quickNoteMessages.readFailed) };
    const today = body.items.find((item) => item.date === body.today)?.text;
    const text = today ? `${today.trimEnd()}\n\n${note}` : note;
    if (text.length > MAXIMUM_NOTE_LENGTH)
      return {
        ok: false,
        message: this.#t(quickNoteMessages.tooLongForToday),
      };
    const saved = await request(`${base}/today`, {
      method: "PUT",
      body: { text } satisfies PocketNoteUpdateRequest,
    });
    if (saved.status === 401)
      return { ok: false, message: this.#t(quickNoteMessages.sessionEnded) };
    if (!saved.ok)
      return { ok: false, message: this.#t(quickNoteMessages.saveFailed) };
    ctx.log.info("quick_note.saved", {});
    return { ok: true };
  }

  #closeSoon(): void {
    this.#clearCloseTimer();
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = undefined;
      this.#window?.close();
    }, CLOSE_DELAY_MS);
  }

  #clearCloseTimer(): void {
    if (this.#closeTimer) clearTimeout(this.#closeTimer);
    this.#closeTimer = undefined;
  }

  #close(): void {
    this.#clearCloseTimer();
    this.#window?.close();
  }

  #session(): Session {
    return session.fromPartition(PARTITION);
  }

  get #t() {
    return this.#ctx!.get<LanguageModule>("Language").t;
  }

  #serve(request: Request): Response {
    if (new URL(request.url).host !== "quick-note")
      return new Response(null, { status: 404 });
    const page = localizePage(
      quickNoteHtml,
      messagesHtml,
      quickNoteMessages,
      this.#ctx!.get<LanguageModule>("Language").current(),
    );
    return new Response(page, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
