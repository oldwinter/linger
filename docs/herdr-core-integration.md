# Herdr Core (`hc`) Integration Architecture

## 1. Context and Goals

Linger already includes an optional bridge to legacy `herdr` v0.9.5 (`apps/computer/local-daemon/internal/linger/herdr/`), which watches coding agent panes over `~/.config/herdr/herdr.sock` (protocol 22) and lets Another Me deliver an owner's answer to a blocked pane. Legacy `herdr` is Unix-only, pane/workspace coupled, lacks remote execution primitives, and has no multiplexed binary PTY streaming.

`herdr-core` (`hc` v0.1.21, Apache-2.0) separates the persistent terminal runtime from any desktop GUI:

- **OpenRPC 1.3.2 / JSON-RPC 2.0 protocol (generation 1, 32 methods)** over newline-delimited JSON or a multiplexed 9-byte little-endian binary frame protocol after `hello(framed: true)`.
- **Native OSC 7501 Program Status Protocol** (`idle`, `working`, `done`, `blocked`, `error` plus `kind`: `permission`, `question`, `auth`, `progress`, `app`, `title`, `msg`) with a server-maintained `turn` counter.
- **Persistent cross-platform sessions** across macOS, Linux, and Windows (including `hc connect` stdio tunneling, SSH and `--via` remote machine meshes, and holder-based restarts that preserve running terminals).
- **Execution fabric primitives**: role templates (`templates.list`), parent/child terminal trees (`parent`, `terminal.wait(children)`), shell-less remote command execution (`machine.exec`), atomic text/binary file access (`file.read`, `file.write`, `file.edit`), attachment drop-off (`terminal.put`), and optimistic-concurrency JSON documents (`doc.get`, `doc.set`).

This RFC defines the three-phase integration of `herdr-core` into `oldwinter/linger` across Local Computer Daemon, Control Plane (TeamHub, Node Services, `teamhub` CLI), Web/Desktop Workbench, and Mobile Companion.

## 2. Dual-Stack Coexistence

Legacy `herdr` v0.9.5 and `herdr-core` v0.1.21+ MUST coexist side by side without breaking existing installations, persisted state, or published built-in Skills:

| Dimension            | Legacy `herdr` (v0.9.5)                                                                             | `herdr-core` (`hc` v0.1.21+)                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Daemon Go package    | [internal/linger/herdr](../apps/computer/local-daemon/internal/linger/herdr/client.go) (frozen)     | `apps/computer/local-daemon/internal/linger/herdrcore`                                                                                                                                                 |
| Binary discovery     | `herdr` on terminal `PATH`                                                                          | `hc` or `herdr-core` on terminal `PATH`                                                                                                                                                                |
| Socket / transport   | `$HERDR_SOCKET_PATH`, `$XDG_CONFIG_HOME/herdr/herdr.sock`, `~/.config/herdr/herdr.sock` (Unix only) | `$HC_SOCKET`, `$XDG_STATE_HOME/herdr-core/<session>/<session>.sock`, `~/.local/state/herdr-core/default/default.sock`; Windows and non-socket fallback via `hc connect --session <session>` over stdio |
| Session selector     | Single default socket                                                                               | `$HC_SESSION` (defaults to `default`; socket filename is `<session>.sock` inside `<state>/herdr-core/<session>/`)                                                                                      |
| Protocol             | Custom newline JSON, protocol 22                                                                    | JSON-RPC 2.0 OpenRPC generation 1 + framed binary channels                                                                                                                                             |
| Built-in Skill       | `simplexai_herdr` (`skills/builtin/herdr/1.0.0/`, immutable)                                        | `simplexai_herdr_core` (`skills/builtin/herdr-core/1.0.0/`)                                                                                                                                            |
| Permission guardrail | [permission/herdr.go](../apps/computer/local-daemon/internal/permission/herdr.go)                   | `apps/computer/local-daemon/internal/permission/herdrcore.go`                                                                                                                                          |
| Doctor check         | `herdr` line in [doctor.go](../apps/computer/local-daemon/internal/computercli/doctor.go)           | `herdr-core` line in [doctor.go](../apps/computer/local-daemon/internal/computercli/doctor.go)                                                                                                         |

