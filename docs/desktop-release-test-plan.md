# Desktop Release Test Plan

Authoritative release-candidate verification checklist for Desktop packages across
`darwin-arm64`, `linux-x64`, and `win32-x64`.

Use this guide alongside:

- [Desktop Release](desktop-release.md) (build workflow, signing, auto-update,
  physical Windows acceptance, and packaging layout)
- [Desktop Client and Local Installer](../.agents/skills/verify-linger/features/desktop-and-installer.md)
  (full cross-platform journeys and upgrade recipes)
- [Local Models and BYOK](../.agents/skills/verify-linger/features/local-models-and-byok.md)
  (hardware planning, model library, BYOK, and sleep/wake/quit matrix)
- [Local Computer](../.agents/skills/verify-linger/features/local-computer.md)
  (Computer Daemon, browser/desktop tools, and TCC permission guidance)

## App Identity and Default Paths

`oldwinter/linger` ships isolated `LingerX` builds so they can coexist with
upstream `Linger` installs. Substitute the column matching the build under test:

| Item                             | LingerX (`oldwinter/linger`)            | Upstream Linger (`simplexai-labs/linger`) |
| -------------------------------- | --------------------------------------- | ----------------------------------------- |
| App name / bundle                | `LingerX.app`, `lingerx`, `LingerX.exe` | `Linger.app`, `linger`, `Linger.exe`      |
| macOS / Windows App ID           | `dev.oldwinter.lingerx.desktop`         | `com.simplexai.linger.desktop.preview`    |
| Bundled CuaDriver ID (macOS)     | `com.trycua.driver`                     | `com.trycua.driver`                       |
| Default `LINGER_HOME` (`<home>`) | `~/.lingerx`                            | `~/.simplexai`                            |
| Default workspace / user folder  | `~/LingerX`                             | `~/Linger`                                |
| Desktop `userData`               | `<appData>/LingerX`                     | `<appData>/Linger`                        |
| Windows per-user install dir     | `%LOCALAPPDATA%\Programs\LingerX`       | `%LOCALAPPDATA%\Programs\Linger`          |

## Section 0.4: Full Cleanup

Before starting a clean-machine release-candidate run (or after finishing a
disposable-host run), tear down processes before deleting files:

