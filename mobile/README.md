# Linger Mobile Companion

Linger Mobile is a native iOS, Android, and macOS/desktop-preview companion app for [Linger](../README.md), written in Go with [MyGo](https://github.com/egoist/mygo) (`github.com/egoist/mygo`). It connects directly to your Linger Desktop Companion Gateway over TLS 1.3 with SPKI certificate pinning—or to a remote/Tailscale TeamHub server—to monitor live Agents, approve Decision Cards, manage Local Models, capture Pocket Notes offline, and browse Documents, Personal Wiki, and Memory on the go.

For the full design rationale and wire-protocol specification, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## Features Across All 5 Tabs

1. **Rooms (Tab 1)**:
   - 5 room filters (`All`, `Unread`, `Working`, `Direct`, `Rooms`), pull-to-refresh, member avatar mosaics, unread and working-Agent badges, and `SwipeRow` quick actions (Pin/Unpin, Mark Read, Snooze/Rejoin).
   - Catch-Up Walk sheet for clearing unread Rooms and New Room / Direct Message creator.
   - Room Chat & Thread timeline with Town Light / Town Dark bubbles, Markdown rendering, authenticated image attachments with pinch-to-zoom lightbox, file share sheet, emoji reactions, pin/forward/thread creation, sandboxed `html_fragment` preview sheets, inline Mail Canvas approval, and all **12 TeamHub Decision Cards** (including unified code diffs and zoomable screenshots on `runtime_permission`).
   - IME-safe multiline composer with configurable `Return Key Sends Message` (`Cmd/Ctrl+Enter` always sends on hardware keyboards), photo/file attachment upload chips, `@Mention` and `/Skill` pickers, and per-room draft persistence.
   - **Live Run Watch**: real-time incremental streaming over `runtime-presentation-events`, structured Execution Plan checklist, expandable Tool & Activity timeline, Stop Run confirmation with haptics, Redeliver Unconfirmed Inputs, and Background Tasks drawer.
   - **Room Inspector**: room settings, members & Agents, pins & documents, `team.md`, and history share links.
2. **Live Ops (Tab 2)**:
   - **Runs**: active Agent runs across every Room with `Watch Live` and `Stop`.
   - **Approvals**: cross-room Pending Approvals Inbox reusing the shared 12-kind Decision Card component with duplicate-tap busy protection.
   - **Agents**: tenant Agent availability, swipe-to-DM, Agent detail/editor, Skill manifest bindings, templates, and Agent CRUD.
   - **Compute**: Desktop Companion host health card, Local Computers (host permissions, Chrome browser link, skill scan), Local Models manager (memory pool utilization bars, Download, Cancel Download, Load, `Make Room & Load` via `unload_first`, Unload, Remove, Recheck Hardware), and Model Source / BYOK switcher + connection tester + provider model browser.
3. **Work (Tab 3)**:
   - **Issues & Tasks**: filtered issue/task views (`Mine`, `Open`, `In Progress`, `Resolved`, `Archived`), creation sheet, detail view with transitions, assignees, comments, timeline, and task execution status.
   - **Routines**: room-filtered scheduled routines with create/edit schedule builder, enable/pause toggle, Run Now trigger, and delete confirmation.
   - **Pocket Notes**: offline-first daily scratchpad backed by a per-host SQLite outbox queue that survives offline restarts and syncs automatically on reconnect, plus Send to Another Me.
4. **Library (Tab 4)**:
   - Persistent **Global Search** combining instant offline SQLite FTS5 results with live TeamHub message and document search.
   - **Docs**: My Docs, Shared Docs, and Room Docs trees, native Markdown/Code/Image/HTML Document Reader, version history, comment threads, link shares, and uploads.
   - **Personal Wiki**: interactive pan/zoom Knowledge Graph canvas (`ui.Painter`) with category filters, accessible node chips, and wiki page detail sheet.
   - **Memory**: Daily, Weekly, and Meeting journals plus active Voice Capture transcript stream and question-to-task handoff.
5. **More (Tab 5)**:
   - **Overview**: Desktop host status card, multi-host switcher, Connection Hub launcher, one-tap Bearer token rotation, diagnostics export, and Unpair / Sign Out.
   - **My Rules**: active and shadow Proactive Rules review (Promote, Pin, Edit, Mandate, Delete).
   - **Profile**: Account Profile editor, Personal Profile Markdown viewer/editor, and Personal Insights management.
   - **Connectors**: External Apps/Connections with per-Agent access grants, Web Search backend keys/default selection, and Voice provider key management (`Soniox`, `xAI`).
   - **Prefs**: Biometric App Lock (Face ID / Touch ID), Town Light / Town Dark / System appearance, density, haptics, Composer Return Key preference, and SQLite offline cache stats + clear action.

---

## Security Model

- **Opt-In Desktop Gateway (Default OFF)**: Linger Desktop's Companion Gateway only starts when explicitly enabled from the tray menu (`Mobile Companion…`) or via the standalone CLI.
- **TLS 1.3 + SPKI Certificate Pinning**: Desktop generates an ECDSA P-256 certificate (`0600` private key) and embeds its SHA-256 SPKI fingerprint in the QR URI (`linger://pair?v=1&...&fp=...`). Linger Mobile verifies the exact SPKI pin on every TLS 1.3 handshake (`VerifyPeerCertificate`) and refuses mismatched certificates. Plaintext HTTP is rejected unless the user explicitly opts in (for example over a private Tailscale tailnet).
- **Short-Lived Pairing Windows & Lockout**: Pairing accepts either a high-entropy QR `code` or a 6-digit `pin` during a 5-minute window and locks immediately after 5 failed attempts (`PAIRING_LOCKED`).
- **Scoped Bearer Tokens & Instant Revocation**: Each paired device receives a unique `lmc_` Bearer token stored in OS Keychain / Android Keystore (`mygo.Secrets`, never in plain preferences). Tokens can be rotated (`POST /companion/v1/token/rotate`) or revoked (`POST /companion/v1/unpair`), immediately severing active `/v0/events` SSE streams.
- **CSRF, DNS-Rebinding, & Path Guards**: The Desktop gateway rejects browser `Origin` headers, `Sec-Fetch-Site: cross-site`, unrecognized `Host` headers, path traversal sequences, and sensitive auth/enrollment endpoints (`/v0/local/identity`, `/v0/auth/login`, `/v0/auth/logout`, `/v0/account/password`, `/v0/local-computer-enrollments`).

---

## Quick Start

### 1. Start the Desktop Companion Gateway

**Option A — Linger Desktop App (Electron)**:

1. Launch Linger Desktop and click the system tray icon -> **Mobile Companion…**.
2. Toggle **Enable Mobile Companion Gateway** ON and click **Open Pairing Window**.
3. Scan the QR code (or copy the `linger://pair?...` URI / 6-digit PIN) in Linger Mobile's Connection Hub.

**Option B — Headless Standalone Gateway (for servers or CLI testing)**:

```sh
pnpm exec tsx apps/desktop/src/main/companion/standalone.ts \
  --teamhub-url http://127.0.0.1:8080 \
  --port 48210 \
  --tls \
  --open-pairing \
  --email you@example.com \
  --password your-password
```

The command prints the TLS SPKI short fingerprint, 6-digit PIN, and `linger://pair?...` URI. Use `--no-tls` only when fronting over Tailscale or a trusted tunnel, and `--json` for machine-readable output.

### 2. Run the macOS / Desktop Live Preview

From `mobile/`:

```sh
make preview
```

To jump straight into a running Companion Gateway or pairing URI in an isolated preview directory:

```sh
make preview ARGS="--pair-uri 'linger://pair?...' --data-dir /tmp/linger-preview"
# or with an already-minted token:
make preview ARGS="--host-url https://127.0.0.1:48210 --token lmc_... --tls-fp <spki-fp> --theme dark --data-dir /tmp/linger-preview"
```

Supported CLI flags (`mobile/cmd/linger-mobile/main.go`):

- `--host-url`: Direct Companion Gateway or TeamHub URL for preview.
- `--token`: Companion `lmc_` Bearer token.
- `--tls-fp`: Base64url SHA-256 SPKI fingerprint for TLS 1.3 pinning.
- `--pair-uri`: Open Connection Hub directly with a `linger://pair?...` URI.
- `--data-dir`: Isolated directory for preferences, secrets, and SQLite cache.
- `--theme`: Force `system`, `light`, or `dark`.
- `--plain-http`: Explicitly opt in to plaintext HTTP (Tailscale / local dev).

### 3. Connection Methods

- **LAN mDNS Radar**: Automatically discovers Desktop hosts advertising `_linger._tcp.local.` on your local network.
- **QR Code / Deep Link**: Scan Desktop's QR code or open a `linger://pair?...` link (`mygo.App.OnOpenURL`).
- **6-Digit PIN (TOFU)**: Enter host address and 6-digit PIN, verify the 8-character SPKI short code shown on Desktop, and pair.
- **Tailscale / Direct URL**: Automatic LAN-to-Tailscale failover (1.5s LAN probe timeout) or direct TeamHub HTTPS login (`POST /v0/auth/login` with cookie auth).

---

## Testing & Verification

From `mobile/`:

```sh
# Vet, run all unit/golden/cross-stack E2E tests with -race, and build e2e + release binaries:
make check

# Run individual targets:
make vet
make test
make golden
make build-e2e
make build-release
```

The `go test -race -count=1 ./...` suite includes:

- **Cross-Stack E2E (`internal/e2e/companion_gateway_e2e_test.go`)**: Boots a real TeamHub-compatible HTTP/SSE upstream and the real Node `apps/desktop/src/main/companion/standalone.ts` TLS 1.3 gateway, proving SPKI pinning rejection/acceptance, QR & PIN pairing, 5-attempt `PAIRING_LOCKED`, live `/v0/events` SSE delivery, all 5 tabs' `/v0/*` proxy flows, SQLite offline Pocket Note outbox drain, token rotation (`401` on old token), unpair instant SSE termination, and CSRF/Host/forbidden-path `403` defenses.
- **Golden UI Snapshots**: Pixel-verified `390x844` Light & Dark Town theme snapshots across all 5 tabs and Connection Hub.
- **Desktop Companion Tests**: Run `make check-desktop` from the repository root to validate the Electron gateway, mDNS responder, pairing store, QR generator, TLS material, and tray wiring.

---

## Building for iOS & Android

`mobile/mygo.json` declares the app bundle identifier (`ai.linger.mobile`), `linger://` URL scheme, iOS Bonjour/Camera/Face ID Info.plist permissions, Android permissions (`minSdk: 26`), and MyGo native plugins (`sqlite`, `preferences`, `biometrics`, `camera`, `imagepicker`).

Install the pinned MyGo CLI:

```sh
go install github.com/egoist/mygo/cmd/mygo@v0.10.1-0.20261123162213-5fe46f2dd0be
```

Build from `mobile/`:

```sh
# Check local Xcode / Android SDK prerequisites:
mygo doctor

# iOS Simulator bundle (macOS with Xcode):
mygo build -platform ios/simulator

# iOS Device (requires Apple signing team configured in Xcode / mygo.json):
mygo build -platform ios/arm64

# Android ARM64 APK (requires JDK 17 + Android SDK/NDK + CMake):
mygo build -platform android/arm64
```

GitHub Actions automates Go vet/race tests, iOS Simulator builds (`macos-latest`), Android ARM64 APK builds (`ubuntu-latest`), and Desktop Companion checks in [`.github/workflows/mobile-ci.yml`](../.github/workflows/mobile-ci.yml).

---

## Scope & Honest Limitations (v1)

- **Voice Meetings & Captures**: Mobile supports viewing live Voice Capture transcripts over SSE, managing Voice provider keys (`Soniox`, `xAI`), stopping captures, retrying transcript recovery, and turning capture questions into Tasks. Bidirectional LiveKit WebRTC microphone audio capture/playback is deferred to post-v1.
- **Native Mobile Packaging**: Local iOS and Android builds require Xcode (on macOS) and the Android SDK/NDK + JDK 17 respectively; when those SDKs are not installed locally, use `make preview` / `make check` locally and verify mobile native compilation via `.github/workflows/mobile-ci.yml`.
- **Single-Host Active Stream**: Multiple Desktop and remote TeamHub hosts can be saved and switched in one tap, with one active `/v0/events` SSE connection and isolated per-host SQLite cache at a time.