When both `herdr` and `herdr-core` are installed on the same Computer:

1. Neither installation disables or modifies the other. `skills/builtin/herdr/1.0.0/` stays byte-identical to preserve built-in Skill immutability.
2. Daemon watchers run independently. Legacy `herdr` continues emitting `runner.herdr_event` for v0.9.5 panes; `herdr-core` emits its own feature-gated events carrying full `herdr-core` addresses (`t7`, `vps/t7`), OSC 7501 status records, `turn`, `status_ms`, and `labels`.
3. Doctor reports each installed engine on its own line (`herdr` and `herdr-core`), omitting either line when its binary is absent.

## 3. Runner Gateway Protocol 2 Negotiation (`service_features`)

Per [apps/computer/AGENTS.md](../apps/computer/AGENTS.md), a Local Computer Daemon can outlive its Agent Service release during desktop upgrades and rolling deploys, and the Daemon decodes gateway frames strictly. Any new Daemon-to-Agent or Agent-to-Daemon frame family within Runner Gateway protocol 2 MUST be gated by `runner.welcome`'s `service_features` list:

- **`herdr_core_v1`**:
  - Advertised by Agent Service once it supports `herdr-core` RPC dispatch, `herdr-core` agent event forwarding (`agent_blocked`, `agent_finished`, `agent_error`), and `herdr-core` answer-card delivery (`answer_text`, `answer_keys`).
  - The Daemon emits `herdr-core` status events and accepts `herdr-core` control calls only when `runner.welcome.service_features` includes `herdr_core_v1`.
- **`herdr_core_stream`**:
  - Advertised by Agent Service once it supports multiplexed binary PTY attach tunnels bridging Daemon `AttachSession` channels to WebSocket clients.
  - The Daemon opens framed `terminal.attach` streams only when `runner.welcome.service_features` includes `herdr_core_stream`.

Compatibility guarantees:

- **New Daemon + Old Agent Service**: `service_features` lacks `herdr_core_v1` / `herdr_core_stream`; Daemon never sends unknown frames and falls back cleanly to legacy `herdr` (if present).
- **Old Daemon + New Agent Service**: Old Daemon ignores unknown entries in `service_features`; Agent Service checks Computer capabilities/version before dispatching `herdr-core` requests and surfaces a structured `HERDR_CORE_UNAVAILABLE` error to callers.

## 4. Canonical Control Plane REST and WebSocket Contracts

### 4.1 Slash-Safe Address Routing

`herdr-core` addresses remote terminals as `<machine>/<id>` (for example `vps/t7` or `rohan/t12`). Placing terminal addresses in URL path parameters (`/terminals/:address`) creates `%2F` decoding mismatches across reverse proxies, Gin's router, Vite dev proxy, and mobile HTTP stacks.

**Rule**: Terminal addresses NEVER appear in URL path segments.

- Read and streaming endpoints (`GET`, `WS`) pass `address` as a query parameter: `?address=vps/t7`.
- Mutating endpoints (`POST`, `PATCH`, `DELETE`) pass `address` inside the JSON request body: `{"address": "vps/t7", ...}`.

### 4.2 Planned Product API Surface (Phase 2)

All endpoints live under `/v0/computers/:computerId/herdr-core` with Computer owner authorization and standard TeamHub `{"error": {"code", "message", "request_id", "details"?}}` envelopes:

