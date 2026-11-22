# Auth and Session

## Sub-features

- Owner email/password authentication at `/login` and allowlisted `/connect-computer?<query>` `return_to` redirect
- Inline error alert on invalid credentials (`role="alert"`)
- `LocalComputerGate` readiness once `Another Me` is provisioned
- Authenticated session sign-out from the sidebar `Account menu`

## How to get to it (user POV)

- Unauthenticated users visiting `<web_url>` or any workspace route are redirected to `/login` (with `?reason=session-expired` when the session probe returns `401`, and `?return_to=...` only for `/connect-computer?<query>` setup links).
- After signing in, the workspace shell renders inside `.app-shell` and lands on `/t/:tenantId/rooms/:roomId/chat` (`Primary navigation` mounts across all workspace routes; `Room navigation` mounts on `/t/:tenantId/rooms*`). Opening `Account menu` in `Primary navigation` exposes `Settings` and `Log out`.

## Driving it with verify-linger.mjs

Preconditions: An isolated stack is running (`up --run-id "<id>" --evidence-dir "$EVIDENCE_DIR"`) and `doctor --run-id "<id>"` passed.

- **Signed-in bootstrap**: Run `./.agents/skills/verify/scripts/verify-linger.mjs sign-in --run-id "<id>"` (or include `--return-to "/connect-computer?code_challenge=test&state=test"` to exercise the allowlisted setup redirect). Observe stdout JSON with `signed_in_as` matching `owner_email` and URL transitioning from `/login` to `/t/<tenantId>/rooms/<roomId>/chat` (or `/connect-computer?...`); confirm `api --run-id "<id>" GET /v0/session` succeeds and `/v0/tenants/<tenantId>/another-me` returns `agent_actor_id` and `room_id`.
- **Gate cleared on landing**: Wait for `.app-shell` (and, on the first login of a fresh owner, let the brief `"Hi, owner / I'm Linger."` onboarding splash fade out before screenshotting), then capture `browser --run-id "<id>" -- snapshot -i > "$EVIDENCE_DIR/auth-landing.aria.txt"` and `browser --run-id "<id>" -- screenshot "$EVIDENCE_DIR/auth-landing.png"`. Observe `Primary navigation` and `Room navigation` interactive in the UI, `.app-shell` without `inert`, and no `Connect your computer` modal blocking the shell.
- **Invalid credentials alert (logged-out state)**: After signing out or before signing in, open `<web_url>/login`, fill `Email` with `owner@linger.local` and `Password` with `wrong-password`, click button `Log in`, and wait for `[role="alert"]`. Observe the inline error alert (`email or password is incorrect`) and URL remaining on `/login`; confirm `auth-error.png` shows the form intact.
- **Sign out via Account menu**: Click `Account menu` in `Primary navigation`, snapshot (`snapshot -i`), click menuitem `Log out`, and wait for `--fn "window.location.pathname === '/login'"`. Observe the login page heading `Log in`, then re-run `sign-in --run-id "<id>"` if continuing with other recipes.

## Gotchas

- Never pass `--load networkidle` after sign-in because authenticated pages keep `/v0/events` SSE open. Wait on `--fn "window.location.pathname.startsWith('/t/')"` or visible headings instead.
- The login submit button renders visible text and accessible name `Log in` (there is no `aria-label="Sign in"`). Match role `button` by name `Log in`.
- `/login` strictly allowlists `return_to` targets matching `/connect-computer?<non-empty-query>` and ignores arbitrary workspace paths (such as `/t/<tenantId>/settings/computers`). Visiting `/connect-computer?...` while logged out also stores `sessionStorage["linger.interrupted-page"]`, which a subsequent plain login consumes unless cleared via `Log out` or a fresh browser session.
- If an open Room Document in the current tab has unsaved local edits, clicking `Log out` first prompts an `Unsaved Document edits` confirmation dialog (`Stay` / `Log out anyway`).
- Do not confuse `sign-in`'s browser cookie jar with `api --run-id "<id>" GET ...`: `api` performs its own short-lived owner login and logout per invocation so it never mutates or depends on the browser session.
