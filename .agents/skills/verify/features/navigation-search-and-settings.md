# Navigation, Search, and Settings

Navigation, Search, and Settings covers global workspace rails, Quick Jump filtering, Global Search across entities, the seven Settings sections (with `My Rules` covered in detail in [proactive-rules.md](proactive-rules.md)), Wiki browsing, and Connectors (`Web search`).

## Sub-features

- Global navigation landmarks (`Primary navigation` in exact order: `Messages`, `Library`, `Wiki`, `Dashboard`, `Connectors`, `Search`, `Account menu`, plus `Expand sidebar`/`Collapse sidebar`; `Room navigation` on `/t/:tenantId/rooms*`: `Quiet reminders`, `Pocket Notes`, `Room list actions`, icon `Search`, and `Room shortcuts` `Jump anywhere`/`Jump`, `Who is awake`/`Awake`, `Surprise me`/`Surprise`)
- Quick Jump page (`/t/:tenantId/jump` with combobox `Where do you want to go?` and listbox `Places`)
- Global Search modal (`Search` trigger / `Control+k` / `Meta+k` with combobox `Search messages, docs, people, agents and rooms` and `Close search` button with visible text `Esc`)
- Settings workspace (`/t/:tenantId/settings/*` with 7 `Settings sections`: `Profile`, `Security`, `My Rules`, `Shortcuts`, `Computers`, `Models`, `Language`)
- `Wiki` (`/t/:tenantId/library/wiki` with `Profile` and `Wiki` tabs) and `Connectors` (`/t/:tenantId/apps` with `Search connectors`, `Connected only`, and category tabs including `Web search`)

## How to get to it (user POV)

- Use `Primary navigation` (always mounted) or `Room navigation` (mounted on `/t/:tenantId/rooms*`) in the left sidebar to switch surfaces, press `Control+k` / `Meta+k` (or click `Search`) for cross-entity lookup, press `Control+j` / `Meta+j` (or click `Jump anywhere`) for Quick Jump, or open `Account menu` -> `Settings` to inspect `Profile`, `Security`, `My Rules`, `Shortcuts`, `Computers`, `Models`, and `Language`.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, and browser session is signed in.

- **Jump anywhere**: From a Room route (`/t/<tenantId>/rooms/...`), click `find role link --name "Jump anywhere" click`, wait for `--fn "window.location.pathname.endsWith('/jump')"`, fill `find role combobox --name "Where do you want to go?" fill "Models"`, wait for `[role="listbox"][aria-label="Places"]`, inspect filtered options, and capture `jump.aria.txt` and `jump.png`.
- **Global Search dialog**: Press `Control+k` (or click `button "Search"` in `Primary navigation` by `@e` ref), wait for `input[aria-label="Search messages, docs, people, agents and rooms"]`, fill with a known Room or message keyword (`>= 2` chars for backend message hits, e.g. `Verify`), capture `search-dialog.aria.txt` and `search-dialog.png`, then click `find role button --name "Close search" click` (visible text `Esc`) and wait for `--fn "document.querySelector('dialog[open]') === null"`. Cross-check message hits with `api --run-id "<id>" GET "/v0/tenants/<tenantId>/messages/search?q=<keyword>&limit=20"`.
- **Settings sections, Shortcuts, Models, and Language**: Open `Account menu` -> `Settings`, wait for `/settings/account`, snapshot `Settings sections` and confirm all 7 links (`Profile`, `Security`, `My Rules`, `Shortcuts`, `Computers`, `Models`, `Language`). Click `Shortcuts`, fill searchbox `Filter shortcuts` with `Search`, capture `settings-shortcuts.png`, and click `Clear shortcuts filter`. Click `Models` (`/settings/models`; `/settings/local-models` redirects here) and confirm `Local model` and `BYOK` tabs render; click `Language` (`/settings/language`) and confirm `Saved on this device.` and `combobox "Interface language"` (`English`).
- **Computers status matching Local Computer daemon**: Click link `Computers` inside `Settings sections`, wait for `[role="region"][aria-label="Verify Computer details"]` and `--text "Ready"` (showing `Connected` and `Codex` in default fixture mode, plus `What this Mac can do` on macOS), capture `settings-computers.aria.txt` and `settings-computers.png`, and cross-check with both `api --run-id "<id>" GET "/v0/tenants/<tenantId>/local-computers"` and `./.agents/skills/verify/scripts/verify-linger.mjs computer --run-id "<id>" -- daemon status --json`.
- **Wiki and Connectors smoke**: Click `find role link --name "Wiki" --exact click` (`/t/<tenantId>/library/wiki`), confirm `Profile` and `Wiki` tabs render with zero `[role="alert"]` elements, and capture `wiki.aria.txt` and `wiki.png`. Click `find role link --name "Connectors" --exact click` (`/t/<tenantId>/apps`), wait for `input[aria-label="Search connectors"]`, click `find role tab --name "Web search" click`, confirm `DuckDuckGo` renders, capture `connectors.aria.txt` and `connectors.png`, and cross-check `api --run-id "<id>" GET "/v0/web-search/backends"`.

## Gotchas

- `Search chats`, Settings `Save diagnostics…`, and Computers `Power` / `Prevent sleep` only mount inside the Desktop shell, never on Web. On Web Room routes, two `button "Search"` controls exist (one in `Primary navigation` and one icon button in `Room navigation`), so target by `@e` ref from `snapshot -i` or press `Control+k`.
- Click-opened `ActionMenu` and `Select` popovers (such as `Account menu` or `Interface language`) suppress click-through when dismissed by an outside click; press `Escape` or click twice before clicking another control.
- `Verify Computer details` renders as `<div role="region" aria-label="Verify Computer details">`, not `<section>`; match `[role="region"][aria-label="Verify Computer details"]`.
- The Global Search modal's close button has accessible name `Close search` (`aria-label="Close search"`) and visible text `Esc`; match `button "Close search"` rather than `button "Esc"`.
- `Room navigation` only mounts on `/t/:tenantId/rooms*` routes, and its shortcut links display compact visible labels (`Jump`, `Awake`, `Surprise`) with full `aria-label`s (`Jump anywhere`, `Who is awake`, `Surprise me`).
- `Settings` `Profile`, `Security`, and `Language` have no page subtitles; `Models` (`/t/:tenantId/settings/models`; `/local-models` redirects) shows its subtitle only in subscription mode and uses an icon-only `button "Recheck memory"`.
- `Codex` / `Ready` on the `Computers` page reflects default fixture mode; under `--live-provider` with multiple ready runtimes, the chip prioritizes the active `model-source` runtime, then Another Me's runtime, then the most-used Agent runtime.
- `Wiki` runs via `llm-wiki` in Node Services. On `Connectors`, OAuth app connections stay unconfigured until `COMPOSIO_API_KEY` is set (expected by default, and `feishu_mail` is excluded from the public grid), while `Web search` loads independently and defaults to DuckDuckGo without an API key.
- Re-snapshot immediately after opening `Search` or switching tabs inside `Settings sections` because modal portals and route outlets swap interactive refs.
