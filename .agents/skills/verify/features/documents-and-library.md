# Documents and Library

## Sub-features

- Personal, shared, and meeting workspace navigation at `/t/:tenantId/library` (`Library views`: `My pages`, `Shared with me`, `Meetings`, plus `Library time views`: `This day`, `What changed this week`)
- Creating folders (`Create in My pages` -> `New folder`) inside `My pages`
- Creating native Room Documents (`Create in My pages` -> `New file`) and opening `/t/:tenantId/documents/:documentId`
- Toggling `Document mode` (`Edit mode` by default for writable Room Documents / `Read mode`), editing in BlockNote inside `section[aria-label="Room Document editor"]`, and verifying durable WebSocket persistence via `Document save status` and `data-room-document-durable-sequence`

## How to get to it (user POV)

- Click `Library` inside `Primary navigation` to open `/t/:tenantId/library`.
- Use the `Create in My pages` menu button (visible text `New`) to add folders or native Room Documents.
- Inside a Room, the **header** `More actions for <Room>` -> `Add a document` route (`/t/:tenantId/rooms/:roomId/add-document`) binds existing shareable Library documents into that Room, and the right-hand `Panel sidebar`'s `Documents` (`Files` tab) lists already-bound `Room files`.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, `Document Runtime` (`/readyz` on `document_runtime_url`) is healthy, and browser session is signed in.

- **Navigate to Library**: Click link `Library` inside `Primary navigation` (via `@e` ref from `snapshot -i`), wait for `--fn "window.location.pathname.endsWith('/library')"` and `--text "Library"`, verify `My pages`, `Shared with me`, and `Meetings` tabs render, and capture `library.aria.txt` and `library.png`.
- **Create a folder**: Click button `Create in My pages`, snapshot (`snapshot -i`), click menuitem `New folder`, wait for heading `New folder` (dialog prefills `textbox "Folder name"` with `New Folder`), fill `Folder name` with `Verification notes`, click button `Create`, and wait for `--text "Verification notes"`. Confirm `Open folder Verification notes` renders inside `My pages`.
- **Create, toggle mode, edit, and persist a Room Document**: Open `Create in My pages`, snapshot, click menuitem `New file`, wait for `--fn "window.location.pathname.includes('/documents/')"`, and record `<documentId>` from `get url`. Wait for the collaboration session to become editable:
  `wait --fn 'document.querySelector("section[aria-label=\"Room Document editor\"][data-editable=\"true\"]") !== null && document.querySelector("[data-room-document-save-status=\"Saved\"]") !== null'`.
  Writable native Room Documents open in `Edit mode` with `Document title` auto-focused. To verify mode switching, open `Document mode` -> click menuitem `Read` (confirm outer `<section>` flips `data-editable="false"` and trigger reads `Read mode`), then open `Document mode` -> click menuitem `Edit` (`data-editable="true"`). Click inside `section[aria-label="Room Document editor"] .bn-editor` (which commits/blurs the title), type a unique verification sentence (`keyboard type "Document runtime persistence check"`), and wait for the durable flush to advance beyond `0`:
  `wait --fn '(() => { const el = document.querySelector("[data-room-document-save-status]"); return el?.getAttribute("data-room-document-save-status") === "Saved" && Number(el.getAttribute("data-room-document-durable-sequence")) > 0; })()'`.
  Confirm visible `[role="status"][aria-label="Document save status"]` shows `Saved`.
- **Reload and cross-check storage**: Reload the page (`browser --run-id "<id>" -- reload`), wait for `--text "Document runtime persistence check"` and `section[aria-label="Room Document editor"][data-editable="true"]`, capture `document-persisted.aria.txt` and `document-persisted.png`, and cross-check second views:
  - `api --run-id "<id>" GET "/v0/tenants/<tenantId>/me/document-tree"` (confirm folder `Verification notes` and `<documentId>`)
  - `api --run-id "<id>" GET "/v0/documents/<documentId>"` (confirm `format: "blocknote"`, `status: "active"`)
  - `sql --run-id "<id>" "SELECT document_id, seq, octet_length(state) AS state_bytes, updated_at FROM document_bodies WHERE document_id = '<documentId>';"` (confirm `seq >= 1` and `state_bytes > 0`).

## Gotchas

- Never use `wait --load networkidle` on document pages because Hocuspocus maintains a persistent `/document-collaboration` WebSocket connection.
- `[data-room-document-save-status]` and `[data-room-document-durable-sequence]` sit on a `hidden` `<span hidden />` probe (`display: none`), so a bare `wait '[data-room-document-save-status="Saved"]'` times out waiting for visibility. In addition, newly created documents start at `"Saved"` with `seq = 0`, so always use `--fn` checking both `status === "Saved"` and `Number(durableSequence) > prevSeq`.
- `aria-label="Room Document editor"` and `data-editable="true"|"false"` live on the outer `<section class="room-document-blocknote">`, not on `.bn-editor`. Writable Room Documents default to `Edit mode` (starting `data-editable="false"` only while WebSocket hydration finishes), and `New file` auto-focuses `input[aria-label="Document title"]` until you click `.bn-editor` or press `Enter`.
- `Folder name` in the `New folder` modal is an `aria-label` (not visible label text), so wait on heading `New folder` or `snapshot -i` rather than `wait --text "Folder name"`.
- Creating a Room Document immediately inserts a `document_bodies` row at `seq = 0` with non-zero initial Yjs bytes, so checking `seq >= 1` for the specific `document_id` is required to prove Document Runtime persisted your edit.
- Keep Room Document edits plain text during baseline verification; avoid introducing conflicting multi-tab edits unless explicitly testing Yjs CRDT concurrency.
