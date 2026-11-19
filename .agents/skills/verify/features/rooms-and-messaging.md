# Rooms and Messaging

## Sub-features

- Creating a multi-member Room (`Create chat` -> `Create Room`) and enrolling existing members (`Add Room members` -> `Choose existing members`)
- Posting messages in `Room timeline` and verifying reload persistence (`article[data-message-id]`)
- Triggering local agent runs (`@<Agent>` mention or messaging `Another Me`'s Room)
- Managing Room metadata, navigation actions (`More actions for <Room>`), and read-only conversation link sharing/revocation (`/shared-room-history#...`)

## How to get to it (user POV)

- From the workspace sidebar (`Room navigation`), click `Create chat`, choose `Create Room`, name the Room, and either add members or skip into `/t/:tenantId/rooms/:roomId`.
- Inside a Room, compose in `Message Room`, inspect replies in `Room timeline`, toggle `Show sidebar` (`Panel sidebar`) for linked Documents, or open `Open <Room> settings from avatar` and `More actions for <Room>` from the header.

## Driving it with verify-linger.mjs

Preconditions: Stack is running, `doctor` passed, and `./.agents/skills/verify/scripts/verify-linger.mjs sign-in --run-id "<id>"` completed.

- **Create Room and add Research Analyst**: Capture initial landing state (`browser --run-id "<id>" -- snapshot -i` and `screenshot`). Click button `Create chat`, snapshot, click menuitem `Create Room`, wait for dialog `Create Room`, fill textbox `Room name` with `Release verification room`, and click button `Create Room`. Wait for `Add Room members`, click button `Choose existing members`, wait for `--text "Research Analyst"`, run `snapshot -i` to inspect `region "Agent"`, click the `@e` ref for `button "Research Analyst avatar Research Analyst"`, then click button `Add members`. Wait for `--fn "window.location.pathname.includes('/rooms/')"`, wait for `--text "Release verification room"`, record `<roomId>` via `browser --run-id "<id>" -- get url`, and save `room-created.aria.txt` and `room-created.png`.
- **Send message and verify reload persistence**: Click `[aria-label="Message Room"]` and type `@Research` (`type '[aria-label="Message Room"]' "@Research"`) so `listbox "Mention people or documents"` highlights `Research Analyst`; press `Enter` to insert the `@Research Analyst ` mention chip, type `Verify end-to-end room delivery` into `[aria-label="Message Room"]` (or use `fill '[aria-label="Message Room"]'` for plain messages without `@` mentions), click button `Send message`, and wait for `--text "Verify end-to-end room delivery"`. Run `browser --run-id "<id>" -- reload`, wait for `--text "Verify end-to-end room delivery"` again, and capture `message-persisted.aria.txt` and `message-persisted.png`.
- **Cross-check API, SQL, and Local Computer**: Run `api --run-id "<id>" GET "/v0/rooms/<roomId>/messages"`, `sql --run-id "<id>" "SELECT id, room_id, author_actor_id, body, mentioned_actor_ids, room_seq FROM messages WHERE room_id = '<roomId>' ORDER BY room_seq;"`, `sql --run-id "<id>" "SELECT run_id, context_key, status, terminal, status_room_id FROM agent_local_runs ORDER BY created_at DESC LIMIT 5;"`, and `computer --run-id "<id>" -- daemon status --json`. Observe the posted message row in both API JSON (`raw_message`, `segments`) and PostgreSQL `messages`, plus the completed run row in `agent_local_runs`.
- **Share and revoke conversation link**: Click header button `Open Release verification room settings from avatar`, confirm `[data-testid="panel-room-settings"]`, click `Share conversation`, click `Create share link`, read textbox `Conversation link` (`/shared-room-history#...`), optionally open it in an incognito context or new tab to verify read-only shared history rendering, then click `Revoke`, observe `Revoked`, and click `Close`.

## Gotchas

- `Add Room members` -> `Choose existing members` expands inline inside `region "Members"` without blocking `Add members`; wait on `--text "Research Analyst"` (not `Search members`, which is only a placeholder/aria-label) and click the `@e` ref for `Research Analyst avatar Research Analyst` because `find role button --name "Research Analyst"` substring-matches background sidebar buttons (`Pin Research Analyst`, `More actions for Research Analyst`).
- Target the Room composer with `[aria-label="Message Room"]` (or `find label "Message Room" fill "..."` / `@e` ref) rather than `find role textbox ... --name "Message Room"`. Multi-member Rooms also require selecting an actor from `listbox "Mention people or documents"` after typing `@...` so `mentioned_actor_ids` and `agent_local_runs` are populated.
- Default `up` mode runs `codex-app-server-fixture`, which completes `agent_local_runs` with `status = 'succeeded'` and `terminal = {"type": "succeeded", "finalResponse": "fixture complete"}` without running `teamhub messages publish` into the Room timeline. Start `up --live-provider` whenever verifying live agent message posts back into chat.
- Sidebar and popover DOM nodes mount dynamically; re-run `snapshot -i` after opening `Create chat`, `Choose existing members`, or `Share conversation` before targeting elements by `@e` ref.
