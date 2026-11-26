# Documents and Library

Documents and Library covers navigating Library views, organizing folders, creating and editing native BlockNote Room Documents with durable WebSocket persistence through Document Runtime, and configuring public document link sharing.

## Sub-features

- Personal, shared, and meeting workspace navigation at `/t/:tenantId/library` (`Library views`: `My pages`, `Shared with me`, `Meetings`; `Library time views`: `This day`, `What changed this week`; `Recent` cards and browser-local `Recently opened` strip)
- Creating folders (`Create in My pages` -> `New folder`) and managing bulk actions (`Selected documents`: `Move to folder`, `Delete`, `Copy links`, `Clear selection`)
- Creating native Room Documents (`Create in My pages` -> `New file`) and opening `/t/:tenantId/documents/:documentId` alongside `Library sidebar`
- Toggling byline `Document mode` (`Edit mode` by default for writable Room Documents / `Read mode`), editing in BlockNote inside `section[aria-label="Room Document editor"]`, and verifying durable WebSocket persistence via `Document save status` and `data-room-document-durable-sequence`
- Sharing documents via byline `Share` -> `dialog "Share Document"` (`Link access`: `Disabled` / `Can view` / `Can edit`, `Reset link`, `Copy shared link`) and public viewing at `/shared-documents#<token>`

## How to get to it (user POV)

- Click `Library` inside `Primary navigation` to open `/t/:tenantId/library`.
- Use the `Create in My pages` menu button (visible text `New`) to add folders (`New folder`), native Room Documents (`New file`), or uploads (`Import`, `Upload folder`).
- Inside a Room, the **header** `More actions for <Room>` -> `Add a document` route (`/t/:tenantId/rooms/:roomId/add-document`) binds existing shareable Library documents into that Room, and the right-hand `Panel sidebar`'s `Files` launcher/tab lists already-bound `Room files`.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, `Document Runtime` (`/readyz` on `document_runtime_url`) is healthy, and browser session is signed in.

- **Navigate to Library**: Click `find role link --name "Library" --exact click` (or the `@e` ref in `Primary navigation`), wait for `--fn "window.location.pathname.endsWith('/library')"` and `--text "My pages"`, confirm `My pages`, `Shared with me`, and `Meetings` tabs render, and capture `library.aria.txt` and `library.png`.
- **Create a folder**: Click `Create in My pages`, click menuitem `New folder`, wait for `--text "Folder name"` (dialog prefills `textbox "Folder name"` with `New Folder`), fill `Folder name` with `Verification notes`, click `find role button --name "Create" --exact click`, and wait for `--text "Verification notes"`. Confirm `Open folder Verification notes` renders inside `My pages`.
- **Create, toggle byline mode, edit, and persist a Room Document**: Open `Create in My pages`, click menuitem `New file`, wait for `--fn "window.location.pathname.includes('/documents/')"`, and record `<documentId>` from `get url`. Wait for the collaboration session and byline controls to become ready:
  `wait --fn 'document.querySelector("section[aria-label=\"Room Document editor\"][data-editable=\"true\"]") !== null && document.querySelector("[data-room-document-save-status=\"Saved\"]") !== null && document.querySelector("button[aria-label=\"Document mode\"]") !== null'`.
  Writable native Room Documents omit the top header bar and place `Document save status`, `Share`, `More Document actions`, and `Document mode` on the byline under the auto-focused `Document title`. To verify mode switching, click `Document mode` -> click menuitem `Read` (`--exact`, confirm outer `<section>` flips `data-editable="false"`), then click `Document mode` -> click menuitem `Edit` (`--exact`, `data-editable="true"`). Click inside `section[aria-label="Room Document editor"] .bn-editor` (which commits/blurs the title), type a unique verification sentence (`keyboard type "Document runtime persistence check"`), and wait for the durable flush to advance beyond `0`:
  `wait --fn '(() => { const el = document.querySelector("[data-room-document-save-status]"); return el?.getAttribute("data-room-document-save-status") === "Saved" && Number(el.getAttribute("data-room-document-durable-sequence")) > 0; })()'`.
  Confirm visible `[role="status"][aria-label="Document save status"]` shows `Saved`.
- **Reload and cross-check storage**: Reload (`browser --run-id "<id>" -- reload`), wait for `--text "Document runtime persistence check"` and `section[aria-label="Room Document editor"][data-editable="true"]`, capture `document-persisted.aria.txt` and `document-persisted.png`, and cross-check second views:
  - `api --run-id "<id>" GET "/v0/tenants/<tenantId>/me/document-tree"` (confirm folder `Verification notes` and `<documentId>`)
  - `api --run-id "<id>" GET "/v0/documents/<documentId>"` (confirm `format: "blocknote"`, `status: "active"`)
  - `sql --run-id "<id>" "SELECT document_id, seq, octet_length(state) AS state_bytes, updated_at FROM document_bodies WHERE document_id = '<documentId>';"` (confirm `seq >= 1` and `state_bytes > 0`).
- **Enable document link sharing and cross-check SQL**: Click byline `find role button --name "Share" --exact click`, wait for `dialog[open]`, click `find role combobox --name "Link access" click`, click `find role option --name "Can view" click`, wait for `button[aria-label="Copy shared link"]`, capture `document-share.aria.txt` and `document-share.png`, verify `sql --run-id "<id>" "SELECT id, link_share_role, link_share_status, link_share_version FROM documents WHERE id = '<documentId>';"` reports `viewer` / `active` / `1`, then dismiss with `find role button --name "Close" --exact click`.

## Gotchas

- Never use `wait --load networkidle` on document pages because Hocuspocus maintains a persistent `/document-collaboration` WebSocket connection.
- `[data-room-document-save-status]` and `[data-room-document-durable-sequence]` sit on a `hidden` `<span hidden />` probe (`display: none`), so a bare `wait '[data-room-document-save-status="Saved"]'` times out waiting for visibility. Newly created documents also start at `"Saved"` with `seq = 0`, so always check both `status === "Saved"` and `Number(durableSequence) > prevSeq` via `--fn`. On read-only sessions, that hidden probe is not rendered (`[role="status"][aria-label="Document access mode"]` shows `Read only` instead), and save protocol failures render visible text `Couldn't save. Reload to retry.` while the hidden attribute stays `"Save protocol error"`.
- Editable native BlockNote documents render without a top `<header>` bar; `Document mode`, `Share`, and `More Document actions` live on the byline and mount only after BlockNote sets `canvasKnown = true`, so wait for `button[aria-label="Document mode"]` before toggling mode. `aria-label="Room Document editor"` and `data-editable="true"|"false"` live on the outer `<section class="room-document-blocknote">`, not on `.bn-editor`.
- Inside `Share Document`, `Reset link` and `Copy shared link` are icon-only buttons (`aria-label="Reset link"`, `aria-label="Copy shared link"`), so wait on `button[aria-label="Copy shared link"]` rather than `wait --text "Copy shared link"`. Revoked/invalid `/shared-documents` links are also covered offline by `pnpm test:e2e:smoke` (`tests/web-smoke.e2e.ts`).
- `Library` loading placeholders use skeleton regions (`role="status" aria-label="Loading documents…"`) without visible loading text, and the bulk bar's removal button is `Delete` (renamed from `Trash`).
- Creating a Room Document immediately inserts a `document_bodies` row at `seq = 0` with non-zero initial Yjs bytes, so checking `seq >= 1` for the specific `document_id` is required to prove Document Runtime persisted your edit.
- Keep Room Document edits plain text during baseline verification; avoid introducing conflicting multi-tab edits unless explicitly testing Yjs CRDT concurrency.
