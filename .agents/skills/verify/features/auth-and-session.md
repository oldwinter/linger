# Auth and Session

## Sub-features

- Owner email/password authentication at `/login` and deep-link `return_to` redirect
- Inline error alert on invalid credentials (`role="alert"`)
- `LocalComputerGate` readiness once `Another Me` is provisioned
- Authenticated session sign-out from the sidebar `Account menu`

## How to get to it (user POV)

- Unauthenticated users visiting `<web_url>` or any workspace route are redirected to `/login` (with `?return_to=...` when coming from a deep link).
- After signing in, the workspace shell renders inside `.app-shell`; opening `Account menu` in the sidebar exposes `Settings` and `Log out`.

## Driving it with verify-linger.mjs

Preconditions: An isolated stack is running (`up --run-id "<id>" --evidence-dir "$EVIDENCE_DIR"`) and `doctor --run-id "<id>"` passed.

- **Signed-in bootstrap**: Run `./.agents/skills/verify/scripts/verify-linger.mjs sign-in --run-id "<id>"` (or include `--return-to "/t/<tenantId>/settings/computers"`). Observe stdout JSON with `signed_in_as` matching `owner_email` and URL transitioning from `/login` to `/t/...`; confirm `api --run-id "<id>" GET /v0/session` succeeds and `/v0/tenants/<tenantId>/another-me` returns `agent_actor_id` and `room_id`.
- **Gate cleared on landing**: Take a snapshot and screenshot immediately after sign-in (`browser --run-id "<id>" -- snapshot -i > "$EVIDENCE_DIR/auth-landing.aria.txt"` and `browser --run-id "<id>" -- screenshot "$EVIDENCE_DIR/auth-landing.png"`). Observe `Primary navigation` and `Room navigation` interactive in the UI without any `Connect your computer` modal blocking the shell.
- **Invalid credentials alert (logged-out state)**: After signing out or before signing in, open `<web_url>/login`, fill `Email` with `owner@linger.local` and `Password` with `wrong-password`, click button `Sign in` (`visible text "Log in"`), and wait for `role="alert"`. Observe the inline error alert and URL remaining on `/login`; confirm `auth-error.png` shows the form intact.
- **Sign out via Account menu**: Click `Account menu` in the sidebar, snapshot (`snapshot -i`), click menuitem `Log out`, and wait for `--fn "window.location.pathname === '/login'"`. Observe the login page heading `Log in`, then re-run `sign-in --run-id "<id>"` if continuing with other recipes.

## Gotchas

- Never pass `--load networkidle` after sign-in because authenticated pages keep `/v0/events` SSE open. Wait on `--fn "window.location.pathname.startsWith('/t/')"` or visible headings instead.
- The `Sign in` submit control renders visible text `Log in` with `aria-label="Sign in"`. Match role `button` by name `Sign in`.
- Do not confuse `sign-in`'s browser cookie jar with `api --run-id "<id>" GET ...`: `api` performs its own short-lived owner login and logout per invocation so it never mutates or depends on the browser session.
