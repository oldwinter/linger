# Upstream Sync Runbook

This runbook defines the authoritative procedure for syncing
`simplexai-labs/linger` (`upstream/main`) into the `oldwinter/linger` fork
(`origin/main`). It preserves fork-only features, database migration history,
built-in skill immutability, and merge-commit ancestry.

> **Language rule**: Keep all repository files, comments, commit messages, and
> pull request titles/bodies strictly English-only (see
> [AGENTS.md](../AGENTS.md)). Only translation catalogs under
> `apps/web/src/i18n/locales/`, `apps/desktop/src/i18n/locales/`, and
> `mobile/internal/i18n/locales/` may contain non-English strings. Operator
> summaries (for example, chat reports from a scheduled automation) may use the
> operator's requested language.

## 1. Preparation and Guardrails

1. Read [AGENTS.md](../AGENTS.md) and
   [apps/teamhub/migrations/README.md](../apps/teamhub/migrations/README.md).
2. Refresh both remotes:

   ```bash
   git fetch origin main && git fetch upstream main
   ```

3. Ensure the working tree is clean and the dedicated sync branch starts from
   the latest `origin/main` (fast-forward or reset cleanly onto `origin/main`
   before merging; never commit directly on `main`).
4. Check whether upstream has new commits to merge:

   ```bash
   git rev-list --count HEAD..upstream/main
   ```

   If the count is `0`, stop cleanly and report that the fork is already up to
   date without opening an empty PR.

5. Check for an existing open upstream-sync PR against `main`:

   ```bash
   gh pr list --repo oldwinter/linger --state open --base main
   ```

   Do not open a duplicate upstream-sync PR. If one is already open, either
   update its branch or stop and report it.

## 2. Merge Strategy

Always merge `upstream/main` with a regular merge commit and `--no-commit` so
explicit conflicts and silent semantic hazards can be audited before committing:

```bash
git merge --no-commit --no-ff upstream/main
```

- **Never rebase fork history** onto `upstream/main`.
- **Never squash** upstream sync merges. Rewriting or squashing destroys the
  `upstream/main` merge parent, breaks published migration and built-in skill
  immutability checks, and causes recurring conflicts on future syncs.
- Resolve all explicit Git conflicts and audit overlapping auto-merged files for
  silent semantic regressions (dropped safety guards, overwritten branding or
  paths, changed test accessible names, or broken contracts).

## 3. Conflict Resolution and Semantic Audit

### 3.1 TeamHub Database Migrations

- Fork-only migrations `00866` through `00869` (proactive rule records,
  proactive mandates, Local Computer wake authority, and message pins) are
  immutable. Their filenames and SQL bytes must never change.
- Already-published upstream imports (`00870` onward on `origin/main`) are also
  immutable and must never be edited or overwritten.
- Renumber any colliding incoming upstream migrations sequentially after the
  current highest migration on `origin/main`, preserving each migration's
  filename suffix, exact SQL bytes, and relative order.
- Record every renumbered migration in the mapping table in
  [apps/teamhub/migrations/README.md](../apps/teamhub/migrations/README.md).
- Verify migration history from the repository root:

  ```bash
  bash apps/teamhub/scripts/check-migration-history.sh origin/main
  ```

### 3.2 Fork-Only Features vs. Upstream Convergence

Preserve genuine fork-only features and safety guards while converging cleanly
onto upstream canonical implementations when upstream supersedes a fork fix.

Audit conflicts and overlapping auto-merges against the current fork-only
inventory on `oldwinter/linger` `main`:

- **Proactive Rules and Mandates**: TeamHub migrations `00866`–`00868`,
  `apps/teamhub/internal/app/handlers_proactive_rules.go`,
  `apps/teamhub/internal/store/queries/proactive.sql`, OpenAPI contracts, Web
  My Rules UI, and Mobile My Rules screen.
- **Herdr Bridge and Built-in Skill**: Local Computer daemon
  `apps/computer/local-daemon/internal/linger/herdr/`, the exported
  `TerminalEnvironment` helper in
  `apps/computer/local-daemon/internal/provider/terminal_environment.go` (keep
  alongside upstream `TerminalEnvironmentCache` and PATH-reuse helpers), TeamHub
  `apps/teamhub/internal/app/handlers_herdr.go`, `./internal/linger/herdr` in
  root `Makefile` `check-computer-go`, `HERDR_SOCKET_PATH` in
  `scripts/env-inventory.json`, and `simplexai_herdr` in
  `skills/builtin/catalog.yaml` + `skills/builtin/herdr/1.0.0/`.
- **Message Pins**: TeamHub migration `00869`,
  `apps/teamhub/internal/app/handlers_message_pins.go`,
  `apps/teamhub/internal/store/queries/message_pins.sql`, Web Room header pin
  controls, and Mobile pin support.
- **Desktop Quick Note, Global Shortcut, and Unread Badge**:
  `apps/desktop/src/main/quick-note.ts`,
  `apps/desktop/src/main/global-shortcut.ts` (`CommandOrControl+Shift+N`),
  `apps/desktop/src/preload/quick-note.ts`, `apps/desktop/src/shell/quick-note.html`,
  and `notifications.setBadgeCount` unread mention badge wiring in
  `apps/desktop/src/preload/index.ts`.
