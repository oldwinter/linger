// Contract between the quick note capture window (app://quick-note) and the
// main process. The window only appends text to today's Pocket Note; it never
// sees the server session.

export type QuickNoteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface LingerQuickNoteApi {
  submit(text: string): Promise<QuickNoteResult>;
  cancel(): void;
}

export const QUICK_NOTE_IPC = {
  submit: "quick-note.submit",
  cancel: "quick-note.cancel",
} as const;
