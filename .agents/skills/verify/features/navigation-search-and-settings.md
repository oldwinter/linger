# Navigation, Search, and Settings

## Sub-features

- Global navigation landmarks (`Primary navigation`: `Messages`, `Dashboard`, `Library`, `Wiki`, `Connectors`, `Search`, `Account menu`; `Room navigation` on `/t/:tenantId/rooms*`: icon `Search`, `Jump anywhere` / visible `Jump`, `Who is awake` / visible `Awake`, `Surprise me` / visible `Surprise`)
- Quick Jump page (`/t/:tenantId/jump` with combobox `Where do you want to go?` and listbox `Places`)
- Global Search modal (`Search` trigger / `Control+k` / `Meta+k` with combobox `Search messages, docs, people, agents and rooms` and `Close search` button with visible text `Esc`)
- Settings workspace (`/t/:tenantId/settings/*` with 7 `Settings sections`: `Profile`, `Security`, `My Rules`, `Shortcuts`, `Computers`, `Models`, `Language`)
- `Wiki` (`/t/:tenantId/library/wiki` with `Profile` and `Wiki` tabs) and `Connectors` (`/t/:tenantId/apps` with category tabs including `Web search`)

## How to get to it (user POV)

- Use `Primary navigation` (always mounted) or `Room navigation` (mounted on `/t/:tenantId/rooms*`) in the left sidebar to switch surfaces, click `Search` (`Control+k` / `Meta+k`) for cross-entity lookup, or open `Account menu` -> `Settings` to inspect Profile, Security, My Rules, Shortcuts, Computers, Models, and Language.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, and browser session is signed in.

- **Jump anywhere**: From a Room route (`/t/<tenantId>/rooms/...`), click link `Jump anywhere` in `Room navigation` (by `@e` ref), wait for `--fn "window.location.pathname.endsWith('/jump')"` and heading `Jump`, fill combobox `Where do you want to go?` with `Models` and `Library` (or a newly created Room name), inspect filtered options inside listbox `Places`, and capture `jump.aria.txt` and `jump.png`.
- **Global Search dialog**: Click `button "Search"` in `Primary navigation` (by `@e` ref, or press `Control+k` / `Meta+k`), re-snapshot, fill combobox `Search messages, docs, people, agents and rooms` with a known Room or message keyword (>= 2 chars for backend message hits), snapshot (`snapshot -i`) and screenshot (`search-dialog.png`), then click button `Close search` (visible text `Esc`) or press `Escape` to confirm clean modal dismissal. Cross-check message hits with `api --run-id "<id>" GET "/v0/tenants/<tenantId>/messages/search?q=<keyword>&limit=20"`.
- **Settings sections, Shortcuts, Models, and Language**: Open `Account menu` -> `Settings`, snapshot `Settings sections` and confirm all 7 links (`Profile`, `Security`, `My Rules`, `Shortcuts`, `Computers`, `Models`, `Language`). Click `Shortcuts`, fill searchbox `Filter shortcuts` with `Search`, verify filtered shortcut rows remain visible, capture `settings-shortcuts.png`, and click `Clear shortcuts filter`. Optionally click `Models` (`/settings/models`; `/settings/local-models` redirects here) and `Language` (`/settings/language`, `combobox "Interface language"` showing `English`).
- **Computers status matching Local Computer daemon**: Click link `Computers` inside `Settings sections`, wait for `region "Verify Computer details"` and status text `Codex` / `Ready` (in default fixture mode), capture `settings-computers.aria.txt` and `settings-computers.png`, and cross-check with both `api --run-id "<id>" GET "/v0/tenants/<tenantId>/local-computers"` and `./.agents/skills/verify/scripts/verify-linger.mjs computer --run-id "<id>" -- daemon status --json`.
- **Wiki and Connectors smoke**: Click `Wiki` (`/t/<tenantId>/library/wiki`) to confirm `Profile` and `Wiki` tabs render without error alerts; click `Connectors` (`/t/<tenantId>/apps`) to confirm `Search connectors` and category tabs including `Web search` render cleanly.

## Gotchas

- `Search chats` only renders inside the desktop shell, never on Web. On Web Room routes, two `button "Search"` controls exist (one in `Primary navigation` and one icon button in `Room navigation`), so target by `@e` ref from `snapshot -i`.
- The Global Search modal's close button has accessible name `Close search` (`aria-label="Close search"`) and visible text `Esc`; match `button "Close search"` rather than `button "Esc"`.
- `Room navigation` only mounts on `/t/:tenantId/rooms*` routes, and its shortcut links display compact visible labels (`Jump`, `Awake`, `Surprise`) with full `aria-label`s (`Jump anywhere`, `Who is awake`, `Surprise me`).
- `Settings` renamed `Local models` to `Models` (`/t/:tenantId/settings/models`; `/local-models` redirects) and added `Language` (`/t/:tenantId/settings/language`, offering English and Simplified Chinese).
- `Codex` / `Ready` on the `Computers` page reflects default fixture mode; under `--live-provider`, the UI displays whichever host runtime is ready.
- `Wiki` runs via `llm-wiki` in Node Services. On `Connectors`, OAuth app connections stay unconfigured until `COMPOSIO_API_KEY` is set (expected by default), while the `Web search` section loads independently and offers DuckDuckGo without an API key.
- Re-snapshot immediately after opening `Search` or switching tabs inside `Settings sections` because modal portals and route outlets swap interactive refs.