- **Mobile Companion and Desktop LAN Companion Gateway**: Self-contained
  Go/MyGo client under `mobile/` (see [mobile/README.md](../mobile/README.md))
  with live `System` / `Town Light` / `Town Dark` theme switching and bilingual
  `en` / `zh-Hans` ICU MessageFormat localization (`mobile/internal/i18n/locales/`),
  plus Desktop Companion Gateway (`apps/desktop/src/main/companion/`,
  `apps/desktop/src/main/mobile-companion.ts`,
  `apps/desktop/src/shell/mobile-companion.html`,
  `apps/desktop/src/shell/mobile-companion.messages.ts`, the hoisted shared
  `daemon` instance in `apps/desktop/src/main/index.ts`, and companion
  credential exclusions in `apps/desktop/src/main/diagnostics.ts`), the
  `mobile/internal/i18n/locales/*` English-only allowlist in
  `scripts/ci/check-changed-files.sh`, and `.github/workflows/mobile-ci.yml`.
  Keep root `Makefile` and `scripts/check-plan.mjs` decoupled from `mobile/` to
  avoid sync churn; validate `mobile/` directly via `make -C mobile check`.
- **LingerX Branding, Side-by-Side Isolation, and Unified CI/CD Release**:
  Full fork isolation so LingerX installs and runs alongside upstream Linger:
  `LingerX.app` / `LingerX.exe` / `lingerx`, bundle and AppUserModelID
  `dev.oldwinter.lingerx.desktop` and `dev.oldwinter.lingerx.mobile`,
  `lingerx://` deep-link scheme (retaining legacy `linger://pair` parsing),
  `%LOCALAPPDATA%\Programs\LingerX`, `<appData>/LingerX`, `~/.lingerx`,
  `~/LingerX`, `DEFAULT_FEED_URL` pointing to
  `https://github.com/oldwinter/linger/releases` with the fork Ed25519 update
  key, `packages/local-installation/src/{home,setup-plan}.ts`,
  `scripts/ci/desktop-release.sh`, `.github/actions/desktop-build/action.yml`,
  `.github/workflows/desktop-release.yml`, and `.github/workflows/release.yml`.
  When upstream edits desktop packaging, updater, or local-installation files,
  verify upstream `Linger` / `com.simplexai.linger.*` / `~/.linger` identifiers
  do not overwrite LingerX isolation.
- **Web UX Waves 1–3 and Safety Guards**: Design-system cohesion, accessibility,
  and defensive guards across `apps/web`, including:
  - `closest("dialog[open]")` portal-root targeting and `Home`/`End` keyboard
    navigation in `apps/web/src/components/ui/select-popup.tsx`
  - Busy and switching `disabled` guards (for example `ComputerPicker`,
    `remove-computer-dialog.tsx`, and `routine-dialog.tsx` `<fieldset>`
    busy/dirty/delete-confirmation guards)
  - Narrow-viewport width clamping (`useClampedWindowWidth`), standardized
    `ModalDialog`, and inline destructive confirmations
  - Logout cleanup of fork stores (`library-recent-documents`,
    `wiki-recent-pages`, `wiki-display`) alongside upstream stores in
    `apps/web/src/features/auth/local-authenticated-state.ts`
  - Local Computer `canDoHref` and failed-load Retry UX
- **Project-Local Verification Skills**: `.agents/skills/verify/` and
  `.agents/skills/document-durability/`. Keep both intact; note in the PR if
  upstream edits to `apps/node-services/src/document/` or core Web flows
  warrant a follow-up verification-skill maintenance pass.

### 3.3 Web, Desktop, and Mobile Guards and Bundle Budget

- **Web `localStorage` guard**: If upstream adds or removes `localStorage` usage
  in `apps/web/src/`, register the module in
  `apps/web/src/features/settings/browser-preferences.ts` or add an explicit
  exclusion reason in
  `apps/web/src/features/settings/browser-preferences-guard.test.ts` (and keep
  `local-authenticated-state.ts` / `use-logout.test.tsx` in sync).
- **i18n catalogs**: Keep every translation catalog consistent with its source
  messages, placeholders, tags, and plural forms:
  - Web: `pnpm --filter @linger/web test src/i18n/catalog.test.ts`
    (`apps/web/src/i18n/locales/zh-CN.json`)
  - Desktop:
    `pnpm --filter @linger/desktop exec vitest run src/i18n/catalog.test.ts`
    (`apps/desktop/src/i18n/locales/zh-CN.json`, including
    `mobile-companion.messages.ts`)
  - Mobile (when `mobile/` changes):
    `cd mobile && go test -count=1 ./internal/i18n/... ./internal/shell/...`
    (`mobile/internal/i18n/locales/{en,zh-Hans}.json`, `catalog_test.go`, and
    `theme_i18n_test.go`)
