# Auth and Session

Auth and Session governs how unauthenticated visitors reach `/login`, choose an interface language, authenticate against TeamHub, pass `LocalComputerGate` once `Another Me` is provisioned, and sign out cleanly via `Account menu`.

## Sub-features

- Clean cold-start redirect to `/login` (without `?reason=session-expired`) and allowlisted `/connect-computer?<query>` `return_to` redirect
- Pre-auth interface language switcher (`role="group" aria-label="Interface language"` with `button[lang="en"]` and `button[lang="zh-CN"]`) and password visibility toggle (`Show password` / `Hide password`)
- Inline error alert on invalid credentials (`role="alert"`: `Email or password is incorrect.`) and no-backend unreachable TeamHub retry (`Can't reach Linger` / `Try again`, verified via `pnpm test:e2e:smoke`)
- `LocalComputerGate` readiness once `Another Me` is provisioned and first-login onboarding splash dismissal (`data-testid="another-me-intro"`)
- Authenticated session sign-out from the sidebar `Account menu`

## How to get to it (user POV)

- Unauthenticated visitors opening `<web_url>` or any workspace route are redirected cleanly to `/login` (cold-start loaders suppress `?reason=session-expired`; that query parameter only appears when an active session expires mid-session, and clears on the next login attempt). Unauthenticated visits to `/connect-computer?<query>` redirect to `/login?return_to=...`.
- After signing in, the workspace shell renders inside `.app-shell` and lands on `/t/:tenantId/rooms/:roomId/chat` (`Primary navigation` mounts across all workspace routes; `Room navigation` mounts on `/t/:tenantId/rooms*`). Opening `Account menu` in `Primary navigation` exposes `Settings` and `Log out`.

## Driving it with verify-linger.mjs

Preconditions: An isolated stack is running (`up --run-id "<id>" --evidence-dir "$EVIDENCE_DIR"`) and `doctor --run-id "<id>"` passed.

- **Cold-start redirect and pre-auth language switcher**: Before signing in, open `<web_url>/` and wait for `--fn "window.location.pathname === '/login' && window.location.search === ''"` and `--text "Log in"`. Click `button[lang="zh-CN"]`, wait for `--fn 'document.querySelector("button[lang=\"zh-CN\"]")?.getAttribute("aria-pressed") === "true"'`, capture `auth-login-zh.png`, then click `button[lang="en"]` and wait for `--text "Log in"`.
- **Invalid credentials alert (logged-out state)**: On `<web_url>/login`, fill `Email` with `owner@linger.local` and `Password` with `wrong-password`, click `find role button --name "Log in" click`, and wait for `--text "Email or password is incorrect."`. Confirm `[role="alert"]` displays `Email or password is incorrect.` while the URL stays on `/login`, and capture `auth-error.aria.txt` and `auth-error.png`.
- **Allowlisted `/connect-computer` redirect**: While logged out, open `<web_url>/connect-computer?code_challenge=test&state=test`, confirm redirect to `/login?return_to=%2Fconnect-computer%3Fcode_challenge%3Dtest%26state%3Dtest` without `reason=session-expired` and with `sessionStorage.getItem('linger.interrupted-page') === null`. Run `./.agents/skills/verify/scripts/verify-linger.mjs sign-in --run-id "<id>" --return-to "/connect-computer?code_challenge=test&state=test"` and observe stdout JSON with `signed_in_as` matching `owner_email` and URL landing on `/connect-computer?code_challenge=test&state=test` (rendering `Connection request is invalid` unless full 43-char PKCE/state, `display_name`, and loopback `redirect_uri` parameters are provided).
- **Gate cleared on workspace landing**: Run `./.agents/skills/verify/scripts/verify-linger.mjs sign-in --run-id "<id>"` (or open `<web_url>/` if already signed in), wait for `--fn "window.location.pathname.includes('/rooms/') && Boolean(document.querySelector('nav[aria-label=\"Primary navigation\"]')) && !document.querySelector('.app-shell')?.hasAttribute('inert')"`, press `Escape` if `[data-testid="another-me-intro"]` renders on a fresh owner's first visit, and wait for `--fn '!document.querySelector("[data-testid=\"another-me-intro\"]")'`. Capture `auth-landing.aria.txt` and `auth-landing.png`, confirm `Primary navigation` and `Room navigation` are interactive with no `Connect your computer` modal blocking the shell, and cross-check `api --run-id "<id>" GET /v0/session` and `api --run-id "<id>" GET "/v0/tenants/<tenantId>/another-me"`.
- **Sign out via Account menu**: Click `Account menu` in `Primary navigation`, snapshot (`snapshot -i`), click menuitem `Log out`, and wait for `--fn "window.location.pathname === '/login' && window.location.search === ''"`. Observe heading `Log in`, capture `auth-logged-out.png`, and re-run `sign-in --run-id "<id>"` if continuing with other recipes.

## Gotchas

- Never pass `--load networkidle` after sign-in because authenticated pages keep `/v0/events` SSE open. Wait on `--fn "window.location.pathname.startsWith('/t/')"` or visible landmarks instead.
- The login submit button renders visible text and accessible name `Log in` (no `aria-label="Sign in"`). Match role `button` by name `Log in`.
- The first-login onboarding splash (`[data-testid="another-me-intro"]`, `"Hi, owner / I'm Linger."`) mounts asynchronously after `profile_setup_apps` resolves, so checking `!document.querySelector('[data-testid="another-me-intro"]')` immediately after `.app-shell` mounts can race ahead of it. Press `Escape` once the workspace renders or wait for the splash to finish before capturing `auth-landing.png`.
- `/login` strictly allowlists `return_to` targets matching `/connect-computer?<non-empty-query>` and ignores arbitrary workspace paths. Cold-start logged-out visits do not populate `sessionStorage["linger.interrupted-page"]`; only mid-session expiry writes that key, and `Log out` clears it.
- Incomplete `/connect-computer` query strings pass the `return_to` allowlist and land on `/connect-computer`, where the page displays `Connection request is invalid` unless valid 43-char base64url `code_challenge`, `state`, `display_name`, and loopback `redirect_uri` values are supplied.
- `verify-linger.mjs sign-in` restores `button[lang="en"]` automatically if `/login` was switched to Simplified Chinese (`button[lang="zh-CN"]`), but standalone browser scripts using English labels should switch back to `English` first.
- If an open Room Document in the current tab has unsaved local edits, clicking `Log out` prompts an `Unsaved Document edits` confirmation dialog (`Stay` / `Log out anyway`).
- Do not confuse `sign-in`'s browser cookie jar with `api --run-id "<id>" GET ...`: `api` performs its own short-lived owner login and logout per invocation so it never mutates or depends on the browser session.
- Unreachable TeamHub retry (`Can't reach Linger` / `Try again`) cannot be reached while the isolated stack's TeamHub is running; verify it with `pnpm test:e2e:smoke` (`tests/web-smoke.e2e.ts`).
