# Navigation, Search, and Settings

## Sub-features

- Global navigation landmarks (`Primary navigation`: `Messages`, `Dashboard`, `Library`, `Wiki`, `Connectors`; `Room navigation`: `Jump anywhere`, `Who is awake`, `Surprise me`)
- Quick Jump page (`/t/:tenantId/jump` with combobox `Where do you want to go?` and listbox `Places`)
- Global Search modal (`Search` / `Search chats` trigger with combobox `Search messages, docs, people, agents and rooms` and `Esc` close button)
- Settings workspace (`/t/:tenantId/settings/*` with `Settings sections`: `Profile`, `Security`, `My Rules`, `Shortcuts`, `Computers`, `Local models`)

## How to get to it (user POV)

- Use `Primary navigation` or `Room navigation` in the left sidebar to switch surfaces, click `Search` (`Control+k` / `Meta+k`) for cross-entity lookup, or open `Account menu` -> `Settings` to inspect Profile, Security, My Rules, Shortcuts, Computers, and Local models.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, and browser session is signed in.

- **Jump anywhere**: Click link `Jump anywhere` in `Room navigation`, wait for heading `Jump` and `--fn "window.location.pathname.endsWith('/jump')"`, fill combobox `Where do you want to go?` with `Library` (or a newly created Room name), inspect filtered options inside listbox `Places`, and capture `jump.aria.txt` and `jump.png`.
- **Global Search dialog**: Click button `Search` (`Search chats`), wait for dialog `Search`, fill combobox `Search messages, docs, people, agents and rooms` with a known Room or message keyword, snapshot (`snapshot -i`) and screenshot (`search-dialog.png`), then click button `Esc` (or press `Escape`) to confirm clean modal dismissal.
- **Shortcuts filter in Settings**: Open `Account menu` -> `Settings`, snapshot `Settings sections`, click link `Shortcuts`, fill `Filter shortcuts` with `Search`, verify filtered shortcut rows remain visible, click `Clear shortcuts filter`, and capture `settings-shortcuts.png`.
- **Computers status matching Local Computer daemon**: Click link `Computers` inside `Settings sections`, wait for region `Verify Computer details` and status text `Codex` / `Ready`, capture `settings-computers.aria.txt` and `settings-computers.png`, and compare with `./.agents/skills/verify/scripts/verify-linger.mjs computer --run-id "<id>" -- daemon status --json`.

## Gotchas

- `Wiki` and `Connectors` routes depend on local service configuration (`llm-wiki` runs in Node Services; Composio personal keys stay unset unless configured). Treat unconfigured external connector states as expected unless testing a configured key.
- Re-snapshot immediately after opening `Search` or switching tabs inside `Settings sections` because modal portals and route outlets swap interactive refs.