| Endpoint                                                                                                                        | Transport | Purpose                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /v0/computers/:computerId/herdr-core/status`                                                                               | REST      | Core info, version, pid, uptime, holder count, live/finished counts, logout linger warning                  |
| `GET /v0/computers/:computerId/herdr-core/templates`                                                                            | REST      | Available `~/.config/herdr-core/templates/*.md` roles (`templates.list`)                                    |
| `GET /v0/computers/:computerId/herdr-core/terminals?all=false&label=k=v`                                                        | REST      | Snapshot of live (or all) terminals and added machines (`terminal.list`)                                    |
| `GET /v0/computers/:computerId/herdr-core/terminal?address=vps/t7`                                                              | REST      | Single terminal facts (`terminal.get`)                                                                      |
| `POST /v0/computers/:computerId/herdr-core/terminals/run`                                                                       | REST      | Start a program, shell, or template (`terminal.run`) with optional `on`, `cwd`, `labels`, `size`, `display` |
| `GET /v0/computers/:computerId/herdr-core/terminal/read?address=vps/t7&lines=100`                                               | REST      | Screen plus bounded scrollback text (`terminal.read`)                                                       |
| `POST /v0/computers/:computerId/herdr-core/terminal/send`                                                                       | REST      | Deliver text + Enter (`terminal.send`) with optional `if`, `force`, `wait`, `timeout`                       |
| `POST /v0/computers/:computerId/herdr-core/terminal/keys`                                                                       | REST      | Deliver named keys (`terminal.keys`)                                                                        |
| `POST /v0/computers/:computerId/herdr-core/terminal/interrupt`                                                                  | REST      | Send stop key (`esc` or `ctrl+c`) without escalating (`terminal.interrupt`)                                 |
| `POST /v0/computers/:computerId/herdr-core/terminal/kill`                                                                       | REST      | Terminate terminal program (`terminal.kill`)                                                                |
| `POST /v0/computers/:computerId/herdr-core/terminal/rm`                                                                         | REST      | Remove finished terminal (`terminal.rm`)                                                                    |
| `POST /v0/computers/:computerId/herdr-core/terminal/keep`                                                                       | REST      | Toggle crash-recovery shell (`terminal.keep`)                                                               |
| `POST /v0/computers/:computerId/herdr-core/terminal/label`                                                                      | REST      | Set or remove labels (`terminal.label`)                                                                     |
| `POST /v0/computers/:computerId/herdr-core/terminal/put`                                                                        | REST      | Upload file/image bytes (max 8 MiB raw) beside terminal (`terminal.put`)                                    |
| `GET /v0/computers/:computerId/herdr-core/machines`                                                                             | REST      | List configured remote machines (`machine.list`)                                                            |
| `POST /v0/computers/:computerId/herdr-core/machines/add`                                                                        | REST      | Add SSH or `--via` machine (`machine.add`)                                                                  |
| `POST /v0/computers/:computerId/herdr-core/machines/connect`                                                                    | REST      | Trigger immediate reconnect (`machine.connect`)                                                             |
| `POST /v0/computers/:computerId/herdr-core/machines/rename`                                                                     | REST      | Rename saved machine (`machine.rename`)                                                                     |
| `POST /v0/computers/:computerId/herdr-core/machines/rm`                                                                         | REST      | Forget saved machine (`machine.rm`)                                                                         |
| `POST /v0/computers/:computerId/herdr-core/exec`                                                                                | REST      | Run shell-less `argv` or shell `line` without a PTY (`machine.exec`)                                        |
| `POST /v0/computers/:computerId/herdr-core/file/read`                                                                           | REST      | Read line range of local/remote text file (`file.read`)                                                     |
| `POST /v0/computers/:computerId/herdr-core/file/write`                                                                          | REST      | Atomically write local/remote file (`file.write`)                                                           |
| `POST /v0/computers/:computerId/herdr-core/file/edit`                                                                           | REST      | Atomically apply exact `old`/`new` edits (`file.edit`)                                                      |
| `GET /v0/computers/:computerId/herdr-core/doc?name=...&on=...`                                                                  | REST      | Read opaque JSON doc and CAS version (`doc.get`)                                                            |
| `PUT /v0/computers/:computerId/herdr-core/doc`                                                                                  | REST      | Write/delete opaque JSON doc with CAS version (`doc.set`)                                                   |
| `GET /v0/computers/:computerId/herdr-core/events`                                                                               | SSE       | Live ordered stream of terminal/machine/doc events (`events.subscribe`)                                     |
| `GET /v0/computers/:computerId/herdr-core/terminal/attach?address=...&cols=...&rows=...&observe=true&history=200&resumed=false` | WebSocket | Framed binary PTY stream relay (Section 7)                                                                  |

## 5. OSC 7501 Status Model and Event Watcher

`herdr-core` parses Program Status Protocol (OSC 7501) sequences emitted by coding agents and tools:

```text
ESC ] 7501 ; state=<state>:kind=<kind>:app=<app>:progress=<0..100>:title=<base64>:msg=<base64> ST
```

- Root status states: `idle`, `working`, `done`, `blocked`, `error` (cleared via `state=clear` or process exit).
- `kind` (for `blocked`): `permission`, `question`, or `auth`.
- `turn`: uint64 counter maintained by `herdr-core`; increments each time root status transitions away from `working`.
- `status_ms`: epoch milliseconds when root status last changed.

### 5.1 Event Ordering and Recovery

The Daemon watcher (`internal/linger/herdrcore/watch.go`) subscribes via `events.subscribe` instead of polling:

1. **Initial snapshot**: `SubscribeResult` returns `(seq, terminals)`. This establishes the baseline; already-blocked or already-finished terminals at startup or after a server restart do not produce spurious notifications.
2. **Ordered incremental stream**: JSON-RPC notifications with `method: "event"` carry `{seq, terminal, type, data}` (`created`, `lost`, `restarted`, `keep`, `finished`, `removed`, `status`, `turn`, `title`, `labels`, `size`, `foreground`, `doc`). Events with `seq <= lastSeq` are ignored.
3. **Heartbeat**: `method: "heartbeat"` every 15 seconds keeps idle connections alive.
4. **Lag recovery (`missed`)**: When a slow consumer falls behind, `herdr-core` sends a `missed` notification with a fresh snapshot `(seq, terminals)`. The watcher resets `lastSeq` to the snapshot `seq`, discards subsequent events with `seq <= lastSeq`, diffs the previous terminal map against the fresh snapshot, and emits any missed `blocked`, `finished`, or `error` transitions.
5. **Status/turn coherence**: Empirical testing against `herdr-core` v0.1.21 shows that leaving `working` emits `type: "status"` immediately followed by `type: "turn"`. Before emitting a Linger transition, the watcher settles briefly and fetches the authoritative `terminal.get` snapshot alongside a bounded `terminal.read` tail (redacted and capped at 6,000 bytes), ensuring every emitted event carries the exact post-transition `turn`, `status_ms`, `labels`, and `foreground.cwd` without duplicate emissions.

### 5.2 Emitted Linger Transitions

- **`agent_blocked`**: Root status entered `blocked` (new `turn`, `status_ms`, `kind`, or `msg`). Triggers proactive judgment and optional owner Question Card.
- **`agent_finished`**: Terminal completed work (`turn` advanced into `done` or `idle`, or status entered `done` from a non-`done` state). Never fires for a fresh terminal starting `idle` at `turn == 0`.
- **`agent_error`**: Root status entered `error` (new `turn`, `status_ms`, or `msg`).

## 6. Answer Card Delivery

When an owner answers a blocked-agent Question Card in Linger Web, Desktop, or Mobile, TeamHub delivers the answer through the Local Computer Daemon with strict at-most-once semantics (never retried after dispatch).

### 6.1 Verified `terminal.send` `if` Constraint (`herdr-core` v0.1.21)

Inspection of `herdr-core schema` and live verification against `hc` v0.1.21 confirm that `terminal.send`'s `if` parameter is strictly typed as `IdleOrWorking` (`"idle" | "working" | null`). Sending `{"if": "blocked"}` fails with JSON-RPC error `-32602` (`data.kind = "invalid_params"`, `"unknown variant 'blocked', expected 'idle' or 'working'"`). Instead, `herdr-core` defines `force: true` specifically to answer a blocked prompt (`"Type even if the program is blocked (it may answer its dialog)"`).

### 6.2 Safe Pre-Checked Delivery Protocol

To prevent a late Answer Card response from typing into a different prompt or a resumed turn:

- **Free-text / option-text answers (`Client.AnswerText(ctx, address, expectedTurn, text)`)**:
  1. Reject empty/whitespace-only input or any Unicode control characters (`invalid_answer`).
  2. Call `terminal.get(address)` and verify `state == "live"`, `status != nil && status.state == "blocked"`, and `turn == expectedTurn`. Return `terminal_closed` (`not_found` / `finished` / `machine_unknown`), `herdr_core_unavailable` (transport failure), or `terminal_not_blocked` (state or `turn` mismatch) without typing anything.
  3. Call `terminal.send({terminal: address, text: text, force: true})` (omitting `if`).
- **Key-sequence answers (`Client.AnswerKeys(ctx, address, expectedTurn, keys)`)**:
  1. Validate non-empty key slice with no empty or control-character key names (`invalid_answer`).
  2. Perform the identical `terminal.get(address)` liveness + `blocked` + `turn == expectedTurn` guard.
  3. Call `terminal.keys({terminal: address, keys: keys})` (for dialog choices such as `["down", "enter"]`, `["y", "enter"]`, or `["esc"]`).
- **Failure classification**: Errors returned by `herdr-core` that prove nothing was typed (`not_found`, `finished`, `blocked`) map to `terminal_closed` / `terminal_not_blocked`; any transport/timeout error after dispatch propagates so TeamHub records `outcome_unknown` and never double-types.

## 7. Framed Binary PTY Attach Relay

### 7.1 Wire Framing Specification

After sending plain newline-delimited JSON-RPC `{"jsonrpc":"2.0","id":0,"method":"hello","params":{"generation":1,"framed":true}}\n` and reading its newline-delimited `HelloResult` (`framed: true`), both directions switch to 9-byte little-endian frames:

```text
+------------------+------------+------------------+-----------------------+
| channel (u32 LE) | kind (u8)  | length (u32 LE)  | payload (length B)    |
+------------------+------------+------------------+-----------------------+
```

| Kind | Name              | Payload                                                                                                                           | Direction                                                                                                        |
| ---- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `0`  | `DATA`            | Channel 0: UTF-8 JSON-RPC 2.0 message; Stream channel: raw PTY bytes (attach) or JSON-RPC event lines (framed `events.subscribe`) | Bidirectional                                                                                                    |
| `1`  | `CREDIT`          | `u32 LE` byte count consumed for flow control                                                                                     | Consumer -> Producer                                                                                             |
| `2`  | `CLOSE`           | Empty (clean channel shutdown)                                                                                                    | Bidirectional                                                                                                    |
| `3`  | `RESIZE`          | `u16 LE cols`, `u16 LE rows`                                                                                                      | Client -> Core (interactive resize); Core -> Observer before replacement paint when `resize_notifications: true` |
| `4`  | `FOCUS`           | `u8` (`0` = unfocused, `1` = focused)                                                                                             | Client -> Core                                                                                                   |
| `5`  | `FACTS`           | Stream metadata updates                                                                                                           | Bidirectional                                                                                                    |
| `6`  | `AUTOMATIC_INPUT` | Automated input bytes when `AttachResult.automatic_input == true`                                                                 | Client -> Core                                                                                                   |

### 7.2 Observe vs. Take Over, Reconnects, and File Drop (`terminal.put`)

- **Default Observe Mode**: Web Workbench and Mobile open `terminal.attach` with `observe: true, resize_notifications: true, history: <N>`. Observers never resize the underlying PTY or send keystrokes; when an active viewer resizes the terminal, `herdr-core` sends a `RESIZE(cols, rows)` frame immediately before the replacement screen paint so the remote xterm.js canvas matches the exact geometry.
- **Explicit Take Over**: Clicking "Take Over" opens an interactive attach (`observe: false`) that forwards keystrokes as `DATA` frames, viewport changes as `RESIZE` frames, and focus transitions as `FOCUS` frames.
- **Seamless Reconnect (`resumed: true`)**: After a dropped WebSocket or Runner Gateway reconnect, the client reattaches with `resumed: true` so `herdr-core` defers resizing the terminal until the viewer is active again, avoiding sudden reflows across multiple devices.
- **Image / File Paste (`terminal.put`)**: Dragging an image or file into the Web/Desktop/Mobile terminal uploads bytes (up to 8 MiB raw, base64) via `terminal.put(terminal, name, data)`. The file lands in a terminal-scoped directory on the terminal's machine (even across SSH `--on`), is cleaned up when the terminal is removed, and the returned path is pasted into the terminal input.
- **Backpressure**: `AttachSession` supports manual credit mode (`ManualCredit: true`) so the Daemon sends `FrameCredit` upstream only after bytes are flushed onto the Runner Gateway stream, bounding memory even on slow cellular links.

## 8. `hc` / `herdr-core` Permission Guardrail

Running `hc` or `herdr-core` inside an Agent's Bash tool can execute commands on the host or remote machines outside the Agent's sandbox without further review. The Daemon guardrail (`apps/computer/local-daemon/internal/permission/herdrcore.go`) mirrors the rigor of [permission/herdr.go](../apps/computer/local-daemon/internal/permission/herdr.go):

- **Read-only without review**: `--version` (`-V`), `--help` (`-h`), `--skill`, `--licenses`, `schema`, `ls`, `get`, `read`, `wait`, `events`, `templates`, `server status`, `machine ls`, `file read` (and bare help groups `file`, `machine`, `server`), with optional `--json` only. Leading flags other than `--json`, bare `hc` (interactive TUI attach), or redirects outside the workspace go to review.
- **Reviewed with structured `Delegation`**: `run`, `send`, `keys`, `interrupt`, `put`, `kill`, `rm`, `keep`, `label`, `exec`, `file write`, `file edit`, `machine add|rm|rename|login|update`, `server start|stop|restart`, `update`, `attach`, and `connect`.
  - Delegations conform strictly to the TeamHub OpenAPI `RuntimePermissionEvidenceDelegationsKind` enum (`shell_command`, `terminal_input`, `agent_prompt`, `agent_start`).
  - `--on <machine>` targets are preserved in `Delegation.Target` (for example `vps`, `vps/build`, or `vps:/srv/app/config.toml`), and `--via` / `--old` / `--new` payloads are surfaced in `Delegation.Text`.
  - Every extracted `Delegation.Text` passes through `SystemPrivacyUI` so macOS privacy-tampering commands (`tccutil`, `osascript` targeting System Settings) are denied immediately even when smuggled through `hc run`, `hc exec`, `hc send`, or `hc machine add --via`.
  - When shell syntax is outside `parseShell`'s literal subset (variable expansion, command substitution, backticks, unquoted heredocs) and names `hc` or `herdr-core` with a mutating subcommand (including quoted words or backslash-newline continuations), the Reviewer attaches `HerdrCoreUnreadMissing` to `Evidence.Missing` while avoiding false positives on read-only redirects.

## 9. Labels, Provenance, and `herdr-app` `doc` Sync

### 9.1 Standard Linger Labels

Terminals launched or adopted by Linger carry free-form `herdr-core` labels (never interpreted by `herdr-core`, filterable via `terminal.list(labels)` and `events.subscribe(labels)`):

- `linger.room`: Room ID where the terminal was launched or linked.
- `linger.work_item`: Work Item ID associated with the terminal, if any.
- `linger.agent`: Linger Agent ID that spawned or owns the terminal.
- `linger.origin`: Origin surface (`room_workbench`, `agent_delegate`, `mobile`, `user`).

### 9.2 Optimistic-Concurrency `doc` Sync

`herdr-core` provides `doc.get` and `doc.set` (opaque JSON values up to 1 MiB, CAS `version` counter, emits `type: "doc"` events across subscribers).

- Linger stores workbench metadata (pinned terminal groups, room-to-terminal bindings, last viewed layout) under its own dedicated document namespace (for example `linger-workbench`), NEVER overwriting `herdr-app`'s own document keys.
- Writes always perform read-modify-write CAS (`doc.get` -> transform -> `doc.set(version)`) and retry cleanly on `conflict` (`data.kind = "conflict"`), allowing multiple Linger clients and `herdr-app` to stay synchronized in real time via `events.subscribe`.

## 10. Execution Fabric

`herdr-core` extends Linger Agents beyond a single machine's synchronous Bash tool:

- **Role Templates**: `templates.list` exposes user-defined roles in `~/.config/herdr-core/templates/<name>.md` (YAML frontmatter `name`, `description`, `command`; Markdown body prepended to the task as the first message). Agents inspect `first_message.sent` after launching a template and read the screen before retrying if a startup dialog blocked delivery.
- **Parent/Child Orchestration**: Terminals spawned from inside a terminal inherit `parent` (`$HC_TERMINAL_ID`) and end with their parent unless `--outlive-parent` is set. Agents offload long builds, test suites, and helpers with `hc run --bg` and coordinate via `hc wait --children any|all` instead of sleeping or blocking their shell tool.
- **Multi-Machine Mesh**: `machine.add` connects SSH targets or custom `--via` transports (such as WSL, Fly, or container CLIs). All terminal, `machine.exec`, and `file.*` RPCs route transparently via `--on <machine>` or `<machine>/<id>` addresses.
- **Codex Runtime Rule**: When launching Codex inside an `hc` terminal or template, always pass `--no-daemon` so Codex's subprocesses execute inside the `hc` PTY and stay visible, steerable, and subject to `hc` lifecycle cleanup.

## 11. macOS Shared-Core TCC Preservation (`Herdr Core.app`)

On macOS, per-user `herdr-core` installs place the signed application bundle at `~/.local/share/herdr-core/active/Herdr Core.app` (referenced through a `current` symlink, with `hc` and `herdr-core` symlinks in `~/.local/bin`). The desktop core is started via a one-shot `launchd` job so terminals survive app exits and login-session refreshes.

Because macOS Transparency, Consent, and Control (TCC) associates privacy permissions (Full Disk Access, Accessibility, Screen Recording, Automation, folder access) with the responsible signed bundle:

1. **Privacy grants belong to `Herdr Core.app`**, not `LingerX.app` or `Herdr.app`.
2. **Linger MUST NOT bundle a private copy of `herdr-core`** inside `LingerX.app` or spawn a shadow core owned by `LingerX.app`. Doing so splits TCC grants, breaks user terminals' permissions, and causes terminals to terminate when `LingerX.app` quits.
3. **Linger connects strictly as a client** to the user's shared `herdr-core` socket (`~/.local/state/herdr-core/default/default.sock`, or `$HC_SOCKET` / `$HC_SESSION`), and NEVER runs `server.stop` or `server.restart` against the user's core.

## 12. Phased Delivery Roadmap

### Phase 1 — Foundation (Wave 1, this track)

- Architecture RFC (`docs/herdr-core-integration.md`).
- Self-contained Go client package `apps/computer/local-daemon/internal/linger/herdrcore` covering cross-platform discovery (`locate.go`), OpenRPC types (`types.go`), 9-byte binary framing (`frame.go`), plain and multiplexed JSON-RPC 2.0 + `hc connect` stdio fallback (`client.go`), framed PTY `AttachSession` (`attach.go`), `events.subscribe` watcher with `missed` recovery and safe `AnswerText`/`AnswerKeys` (`watch.go`), secret redaction (`redact.go`), and full fake-server race-tested coverage.
- `hc` / `herdr-core` permission guardrail (`internal/permission/herdrcore.go`) and Reviewer wiring.
- Built-in Skill `simplexai_herdr_core` (`skills/builtin/herdr-core/1.0.0/SKILL.md`), catalog registration, and Apache-2.0 attribution in [NOTICE](../NOTICE).
- `linger-computer doctor` `herdr-core` check (`internal/computercli/doctor.go`).

### Phase 2 — Control Plane and Daemon Bridge (Wave 2)

- OpenAPI and AsyncAPI contracts for `herdr_core_v1` / `herdr_core_stream` (`contracts/openapi/`, `contracts/runner-gateway/`).
- Local Computer Daemon bridge wiring: advertise capabilities, run `herdrcore.Watch` alongside legacy `herdr.Watch`, dispatch control RPCs, and bridge `AttachSession` to Runner Gateway binary streams.
- TeamHub REST/SSE/WS endpoints, Answer Card delivery over `AnswerText`/`AnswerKeys`, and Node Services stream relay.
- `teamhub computer hc` subcommands in `apps/teamhub-cli`.

### Phase 3 — Workbench and Mobile Surfaces (Wave 3)

- Web and Desktop Terminal Workbench: live xterm.js terminal panes over WS attach, Observe vs. Take Over toggle, `resumed: true` reconnects, drag-and-drop `terminal.put`, multi-machine sidebar, template launcher, and `doc` workspace state sync.
- Mobile Companion (`mobile/`): live terminal list, OSC 7501 status badges, one-tap Answer Cards (`text` and `keys`), read-only observe view, and quick handoff notifications.
