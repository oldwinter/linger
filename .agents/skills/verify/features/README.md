# Linger Feature Verification Map

Feature recipes for [verify-linger.mjs](../scripts/verify-linger.mjs). Each document covers one product area with reproducible browser steps, observable UI results, second-view checks (`api` GET, `sql` read-only queries, `computer` status), and known gotchas.

## Feature Areas

| Feature                                                               | Route / Entry                                                   | Covers                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [Auth and session](auth-and-session.md)                               | `/login`, `Account menu`, `LocalComputerGate`                   | Sign-in, `return_to` redirect, invalid-credential alert, `Another Me` gate clearance, sign-out                            |
| [Rooms and messaging](rooms-and-messaging.md)                         | `/t/:tenantId/rooms/:roomId`, `/shared-room-history`            | Room creation, member selection, message send and reload persistence, Room settings, shared history link and revocation   |
| [Documents and library](documents-and-library.md)                     | `/t/:tenantId/library`, `/t/:tenantId/documents/:documentId`    | Folder creation, native Room Document creation, Read/Edit mode toggle, BlockNote editing, save status, reload persistence |
| [Work items and hand-off](work-items-dashboard.md)                    | `/t/:tenantId/dashboard`, `/t/:tenantId/rooms/:roomId/hand-off` | Dashboard issue creation, Work Item full page and peek drawer, archive/unarchive, Room hand-off creation                  |
| [Navigation, search, and settings](navigation-search-and-settings.md) | `/t/:tenantId/jump`, Search dialog, `/t/:tenantId/settings/*`   | Primary and Room navigation, Global Search modal, Jump page filtering, Shortcuts filter, Computers readiness              |

## Shared Preconditions

1. Start an isolated stack with an external `--evidence-dir` (see [Launch](../SKILL.md#launch)):

   ```bash
   EVIDENCE_DIR="/tmp/linger-verify-evidence-<id>"
   mkdir -p "$EVIDENCE_DIR"
   ./.agents/skills/verify/scripts/verify-linger.mjs up \
     --run-id "<id>" \
     --evidence-dir "$EVIDENCE_DIR" \
     > "$EVIDENCE_DIR/up.json"
   ```

2. Run `./.agents/skills/verify/scripts/verify-linger.mjs doctor --run-id "<id>" > "$EVIDENCE_DIR/doctor.json"` and confirm `"ok": true`.
3. Sign into the browser session with `./.agents/skills/verify/scripts/verify-linger.mjs sign-in --run-id "<id>"` before running authenticated recipes.

## Keeping Recipes Honest

- Update the matching feature doc in the same change whenever routes, accessible roles/labels, dialogs, or wait conditions change.
- Run [Cleanup](../SKILL.md#cleanup) (`down --run-id "<id>"`) after every run, including failed checks.
