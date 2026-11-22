---
name: verify
description: Verify Linger web, TeamHub, Document Runtime, and Local Computer features end-to-end against an isolated local stack. Use whenever proving UI flows, API/database side effects, runtime execution, regressions, or capturing screenshot and accessibility evidence.
---

# Verify Linger

Drive the running Linger product (React Web UI, TeamHub, Node Services, PostgreSQL, and Local Computer) on an isolated per-run stack. Each run uses `--run-id <id>` (`[a-z0-9-]`, 2-40 chars), stores mutable runtime state in a per-run scratch directory under the system temp dir (`run_dir` in `up.json`, e.g., `$TMPDIR/linger-verify-<id>`), and writes proof artifacts to `--evidence-dir` (outside `run_dir`) so evidence survives teardown.

This harness never targets host desktop instances (`127.0.0.1:3000`, default ports `3000/4319/4321/5432/8080/17880/54339`, `~/.simplexai`, `~/.herdr`, or `.linger-runtime/`).

## Launch

Prepare the evidence directory outside the per-run scratch `run_dir` (for example `/tmp/linger-verify-evidence-<id>` when `$TMPDIR` is `/var/folders/...`, or a distinct `/tmp/...-evidence` path), launch the stack, and record the JSON output:

```bash
EVIDENCE_DIR="/tmp/linger-verify-evidence-<id>"
mkdir -p "$EVIDENCE_DIR"
./.agents/skills/verify/scripts/verify-linger.mjs up \
  --run-id "<id>" \
  --evidence-dir "$EVIDENCE_DIR" \
  > "$EVIDENCE_DIR/up.json"
```

`up` builds `teamhub`, `migrate`, `teamhub-cli`, `linger-computer`, and `linger-computer-daemon`, starts native PostgreSQL 17 with `pgvector` (or an isolated Docker Compose DB when native binaries are unavailable), creates a fresh owner account, starts TeamHub, Node Services (`memory,llm-wiki,agent,document`), the Vite Web server, and an enrolled Local Computer daemon, then waits until `Another Me` is provisioned (`agent_actor_id` and `room_id`) so the `LocalComputerGate` overlay clears.

Options for `up`:

- `--live-provider`: use the local Codex binary directly instead of the default `codex-app-server-fixture` stand-in.
- Stand-in boundary: default mode runs Vite dev server instead of the production static-host container and substitutes `codex-app-server-fixture` (which ends its turn with `"fixture complete"` without running `teamhub message send` into the Room timeline, so `room-reply-guard` terminates Room runs with `agent_local_runs.status = 'failed'` and `terminal.failure.code = 'reply_not_sent'`). Pass `--live-provider` when testing real agent messages or live model behavior.

## Doctor

Run read-only health verification right after `up` (and before debugging failures):

```bash
./.agents/skills/verify/scripts/verify-linger.mjs doctor \
  --run-id "<id>" \
  > "$EVIDENCE_DIR/doctor.json"
```