1. **Stop running Desktop and local services first:**
   - Quit Desktop and stop all local services explicitly:
     - macOS / Linux: run the bundled installer with
       `ELECTRON_RUN_AS_NODE=1 <electron-bin> <app>/dist/installer/installer.js --home <home> --instance desktop --stop`
       (or stop any running test home's services).
     - Windows: run the graphical uninstaller from **Add or remove programs**,
       which runs `LingerX.exe --quit` and `installer.js --instance desktop --stop`.
   - Confirm zero leftover `postgres`, `livekit`, `teamhub`, `node-services`,
     `web`, `native-process-worker.mjs`, `installer.js`, `linger-computer-daemon`,
     `llama-server`, or `bifrost-http` processes remain for the tested home.

2. **Remove Desktop app state and installation home:**
   - Remove the app bundle / install directory, `<userData>` (`<appData>/LingerX`
     or `<appData>/Linger`), and `<home>` (`~/.lingerx` or `~/.simplexai`).
   - **Per-home `localmodels` isolation:** Managed `localmodels` state now lives
     entirely inside `<home>/runtime/localmodels/` (`state/`, `models/`,
     `tools/`, `bifrost/`, `bifrost-addr`, `plan.json`, `plan-inputs.json`,
     `binding.json`). Removing `<home>` removes all `localmodels` state for
     current builds.
   - **Legacy pre-isolation `~/.local/share/localmodels` remnants:** Builds
     prior to per-home isolation stored shared `localmodels` tools, `owned.json`,
     and Bifrost state in `~/.local/share/localmodels`
     (`%USERPROFILE%\.local\share\localmodels` on Windows).
     - On a dedicated disposable test machine or account, remove
       `~/.local/share/localmodels` after stopping services.
     - On a shared machine, inspect
       `~/.local/share/localmodels/tools/owned.json` first and remove only
       deployments whose `deploy_dir` points under the tested
       `<home>/runtime/localmodels/models` so other homes or external
       `localmodels` users are untouched.

3. **macOS case-insensitive APFS caution (`~/Linger` vs `~/linger`):**
   - Default macOS APFS volumes are case-insensitive: `~/Linger` and `~/linger`
     (and likewise `~/LingerX` and `~/lingerx`) resolve to the **same
     directory**. Verify what lives there before running `rm -rf` so you do not
     delete a repository checkout or unrelated user directory with a different
     letter case.

4. **macOS TCC permission reset (`tccutil`) safety:**
   - **Never run unscoped `tccutil reset` on a remotely driven Mac** (for
     example, `tccutil reset Accessibility` or `tccutil reset ScreenCapture`
     without a bundle ID). An unscoped reset clears grants for every app on the
     machine, which immediately revokes UI-scripting (`Accessibility`) and
     screen-capture (`ScreenCapture`) rights of a remote tester's own session
     (Screen Sharing, VNC, remote desktop clients, or automation hosts).
   - Always scope resets to the exact bundle IDs under test:

     ```sh
     tccutil reset ScreenCapture dev.oldwinter.lingerx.desktop
     tccutil reset Accessibility dev.oldwinter.lingerx.desktop
     tccutil reset ScreenCapture com.trycua.driver
     tccutil reset Accessibility com.trycua.driver
     ```

     (Replace `dev.oldwinter.lingerx.desktop` with
     `com.simplexai.linger.desktop.preview` when testing upstream Linger.)

## Packaging Verification

### `PKG-02`: Pinned `localmodels` Version in Packaged App

The pinned `localmodels` distribution metadata is written to
`dist/installer/distribution.json` inside the packaged app — **not** under
`app/dist/main` (grepping `app/dist/main` finds nothing):

- **macOS:** `LingerX.app/Contents/Resources/app/dist/installer/distribution.json`
- **Linux:** `LingerX-<version>-linux-x64/resources/app/dist/installer/distribution.json`
- **Windows:** `<install-dir>\resources\app\dist\installer\distribution.json`

Verify `.localmodelsTool.url`, `.localmodelsTool.sha256`,
`.localmodelsTool.sourceCommit`, `.localmodelsTool.runtimeVersions`, and
`.localmodelsTool.runtimeBaselines` against the target manifest in
`apps/desktop/distribution/<target>.json` and `scripts/installs/stack.sh` /
`scripts/installs/stack.ps1`:

```sh
node -e '
  const fs = require("node:fs");
  const dist = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  console.log({
    url: dist.localmodelsTool.url,
    sha256: dist.localmodelsTool.sha256,
    sourceCommit: dist.localmodelsTool.sourceCommit,
    runtimeVersions: dist.localmodelsTool.runtimeVersions,
    runtimeBaselines: dist.localmodelsTool.runtimeBaselines,
  });
' "$DIST_JSON"
```

**Expected (current pin):**

- `localmodelsTool.url` points to **`0.1.0.dev59`**
  (`sourceCommit`: `338045db9b72ac12815fda1f804f9451c50535e7`).
- `runtimeVersions`: `claude: 2.1.325`, `codex: 0.171.0`, `pi: 1.5.2`.
- `runtimeBaselines`: `claude: 2.1.282`, `codex: 0.166.0`, `pi: 1.2.0`.

### `PKG-04`: Signed Auto-Update Manifest (`manifest.json.sig`) — Release-Pipeline-Only

**Scope: Release-pipeline-only.** `scripts/ci/desktop-release.sh manifest`
writes `manifest.json` and `manifest.json.sig` only when
`DESKTOP_UPDATE_KEY_PEM` is supplied (required on published release-pipeline
runs in [`.github/workflows/release.yml`](../.github/workflows/release.yml) and
official publishes in
[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)).

- **Unsigned RC or local builds without the update signing key:** Mark `PKG-04`
  as **N/A (release-pipeline-only)**; `manifest.json` and `manifest.json.sig`
  are intentionally absent.
- **Signed release-pipeline builds:** Confirm `manifest.json` (schema 2),
  `manifest.json.sig`, and matching entries in `SHA256SUMS.txt` are published,
  and that `manifest.json.sig` verifies against `UPDATE_PUBLIC_KEY` in
  `apps/desktop/src/main/update-manifest.ts`.

### `PKG-05`: `tesseract.js` Excluded from Packaged Services

`apps/desktop/scripts/build-native-runtime.mjs` and
`apps/desktop/scripts/bundle-node-services.mjs` exclude `tesseract.js` (and its
transitive-only dependencies such as `tesseract.js-core`) on every platform,
because document extraction always calls `officeparser` with `ocr: false`.

**Check:**

- **macOS:**

  ```sh
  find "/Applications/LingerX.app/Contents/Resources" \
    \( -iname '*tesseract*' -o -iname '*traineddata*' \)
  ```

- **Linux and Windows:** Inspect the bundled runtime archive at
  `resources/app/dist/installer/native/runtime-<target>/runtime.tar.zst`:

  ```sh
  zstd -dc "$RUNTIME_TAR_ZST" | tar -tf - | grep -iE 'tesseract|traineddata' || true
  ```

**Expected:** **0 matching files or archive entries** on macOS, Linux, and
Windows. As a functional cross-check, attaching `.docx` and `.pptx` files in a
Room still extracts text cleanly through `officeparser`.

## First-Run Setup and Local Models

### `SET-01`: Installer Job Record Verification

Saved installer job records live under `<home>/installer/jobs/<uuid>.json` with
the persisted JSON wrapper `{ "job": { "id": "...", "state": "...", ... }, "events": [...] }`.

- When reading a saved job file on disk, assert **`.job.state`** equals
  `"succeeded"` (not `.status`):

  ```sh
  jq -r '.job.state' "$LINGER_HOME/installer/jobs/<job-id>.json"
  ```

- When querying the live installer loopback API (`GET /api/jobs/:id`), the
  response body is the inner `InstallationJob` object, whose field is `.state`
  (`"succeeded"`).

### `SET-02`, `SET-04`, and `SET-06`: Setup Model Source, Local Model Visibility, and Shared-GPU Default

- **Shared-GPU planning default:** `DEFAULT_GPU_SHARING` is `true`, so
  `localmodels setup inspect` runs with `--share-gpu` by default and plans
  against currently free memory on GPUs shared with other processes without
  stopping them.
- **Customize UI structure (`apps/desktop/src/shell/setup.html`):** Customize
  uses a 3-way **Model source** selector (**Local model** | **Subscription** |
  **BYOK**):
  - **Local model** always runs via **Pi** (`Recommended for this computer · Runs on Pi via Bifrost` / `Runs your tasks on this computer via Pi`). There is
    no separate Codex/Claude/Pi toggle inside the Local model section and no
    legacy Pi-only disabled hint.
  - **Subscription** selects `Auto`, `Codex`, or `Claude Code`.
  - **BYOK** selects `Claude Code`, `Codex`, or `Pi` plus endpoint/key/model
    settings.
- **Local model card visibility after inspection settles:** Once hardware
  inspection finishes (`checked` or `unavailable`), choosing **Local model**
  under Customize **always shows the `#local-model` card** (it is never hidden):
  - **`ready`:** Card is enabled (`aria-checked="true"`), displays the selected
    model name plus download, disk, and memory estimates.
  - **`blocked-now` (on hold):** When hardware is capable but temporarily
    blocked (for example, another process holds GPU/RAM memory, gateway port in
    use, or NVIDIA driver too old), the card remains visible and **disabled**
    (`aria-checked="false"`), showing either the planned model name or
    `Local model on hold`, structured reason copy mapped from the tool's reason
    code (`gpu-memory-required`, `free-memory-required`,
    `gpu-ownership-unknown`, `cuda-driver-*`, `gateway-port-in-use`,
    `harness-unavailable`), and a **Check again** button (plus NVIDIA driver
    update actions on Windows for CUDA driver blocks). The **Install** button is
    disabled while `Local model` is selected.
  - **`unavailable`:** When no local model fits this computer (or inspection
    could not run), the card remains visible and **disabled**
    (`aria-checked="false"`), showing `Not available on this computer` and
    structured reason copy (`No local model fits this computer.`,
    `Local models don't run on this system.`, or
    `Couldn't check this computer for a local model.`).
- **Welcome screen Quick Install fallback:** When the local stack is
  `blocked-now` or `unavailable`, Quick Install recommends an alternative
  runtime (`Claude Code`, `Codex`, or `Pi`) based on `linger-computer-daemon`
  probing and displays the structured reason under `#plan-why`.

### `LM-05`, `SET-06`, `SET-07`, and `E5`: Current `localmodels` Pin and Gateway Layout

- **Version expectations:** The pinned `localmodels` release is **`0.1.0.dev59`**,
  so all `≥ 0.1.0.dev37` / `≥ 0.1.0.dev38` expectations apply.
- **No `$INST/model-gateway/` directory on current installs:** Do **not** check
  for `$INST/model-gateway/`. That directory is only inspected during retirement
  of a legacy pre-controller gateway left by an earlier release.
- **Current paths to assert instead:**
  - Instance binding files: `<instance>/model-services.json` and
    `<instance>/model-gateway.json`
    (`schema: "localmodels.service-controller-binding/v1"`, pointing to
    `<home>/runtime/model-services/control.key` and
    `<home>/runtime/model-services/bridge`).
  - Per-home `localmodels` root: `<home>/runtime/localmodels/` containing
    `state/`, `models/`, `tools/`, `bifrost/`, `bifrost-addr` (defaults to
    `127.0.0.1:18480` or an allocated free loopback port), and `plan.json`.

## Upgrade Verification

### `UPG-01`, `UPG-02`, and `WIN-10`: Automatic Service Upgrade and Stale Supervisor Handoff

Execute upgrades with services and (where hardware supports it) a local model
still running, following
[Upgrade from the previous release](../.agents/skills/verify-linger/features/desktop-and-installer.md#upgrade-from-the-previous-release):

- **`UPG-01` (Automatic service update on launch):**
  - The tray menu has **no** `"Update Linger on This Computer"` item.
  - After replacing the app (macOS drag-replace or in-app **Restart to Update**,
    Windows `-setup.exe` or `/update /relaunch`, Linux extracting over the old
    folder or into a new folder), launching the newer Desktop app automatically
    detects its newer bundled source package, shows
    `Updating LingerX on this computer…`, moves the local services onto the new
    source via `installer.js --resume`, and prunes the old source folder.
  - Launching an older app over a newer local installation does not downgrade
    services and logs `local_server.source_newer_than_app`.
- **`UPG-02` and `WIN-10` (Zero old-folder supervisors or stale installer managers):**
  - Native service leases record each supervisor's script path, Node executable,
    and worker SHA-256 digest (`packages/local-installation/src/native-process.ts`).
    On upgrade or re-extract (including when Linux `/proc/<pid>/exe` reports
    `(deleted)`), `nativeSupervisorsStale` flags mismatched supervisors and
    `startNativeProcess` cleanly stops and relaunches each affected service
    (including PostgreSQL and LiveKit supervisors) under the new installation's
    supervisor.
  - Completed installs call `installer.shutdown()`, and `--resume` with
    `--external-computer` retires any idle desktop-owned `installer.js` via
    `/api/retire` without interrupting active jobs.
  - **Expected after upgrade settles:**
    - `desktop/local-server.json` records the candidate version and new source
      folder.
    - **Zero** running processes (`postgres`, `livekit`, `teamhub`,
      `node-services`, `web`, `native-process-worker.mjs` supervisors, or
      `installer.js`) run from the previous app bundle or previous extract
      directory.
    - Existing Rooms, messages, Documents, Agents, Computer enrollment, and
      model source remain intact and answer a fresh prompt.

## Desktop Lifecycle Verification

### `LIFE-01` and `LIFE-02`: Quit and `Quit and Stop Tasks`

Authoritative contract lives in
[Desktop Lifecycle Verification (LIFE-01 and LIFE-02)](desktop-release.md#desktop-lifecycle-verification-life-01-and-life-02)
and is tested across tray Quit, `Cmd+Q`, and Dock / App menu Quit:

- **`LIFE-01` (Quit preserves local background services):** Plain
  **Quit LingerX** (idle) and **Quit and Stop Tasks** (busy) exit the Desktop
  app, the Local Computer Daemon, and any Agent-managed browser, and run
  detached `installer.js --stop-local-models`
  (`<home>/installer/local-models-stop.log` ends with `{"failed":[]}`, unloading
  local models and stopping Bifrost). Local background services (`PostgreSQL`,
  `TeamHub`, `node-services`, `web`, `LiveKit`, and the `local-models`
  controller) intentionally stay running so web and mobile clients keep working.
  Full teardown occurs only on explicit `installer.js --instance desktop --stop`
  or uninstall.
- **`LIFE-02` (`Quit and Stop Tasks` keeps stopped Tasks stopped on reopen):**
  Quitting while local tasks or Room Runs are active prompts with
  **Quit and Stop Tasks** and **Keep Running**. Choosing **Keep Running** leaves
  running tasks undisturbed. Choosing **Quit and Stop Tasks** cancels queued and
  running Room Runs and drains active Computer Operations with the structured
  `desktop_quit_stop_tasks` cancellation reason before exiting. On reopen (~3
  seconds later), Tasks stopped via **Quit and Stop Tasks** remain stopped
  (`canceled`) or `failed`, are **not** automatically re-dispatched or resumed,
  and the tray returns to idle (`Online · Idle`).

## Diagnostics Verification

### `DIAG-01`: Redacted Diagnostics Secret Audit

1. Trigger **Save Diagnostics** from the tray or offline screen and unpack
   `linger-diagnostics-<stamp>.zip` into a temporary directory `$UNPACKED_DIAG`.
2. Confirm excluded credential and database files are absent (`*.env`,
   `*.input.json`, `api-key`, `byok.json`, `local-account.json`,
   `credential.json`, `gateway.json`, `caller.key`, `control.key`,
   `launch.html`, `postgres-password`, `auth.json`, `.credentials.json`,
   `*.sqlite*`, `*.db`, `*.key`, `*.pem`, `*.p12`), and that the user's home
   directory path is redacted to `~`.
3. Scan unpacked text files for leaked API keys or bearer tokens using patterns
   that do **not** false-positive on TeamHub paths containing `task-` (do not
   grep for bare `sk-`):

   ```sh
   grep -rnE '(^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}' "$UNPACKED_DIAG" || true
   grep -rnE 'AIza[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{20,}' "$UNPACKED_DIAG" || true
   grep -rnE 'Bearer [^\[][^[:space:]]+' "$UNPACKED_DIAG" || true
   ```

**Expected:** Zero real secret matches across all unpacked diagnostics files.

## Computer Use Verification

### `CU-02` Step 2: Public Example Page Link Text

- When running the `CU-02` browser navigation step against `https://example.com`,
  the link text rendered on `example.com` is **`Learn more`** (not
  `"More information"`), pointing to `iana.org`
  (`https://iana.org/help/example-domains`).
- Because public websites can change at any time, also run the owned local
  challenge-page browser journey in
  [Desktop and browser tools](../.agents/skills/verify-linger/features/local-computer.md#desktop-and-browser-tools)
  for deterministic form-read and submission proof.
