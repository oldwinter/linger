# Work Items and Dashboard

## Sub-features

- Viewing active work items at `/t/:tenantId/dashboard`
- Creating issues from the Dashboard (`New issue` dialog with `Title`, `Description`, `Issue priority`, `Origin Room`)
- Inspecting Work Item details in full-page view (`/t/:tenantId/dashboard/:workItemId`) or `WorkItemPeek` drawer (`Open full page`, `Archive`, `Unarchive`)
- Handing work off directly from a Room (`/t/:tenantId/rooms/:roomId/hand-off`) and jumping to the resulting Dashboard item (`See it on the dashboard`)

## How to get to it (user POV)

- Click `Dashboard` in `Primary navigation` to open `/t/:tenantId/dashboard` and use `New issue` to create tracked work.
- From an active Room, open `More actions for <Room>` -> `Hand off` to navigate to `/t/:tenantId/rooms/:roomId/hand-off`, enter what needs doing, and hand it to the target member.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, and browser session is signed in.

- **Create issue on Dashboard**: Click link `Dashboard` in `Primary navigation`, wait for `--fn "window.location.pathname.endsWith('/dashboard')"`, and snapshot (`snapshot -i`). Click button `New issue`, fill textbox `Title` with `Verify dashboard persistence`, optionally fill `Description`, leave or set `Issue priority`, and click button `Create issue`. Wait for the issue title to render and navigate into `/t/:tenantId/dashboard/<workItemId>` (or open the created item), then capture `work-item.aria.txt` and `work-item.png`.
- **Archive and unarchive state check**: From the Work Item detail/peek view, click button `Archive`, wait for button `Unarchive` to appear, reload (`browser --run-id "<id>" -- reload`), confirm persisted state, then restore or leave as test requires.
- **Hand off from a Room**: Inside a Room, click `More actions for <Room>`, snapshot (`snapshot -i`), click `Hand off`, wait for `--fn "window.location.pathname.endsWith('/hand-off')"`, fill textbox `What needs doing` with `Follow up on room verification`, click button `Hand it to <name>`, wait for link `See it on the dashboard`, capture `hand-off.aria.txt` and `hand-off.png`, and follow the link to confirm it lands on the Dashboard.
- **Cross-check TeamHub / PostgreSQL**: Run read-only `api --run-id "<id>" GET "/v0/tenants/<tenantId>/work-items"` (inspect route catalog if versioned paths differ) or read-only `sql --run-id "<id>" "SELECT id, number, title, state, priority, archived_at FROM work_items ORDER BY created_at DESC LIMIT 5;"` to confirm persisted records match the UI.

## Gotchas

- `Hand off` targets require an eligible Room participant; when verifying from a solo Room, add a member such as `Research Analyst` first or run from `Another Me`'s Room.
- Re-snapshot before clicking `Unarchive`, `Open full page`, or `See it on the dashboard` because peek drawers and confirmation banners dynamically replace elements in place.
