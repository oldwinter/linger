# Room Document Web Boundary

- This directory owns the Room Product Client's Room Document editor surface,
  browser collaboration session, IndexedDB persistence, and user-visible
  save-state projection. Mark this moment keeps the current page as a history
  checkpoint. While you are reading further down, words someone else adds
  above that place do not move the sentence you are on. A comment whose
  sentence is rewritten stays on the words that are there now, between the
  same surrounding words. A character typed into a word someone else is
  writing lands after that word.
- TeamHub's public HTTP contract is the only source for Document metadata and
  collaboration credentials. A credential is a signed connection token, opaque
  to the browser; every reconnect asks TeamHub for a new one, because any
  permission change makes earlier tokens stale. The browser must not call
  TeamHub internal Document State operations or hold service credentials.
- Document Runtime owns Yjs WebSocket sync and awareness. Browser state is a
  recoverable local copy, never a second authority for permissions, durable
  sequence, publication, comments, assets, or lifecycle.
- `Saved` requires both local and remote hydration, an authenticated durable
  ACK, exact durable vector equality, and a newer durable sequence after any
  hydrated state change. Hocuspocus sync alone is never presented as durable
  save evidence. Full-state hashes remain server-side integrity evidence and
  must not be compared across independent browser and Runtime Y.Doc replicas.
- Keep protocol and persistence lifecycle behind the collaboration-session
  interface. React components render that interface and must not parse durable
  ACK envelopes or construct IndexedDB keys themselves.
- Editor DOM listeners retain the element they were attached to for cleanup.
  BlockNote may release its editor view before a React effect cleans up.
- Document title editing ignores Enter and Escape during input-method
  composition, then handles submission or cancellation after composition ends.
- Closing native Document comments protects unsent comments, replies, and
  changed comment text. The Comments toggle and Close comments ask before
  discarding input and default to continuing the edit. A pending request blocks
  closing; a failed request keeps the input and error available for retry.
  Protection ends when a composer succeeds or leaves the panel. Explicit
  editor Cancel discards that edit. Anchor reselection retains its own lifecycle;
  panel protection does not persist drafts across navigation or revive an old
  selection.
- Page history stays within the viewport. Its checkpoint list and preview
  scroll independently, with stacked panes on narrow portrait screens and
  side-by-side panes in landscape, so older checkpoints and Restore remain
  reachable.
- Only an editing session keeps a local copy, one per Actor and Document; a
  reopened session saves it under its new token. `room-document-local-copies.ts`
  owns copy names and deletion: a Document's copies go when TeamHub denies
  access to it, and an account's copies go at logout. Close this tab's sessions on a copy before
  deleting it, and close on `versionchange` so other tabs never block a
  deletion. It stays free of editor dependencies because logout imports it.
- A readable Document's header may send it to a Room as one Message carrying
  the Document's title and canonical link. The content stays in the Document;
  the Message copies none of it, and the send reuses its idempotency key only
  when retrying the same Room. A Room that refuses the post keeps the picker
  open with the server's message rather than being dropped from the list.
- Test state invariants through the collaboration-session interface and test
  the real browser workflow with Playwright. Do not inspect provider or
  IndexedDB internals from component tests.
