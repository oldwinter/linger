# Work Items and Dashboard

## Sub-features

- Viewing active work items and exporting (`Export & share`) at `/t/:tenantId/dashboard`
- Creating issues from the Dashboard (`New issue` dialog with `Title`, `Description`, `Issue priority`, `Origin Room`)
- Inspecting and mutating Work Items in the `WorkItemPeek` modal drawer (`Open full page`, `Archive`, `Unarchive`) opened from a board card, and viewing the read-only full-page story at `/t/:tenantId/work-items/:workItemId`
- Handing work off directly from a Room (`/t/:tenantId/rooms/:roomId/hand-off`) and jumping to the resulting Dashboard item (`See it on the dashboard`)

## How to get to it (user POV)

- Click `Dashboard` in `Primary navigation` to open `/t/:tenantId/dashboard` and use `New issue` to create tracked work.
- Clicking a board card opens `WorkItemPeek` (modal drawer) in place; clicking `Open full page` inside `WorkItemPeek` navigates to the read-only story page `/t/:tenantId/work-items/:workItemId`.
- From an active Room, open the Room **header** `More actions for <Room>` menu -> `Hand off` to navigate to `/t/:tenantId/rooms/:roomId/hand-off`, enter what needs doing, and hand it to the target member.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, and browser session is signed in.

- **Create issue on Dashboard**: Click link `Dashboard` in `Primary navigation`, wait for `--fn "window.location.pathname.endsWith('/dashboard')"` and `--text "Dashboard"`, and snapshot (`snapshot -i`). Click the header `button "New issue"` by `@e` ref (an empty board renders two `New issue` buttons), fill textbox `Title` with `Verify dashboard persistence`, optionally fill `Description`, leave or set `Issue priority`, and click button `Create issue`. Wait for `--fn "/\\/t\\/[^/]+\\/dashboard\\/[^/]+$/.test(window.location.pathname)"` and `--text "Verify dashboard persistence"`, and record `<workItemId>` from the URL. Creating an issue focuses the card on `/t/:tenantId/dashboard/<workItemId>` with `WorkItemPeek` closed.
- **Inspect `WorkItemPeek`, archive/unarchive across reload, and open full-page story**: Snapshot (`snapshot -i`), click the board card link matching `Verify dashboard persistence` to open `WorkItemPeek`, and capture `work-item.aria.txt` and `work-item.png`. Click the exact `@e` ref for button `Archive` inside `WorkItemPeek`, wait for button `Unarchive`, then reload (`browser --run-id "<id>" -- reload`). Reload closes `WorkItemPeek` while keeping the deep-linked card visible on `/dashboard/<workItemId>`; re-snapshot, re-click the card link, and confirm button `Unarchive` persisted. Click `Unarchive` by `@e` ref, wait for `Archive`, then click link `Open full page` (`@e` ref) and verify URL transitions to `/t/:tenantId/work-items/<workItemId>` showing the read-only story (`What happened`, `Back to the Dashboard`, and no `Archive`/`Unarchive` buttons).
- **Hand off from a Room**: Inside a non-thread Room with another participant (for example `Release verification room`, `Linger`'s direct Room, or starter Room `Getting Started`), snapshot (`snapshot -i`) and click the `@e` ref for `More actions for <Room>` inside `region "Room <Room>"` (the Room header, not the sidebar row). Snapshot, click menuitem `Hand off`, wait for `--fn "window.location.pathname.endsWith('/hand-off')"`, fill textbox `What needs doing` with `Follow up on room verification`, snapshot, click button `Hand it to <name>`, wait for `--text "See it on the dashboard"`, capture `hand-off.aria.txt` and `hand-off.png`, and click the `@e` ref for link `See it on the dashboard` to confirm it lands on `/t/:tenantId/dashboard/<workItemId>`.
- **Cross-check TeamHub / PostgreSQL**: Run read-only `api --run-id "<id>" GET "/v0/tenants/<tenantId>/work-items"` (defaults to `archived=false`; add `?archived=true` to include archived items), `api --run-id "<id>" GET "/v0/work-items/<workItemId>"`, and `sql --run-id "<id>" "SELECT id, number, title, state, priority, archived_at FROM work_items ORDER BY created_at DESC LIMIT 5;"` to confirm persisted records match the UI.

## Gotchas

- An empty Dashboard renders two `button "New issue"` controls (header and empty state). Target the header button by `@e` ref from `snapshot -i`.
- Never use unscoped `find role button click --name "Archive"` while `WorkItemPeek` is open: it can substring-match the board's `button "Archived"` filter behind the modal and dismiss the drawer. Click `Archive` and `Unarchive` by their exact `@e` refs from `snapshot -i`.
- `/t/:tenantId/dashboard/:workItemId` renders the board with that card focused (drawer closed), whereas `/t/:tenantId/work-items/:workItemId` (`Open full page`) is a strictly read-only story view without `Archive`/`Unarchive`. Reloading always closes `WorkItemPeek`.
- `More actions for <Room>` appears both in the sidebar list row (no `Hand off`) and in the Room header (`region "Room <Room>"`, which has `Hand off`). Target the header button's `@e` ref.
- `Hand off` targets require an eligible non-self Room participant; when verifying from a solo Room, add a member such as `Research Analyst` first, or use `Linger`'s direct Room (`Hand it to Linger`) or starter Room `Getting Started`.
- Re-snapshot before clicking `Unarchive`, `Open full page`, or `See it on the dashboard` because drawers and confirmation views replace interactive refs in place.