- **Web initial JS bundle budget**: Whenever `apps/web/` changes, confirm the
  initial load graph stays within minified, gzip, and Brotli budgets:

  ```bash
  pnpm --filter @linger/web run build:assets
  ```

### 3.4 Dependencies, Contracts, sqlc, and CLI Snapshots

- **Workspace dependencies**: If workspace `package.json` manifests or
  `pnpm-lock.yaml` changed, refresh local dependencies:

  ```bash
  pnpm install --frozen-lockfile --prefer-offline
  ```

- **OpenAPI and AsyncAPI contracts**: Resolve conflicts in `contracts/openapi/`
  (and AsyncAPI sources) first—never hand-edit `contracts/generated/`—then
  regenerate and verify:

  ```bash
  pnpm contracts:generate && pnpm contracts:verify
  ```

- **TeamHub sqlc**: If SQL queries or migrations under `apps/teamhub/` changed,
  regenerate and verify:

  ```bash
  make -C apps/teamhub generate && make -C apps/teamhub sqlc-verify
  ```

- **TeamHub CLI snapshots**: Run `pnpm --filter @linger/teamhub-cli test`.
  Update snapshots in
  `apps/teamhub-cli/src/__snapshots__/cli.help-snapshot.test.ts.snap` only when
  CLI help or schema output intentionally changed.
- **Environment inventory**: If runtime environment variables changed, keep
  `.env.example` and `scripts/env-inventory.json` aligned and verify with
  `pnpm env:inventory:check`.

### 3.5 Built-in Skills Immutability

- Preserve fork built-in skills (such as `simplexai_herdr`) in
  `skills/builtin/catalog.yaml` and under `skills/builtin/herdr/1.0.0/`.
- Never modify files inside an already-published version directory under
  `skills/builtin/<skill>/<version>/`.
- Verify immutability against `origin/main` (also run as part of
  `check-teamhub`):

  ```bash
  make -C apps/teamhub check-builtin-skill-immutability BASE=origin/main
  ```

## 4. Commit and Local Verification Gate

1. Confirm zero conflict markers or whitespace errors remain:

   ```bash
   git diff --check
   ```

2. Commit the merge using conventional commit format:

   ```bash
   git commit -m "chore: merge upstream main at <upstream-short-sha>"
   ```

3. Run the planned fast checks and repository gate against `origin/main`:

   ```bash
   make check BASE=origin/main
   make check-repository-gate BASE=origin/main
   ```

4. Run focused tests for every conflicted or touched module, plus:
   - `pnpm --filter @linger/web run build:assets` when `apps/web/` changed
   - `make -C mobile check` when `mobile/` or Desktop Companion Gateway files
     changed
   - `make -C apps/teamhub fmt-check` and
     `cd apps/teamhub && go test ./tests/integration/layout -count=1` when
     `apps/teamhub/` changed
5. Re-run any CPU-contention flakes cleanly in isolation. Fix real regressions
   with focused conventional commits (for example `fix(<scope>): ...`) on the
   sync branch before pushing.

## 5. Pull Request, CI Watch, and Merge

1. Push the sync branch to `origin` and open (or update) an English-only PR
   against `oldwinter/linger` `main`. Summarize:
   - Upstream commit range (`<prev-upstream-sha>..<new-upstream-sha>`)
   - Conflict resolution and semantic audit decisions
   - Renumbered TeamHub migrations (or explicit confirmation that none were
     added)
   - Local verification results
2. Watch GitHub Actions CI checks until all checks finish:

   ```bash
   gh pr checks <pr> --repo oldwinter/linger --watch
   ```

   If any CI check fails, inspect logs
   (`gh run view <run-id> --repo oldwinter/linger --log-failed`), fix on the
   sync branch, push, and re-watch. If genuinely blocked after repair attempts,
   stop **without merging** and report the exact failure.

3. Once all CI checks pass and the PR is cleanly mergeable, merge into
   `oldwinter/linger` `main` with a **regular merge commit**:

   ```bash
   gh pr merge <pr> --repo oldwinter/linger --merge < /dev/null
   ```

   - **NEVER** use `--squash` or `--rebase` (to preserve the `upstream/main`
     merge parent).
   - **NEVER** force-push `main`.

4. Confirm `state: MERGED` and capture `mergeCommit.oid`:

   ```bash
   gh pr view <pr> --repo oldwinter/linger --json state,mergedAt,mergeCommit,url
   ```

## 6. Local `main` Fast-Forward and Reporting

1. If `/Users/oldwinter/Code/linger` is clean
   (`git -C /Users/oldwinter/Code/linger status --porcelain` is empty) and
   checked out on `main`, fast-forward it cleanly:

   ```bash
   git -C /Users/oldwinter/Code/linger pull --ff-only
   ```

   Never force-reset, discard uncommitted changes, or switch branches in a dirty
   checkout.

2. Report the completed sync with:
   - Upstream commit range
   - Conflict resolution decisions and renumbered migrations (if any)
   - PR URL
   - CI status
   - Merge commit SHA
   - Local `main` HEAD
