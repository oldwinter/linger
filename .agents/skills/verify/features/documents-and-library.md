# Documents and Library

## Sub-features

- Personal and shared workspace tree navigation at `/t/:tenantId/library`
- Creating folders (`New` -> `New folder`) inside `My pages`
- Creating native Room Documents (`New` -> `New file`) and opening `/t/:tenantId/documents/:documentId`
- Toggling `Document mode` (`Read mode` / `Edit mode`), editing in BlockNote (`Room Document editor`), and waiting for `Document save status` (`Saved`) via Document Runtime WebSocket persistence

## How to get to it (user POV)

- Click `Library` inside `Primary navigation` to open `/t/:tenantId/library`.
- Use the `Create in My pages` action menu (`New`) to add folders or native Room Documents, or click `Add a document` from a Room's `More actions for <Room>` menu and sidebar `Documents` panel.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, `Document Runtime` (`/readyz` on `document_runtime_url`) is healthy, and browser session is signed in.

- **Navigate to Library**: Click link `Library` inside `Primary navigation`, wait for heading `Library`, and capture `library.aria.txt` and `library.png`.
- **Create a folder**: Open menu button `Create in My pages` (`New`), snapshot (`snapshot -i`), click menuitem `New folder`, fill textbox `Folder name` with `Verification notes`, click button `Create`, and wait for `--text "Verification notes"`. Confirm the folder renders inside `My pages`.
- **Create, edit, and persist a Room Document**: Open `Create in My pages` (`New`), click menuitem `New file`, wait for `--fn "window.location.pathname.includes('/documents/')"`, and record `<documentId>` from `get url`. If the document opens in read mode, open `Document mode` (`Read mode`), click menuitem `Edit`, then click inside `.bn-editor` (`Room Document editor`), type a unique verification sentence (such as `Document runtime persistence check`), and wait for `[data-room-document-save-status="Saved"]`.
- **Reload and cross-check storage**: Reload the page (`browser --run-id "<id>" -- reload`), wait for `--text "Document runtime persistence check"`, capture `document-persisted.aria.txt` and `document-persisted.png`, and run read-only `sql --run-id "<id>" "SELECT document_id, seq, octet_length(state) AS state_bytes, updated_at FROM document_bodies ORDER BY updated_at DESC LIMIT 5;"`. Observe non-zero persisted Yjs state backing the rendered document.

## Gotchas

- Never use `wait --load networkidle` on document pages because Hocuspocus maintains a persistent `/document-collaboration` WebSocket connection. Wait on `[data-room-document-save-status="Saved"]` instead.
- Check whether `Document mode` currently reads `Read mode` or `Edit mode` before typing: `.bn-editor` has `data-editable="false"` until switched to `Edit`.
- Keep Room Document edits plain text during baseline verification; avoid introducing conflicting multi-tab edits unless explicitly testing Yjs CRDT concurrency.