`doctor` exits non-zero unless all checks pass: owned process PIDs match the active loopback listeners, `/healthz` probes succeed for TeamHub, Node Services, Document Runtime, and Web (plus `/readyz` for Node Services and Document Runtime), owner sign-in works via HTTP, `Another Me` is present, and `linger-computer daemon status --json` reports `gateway_state: "connected"` with a ready runtime. Inspect `<run_dir>/logs/*.log` whenever `up` or `doctor` fails, then run [Cleanup](#cleanup).

## Drive

Sign into the isolated `agent-browser` session first:

```bash
./.agents/skills/verify/scripts/verify-linger.mjs sign-in \
  --run-id "<id>"
```

All browser actions go through the run-scoped `browser` wrapper so every command automatically inherits `--session linger-verify-<id>`:

```bash
./.agents/skills/verify/scripts/verify-linger.mjs browser \
  --run-id "<id>" -- <agent-browser-args...>
```

Execution rules while driving the UI:

- Drive product mutations exclusively through the Web UI (`browser`) and `linger-computer` CLI (`computer`). Use `api` (`GET` only) and `sql` (read-only transaction) strictly for second-view verification, never to create or mutate state.
- Wait on visible text, roles, DOM attributes, or path predicates (`wait --text "..."`, `wait --fn "window.location.pathname.includes('/rooms/')"`, or `wait --fn "document.querySelector('[data-room-document-save-status]')?.getAttribute('data-room-document-save-status') === 'Saved' && Number(document.querySelector('[data-room-document-durable-sequence]')?.getAttribute('data-room-document-durable-sequence')) > 0"`). Never run `wait --load networkidle` because `/v0/events` SSE and `/document-collaboration` WebSocket keep open connections, and avoid bare `wait '[data-room-document-save-status="Saved"]'` because that probe sits on a `hidden` element. Note that `--fn` path checks are more reliable than `--url` globs across nested SPA routes.
- Re-snapshot (`snapshot -i`) after navigation, dialog open/close, menu selection, or form submission because interactive `@e` refs become stale when elements mount or unmount. Call `scrollintoview <ref>` before clicking controls that sit below the fold inside scrollable panels or dialogs.
- Prefer accessible semantic locators (`find role ...`, `find label ...`, `find text ...`) when stable; use `snapshot -i` to discover dynamic buttons or verify labels.

Follow the feature map starting at [features/README.md](features/README.md) for routes, controls, preconditions, and gotchas per area:

- [Auth and session](features/auth-and-session.md)
- [Rooms and messaging](features/rooms-and-messaging.md)
- [Documents and library](features/documents-and-library.md)
- [Work items and hand-off](features/work-items-dashboard.md)
- [Navigation, search, and settings](features/navigation-search-and-settings.md)

## Evidence

Capture three independent proofs inside `$EVIDENCE_DIR` before finishing a verification pass:

1. **Visual state**: full screenshots (`browser --run-id "<id>" -- screenshot "$EVIDENCE_DIR/<step>.png"`) for initial state, key interactions, and post-reload persistence; inspect the saved PNG files with `read_file` to verify layout, text readability, and absence of error banners or unintended dialogs.
2. **Semantic DOM / accessibility state**: interactive snapshots (`browser --run-id "<id>" -- snapshot -i`) or text captures redirected to `$EVIDENCE_DIR/<step>.aria.txt`.
3. **Second-view side effects**: persisted TeamHub API responses (`api --run-id "<id>" GET /v0/...`), read-only PostgreSQL rows (`sql --run-id "<id>" "SELECT ..."`), and Local Computer state (`computer --run-id "<id>" -- daemon status --json`).

Save files directly under `$EVIDENCE_DIR` (outside `run_dir`) and confirm they remain readable and non-empty after `down`.

## Cleanup

Always tear down the stack when verification finishes or aborts:

```bash
./.agents/skills/verify/scripts/verify-linger.mjs down \
  --run-id "<id>" \
  > "$EVIDENCE_DIR/down.json"
```

`down` closes the run's `agent-browser` session, stops the Local Computer daemon, Web server, Node Services, TeamHub, and PostgreSQL (or removes the Docker Compose project and volumes), unlocks permissions on `run_dir`, and removes the entire scratch directory while leaving `$EVIDENCE_DIR` intact. Verify `test ! -e "$(jq -r .run_dir "$EVIDENCE_DIR/up.json")"` and confirm no listeners remain on the ports listed in `$EVIDENCE_DIR/up.json`.

## Helpers

| Command                                                   | Purpose                                             | Notes                                                    |
| --------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| [verify-linger.mjs](scripts/verify-linger.mjs) `up`       | Launch isolated stack and wait for `Another Me`     | Optional `--run-id`, `--evidence-dir`, `--live-provider` |
| [verify-linger.mjs](scripts/verify-linger.mjs) `doctor`   | Check PIDs, ports, `/healthz`, owner login, gateway | Exits non-zero on any failed check                       |
| [verify-linger.mjs](scripts/verify-linger.mjs) `sign-in`  | Log owner into `/login` inside run browser session  | Optional `--return-to /connect-computer?<query>`         |
| [verify-linger.mjs](scripts/verify-linger.mjs) `browser`  | Run `agent-browser --session linger-verify-<id>`    | Pass command args after `--`                             |
| [verify-linger.mjs](scripts/verify-linger.mjs) `api`      | Execute read-only `GET /v0/...` as run owner        | Rejects non-`GET` methods                                |
| [verify-linger.mjs](scripts/verify-linger.mjs) `sql`      | Run PostgreSQL query with read-only transaction     | Forces `SET default_transaction_read_only = on`          |
| [verify-linger.mjs](scripts/verify-linger.mjs) `computer` | Run `linger-computer` against isolated config       | Appends `--config <run-dir>/computer/config.json`        |
| [verify-linger.mjs](scripts/verify-linger.mjs) `down`     | Stop run processes and delete `run_dir`             | Preserves `--evidence-dir`                               |
