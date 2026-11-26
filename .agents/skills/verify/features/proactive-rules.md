# Proactive Rules and Mandates (`My Rules`)

Proactive Rules (`My Rules`) is a fork-only surface letting a user pause local `Another Me` reminders on this computer, inspect learned proactive rules and clues, review shadow rules before promoting them, and configure whether an active rule permits creating or delegating Work Items (`Mandate`).

## Sub-features

- `Reminders on this computer`: browser-local quiet hold (`Quiet for an hour`, `Quiet until morning`, and active `End quiet`), persisted across reloads in `localStorage` and mirrored in the Room sidebar's `Quiet reminders` menu
- `Rules` book (`/t/:tenantId/settings/my-rules`): shadow and active rules learned by nightly Memory dreaming (`Promote`, `What this changes next`, `Pin rule`/`Unpin rule`, inline `Edit rule` with `Rule text`, inline `Delete rule` -> `Confirm delete rule`, active-only `combobox "Mandate"` with `Only remind` / `Create a Work Item` / `Create and delegate`, plus `Actions taken under this rule` and shadow divergences)
- `Clues` section: single-reply hints waiting to recur before graduating into a shadow rule
- Sub-routes: shadow review walk (`/t/:tenantId/settings/my-rules/review`) and per-rule impact preview (`/t/:tenantId/settings/rule-changes/:ruleId`)

## How to get to it (user POV)

- Open `Account menu` -> `Settings` -> `My Rules` inside `Settings sections` (`/t/:tenantId/settings/my-rules`), or search `My Rules` in the Global Search modal (`Control+k` / `Meta+k`).
- From `My Rules`, when shadow rules exist, click `Review <N> new rule(s)` to open `/t/:tenantId/settings/my-rules/review`, or click `What this changes next` on a shadow rule to open `/t/:tenantId/settings/rule-changes/:ruleId`.
- From any Room route, the `Room navigation` toolbar button `Quiet reminders` manages the same local quiet hold as `Reminders on this computer`.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, and browser session is signed in.

- **Open `My Rules` and verify empty baseline**: Navigate via `Account menu` -> `Settings` -> `link "My Rules"`, wait for `--fn "window.location.pathname.endsWith('/settings/my-rules')"` and `--text "Reminders on this computer"`, confirm empty states (`No rules yet.` and `No clues right now.`), and capture `my-rules-initial.aria.txt` and `my-rules-initial.png`.
- **Exercise local quiet hold across reload**: Click `find role button --name "Quiet until morning" click`, wait for `--text "Quiet until 8:00 AM"` and `--text "End quiet"`, reload (`browser --run-id "<id>" -- reload`), wait for `--text "Quiet until 8:00 AM"`, capture `my-rules-quiet.png`, then click `find role button --name "End quiet" click` and confirm `End quiet` disappears and the default hint returns.
- **Verify review and change-preview sub-routes**:
  - Open `<web_url>/t/<tenantId>/settings/my-rules/review`, wait for `--text "No new rules to review."`, capture `my-rules-review.png`, click `link "Back to My Rules"`, and wait for `--fn "window.location.pathname.endsWith('/settings/my-rules')"`.
  - Open `<web_url>/t/<tenantId>/settings/rule-changes/pr_00000000000000000000000000000000`, wait for `--text "This rule is not in your book."`, click `link "Back to My Rules"`, and confirm return to `/settings/my-rules`.
- **Cross-check API and SQL second views**:
  - `api --run-id "<id>" GET "/v0/tenants/<tenantId>/me/proactive-rules"` -> confirm `{ "version": 1, "rules": [], "clues": [], "divergences": [], "mandates": [] }` on a fresh stack (or populated arrays after Memory dreaming).
  - `sql --run-id "<id>" "SELECT tenant_id, owner_actor_id, version, jsonb_array_length(rules) AS rule_count, jsonb_array_length(clues) AS clue_count FROM proactive_guidelines ORDER BY version DESC LIMIT 5;"`
  - `sql --run-id "<id>" "SELECT id, rule_id, matter, shadow_action, taken_action FROM proactive_shadow_divergences ORDER BY created_at DESC LIMIT 5;"`
  - `sql --run-id "<id>" "SELECT work_item_id, details FROM work_item_activities WHERE kind = 'mandate_recorded' ORDER BY occurred_at DESC LIMIT 5;"`
- **Populated-rule mutations (requires dreamed rules in `proactive_guidelines`)**: When verifying a stack with at least one shadow rule, drive `Pin rule` / `Unpin rule`, `Edit rule` (`textbox "Rule text"` -> `Save`, observing `Edited by you`), `What this changes next` -> `Let this rule decide` (or `Promote`), `combobox "Mandate"` -> `option "Create a Work Item"` (active rules only), and `Delete rule` -> `Confirm delete rule` (confirming `proactive_guidelines.version` increments and `deleted_rules` records the removed text).

## Gotchas

- **No manual rule creation on a fresh stack**: There is no UI form or public `POST` endpoint to create a proactive rule; rules are written solely by Memory's nightly dreaming (`proactive_guidelines` via `memory_source.record_proactive_guideline`). Because `verify-linger.mjs` enforces read-only `api` and `sql`, a fresh isolated stack always starts with zero rows; report populated-rule mutations (`Promote`, `Pin`, `Edit`, `Mandate`, `Delete`) as skipped with this unmet precondition rather than weakening the check.
- **Database schema names**: There is no `proactive_rules` or `proactive_mandates` table. Rules are JSONB entries inside `proactive_guidelines.rules` (append-only versioned rows), shadow divergences live in `proactive_shadow_divergences`, and recorded mandate acts live in `work_item_activities` where `kind = 'mandate_recorded'`.
- **Route path**: The route is `/t/:tenantId/settings/my-rules` (not `/settings/rules`), and Quick Jump (`/t/:tenantId/jump`) does not list `My Rules` (Global Search does).
- **`Reminders on this computer` is browser-local only**: It persists in `localStorage["linger.another-me-quiet.<encodedAccountId>"]`, writes nothing to TeamHub or PostgreSQL, and formats `Quiet until ...` with `en-US` time formatting.
- **Different delete confirmations by page**: `MyRulesPage` uses an inline `role="group" aria-label="Confirm rule deletion"` with `button[aria-label="Confirm delete rule"]` (visible text `Confirm`), whereas `/settings/my-rules/review` opens a `ModalDialog` (`Delete rule?`) with button `Delete rule`.
- **`Mandate` is active-only**: `combobox "Mandate"` renders only for `active` rules (`PUT .../mandate` rejects non-`none` values on shadow rules with `400 PROACTIVE_MANDATE_INVALID`). Any pending mutation disables all rule controls across the list until the request settles.
