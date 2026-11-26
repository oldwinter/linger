# Linger Feature Verification Map

Feature recipes for [verify-linger.mjs](../scripts/verify-linger.mjs). Each document covers one product area with reproducible browser steps, observable UI results, second-view checks (`api` GET, `sql` read-only queries, `computer` status), and known gotchas.

## Feature Areas

| Feature                                                               | Route / Entry                                                                              | Covers                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Auth and session](auth-and-session.md)                               | `/login`, `Account menu`, `LocalComputerGate`                                              | Clean cold-start redirect, pre-auth language switcher, invalid-credential alert, `/connect-computer` `return_to`, `Another Me` gate clearance, sign-out |
| [Rooms and messaging](rooms-and-messaging.md)                         | `/t/:tenantId/rooms/:roomId/chat`, `/shared-room-history`                                  | Room creation, member selection, message send and reload persistence, fixture run failure dock, Message Pins, Room details, share link and revocation   |
| [Documents and library](documents-and-library.md)                     | `/t/:tenantId/library`, `/t/:tenantId/documents/:documentId`, `/shared-documents`          | Library views, folder creation, native Room Document byline `Document mode` and BlockNote persistence, Document link sharing                            |
| [Work items and hand-off](work-items-dashboard.md)                    | `/t/:tenantId/dashboard`, `/t/:tenantId/work-items/:workItemId`, `/rooms/:roomId/hand-off` | Dashboard issue creation, `WorkItemDetailDrawer` comments, `WorkItemPeek` archive/unarchive, read-only story route, Room hand-off creation              |
| [Navigation, search, and settings](navigation-search-and-settings.md) | `/t/:tenantId/jump`, Search dialog, `/t/:tenantId/settings/*`, `Wiki`, `Connectors`        | Primary and Room navigation, Global Search modal, Jump filtering, Shortcuts, Computers, Models, Language, Wiki, and Connectors (`Web search`)           |
| [Proactive rules and mandates](proactive-rules.md)                    | `/t/:tenantId/settings/my-rules`, `/my-rules/review`, `/rule-changes/:ruleId`              | Fork-only `My Rules` book, local `Reminders on this computer` quiet hold, shadow review and change-preview sub-routes, API/SQL second views             |

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

## Complementary No-Backend Shell Smoke

For offline shell states that cannot be reached while the isolated stack's TeamHub is healthy (unreachable TeamHub `"Can't reach Linger"` / `"Try again"` and revoked `/shared-documents` error state), run `pnpm test:e2e:smoke` (`e2e.config.ts` / `tests/web-smoke.e2e.ts`).

## Keeping Recipes Honest

- Update the matching feature doc in the same change whenever routes, accessible roles/labels, dialogs, or wait conditions change.
- Run [Cleanup](../SKILL.md#cleanup) (`down --run-id "<id>"`) after every run, including failed checks.
