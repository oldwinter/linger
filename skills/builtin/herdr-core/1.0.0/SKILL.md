---
name: herdr-core
description: "Run persistent background commands, interactive coding agents, role templates, and multi-machine remote workflows through herdr-core (hc) or teamhub computer hc: launch background runs, coordinate child terminals with wait --children, read/edit/write remote files and run exec with --on <machine>, tag terminals with linger.* labels, and hand blocked agents to the user via question cards. Use when the user mentions herdr-core or hc, asks to delegate to a persistent terminal or coding agent, or needs remote machine access configured in hc."
---

<!-- Adapted for Linger Agents from herdr-core v0.1.21 (`hc --skill`), Apache License 2.0, https://github.com/herdrdev/herdr-core. See NOTICE. -->

# herdr-core (`hc`)

`herdr-core` (`hc`) runs programs and interactive coding agents in persistent terminals that survive disconnects and core updates. People can attach and take over at any time from their terminal, desktop workbench, or mobile app. Terminals and remote commands run with the user's own environment and credentials.

`hc` is distinct from legacy `herdr` (v0.9.5). Use `hc` (or `teamhub computer hc` when driving a Computer through the control plane) for `herdr-core`.

## Check availability first

Before starting work, verify that `hc` is installed and its core is reachable:

```bash
which hc && hc server status
```

If `hc` is missing or `hc server status` fails, tell the user `herdr-core` is unavailable on this Computer and stop. Never run `hc server stop`, `hc server restart`, `hc update`, or bare `hc` (bare `hc` opens an interactive terminal picker/attach TUI); managing the core lifecycle belongs to the user.

Use `hc <command> --help` to confirm exact flags on the installed binary. Piped output is JSON by default except `run`, `exec`, `read`, and `file read` (plain text; pass `--json` for structured output).

Addresses look like `t7` (local terminal ID), a unique live name (`review`), or `<machine>/t7` (remote machine terminal, such as `vps/t7`). Always keep and pass the full `<machine>/<id>` address for remote terminals.

## Templates and delegating to interactive agents

Check configured role templates first:

```bash
hc templates
```

Templates live in `~/.config/herdr-core/templates/<name>.md` and pair a command/model with role instructions. When a template fits, launch it in the background with a clear name, working directory, Linger labels, and self-contained scope:

```bash
hc run --bg --name review --cwd "$PWD" \
  --label linger.origin=agent_delegate \
  reviewer "Review only src/x.rs. Read-only; do not spawn subagents."
```

Without a matching template, start an interactive coding agent directly (never one-shot print modes like `pi -p` so the terminal remains watchable and steerable):

```bash
hc run --bg --name fix --cwd "$PWD" \
  --label linger.origin=agent_delegate \
  claude "Fix the failing test in src/x.rs; leave other files untouched."
```

Rules for launching agents in `hc`:

- Always pass `--bg` when starting interactive agents so their full-screen terminal does not flood your shell output.
- When running Codex inside `hc` (directly or in templates), always pass `--no-daemon`; otherwise Codex runs its commands outside `hc`.
- Put the initial task in `hc run` rather than sending immediately to a booting agent. Check `first_message.sent` in the JSON response: if `false`, the task was NOT delivered (for example, a startup trust dialog blocked it). Run `hc read <t>`, resolve readiness with the user if needed, and only then send the task.
- Tag terminals you launch with standard labels when known (`linger.room=<room_id>`, `linger.work_item=<work_item_id>`, `linger.agent=<agent_id>`, `linger.origin=agent_delegate`) so Linger's workbench and filters group them cleanly.
- Never pass flags that disable an agent's own sandbox or approval prompts unless the user explicitly asked for them.

## Persistent background runs and parent/child waiting

Your own shell tool blocks until a command exits. Offload slow builds, test suites, dev servers, or CI watches to `hc` terminals so you stay responsive:

```bash
hc run --bg --rm --no-notify --name build cargo build --release
hc wait build

hc run --bg --name dev bun dev
hc wait dev --output ready
hc read dev --lines 100
```

Never sleep or poll in a loop to check progress. Use `hc wait`:

```bash
hc wait <t>                 # until status leaves working or the process exits
hc wait <t> --output ready  # until plain output printed AFTER wait starts matches
hc wait --children any      # next child news or an incoming message
hc wait --children all      # until no child terminal is working
```

Notes on `wait` and lifecycle:

- `reason: timeout` (default 180 seconds) is a check-in, not a failure; the terminal keeps running. Inspect or wait again instead of launching a duplicate.
- `reason: message` means a message arrived in your input; handle it before waiting again.
- `--rm` removes a terminal automatically after exit once its exit code is observed; omit `--rm` when you still need `hc read <t>` afterward.
- Children end with their parent unless started with `--outlive-parent`. Use `hc keep <t>` (or `run --keep`) only when a lost process should recover into a shell in place.
- Clean up only terminals you started once work is accepted: `hc kill <t> && hc rm <t>`. Never kill, remove, or send input to the user's other terminals in `hc ls` unless the user explicitly named them.

## Talking to terminals and sharing files

```bash
hc ls --json
hc get <t> --json
hc read <t> --lines 120
hc send <t> "Focus on the first failure only"
hc send --wait <t> "Re-run the unit tests"
hc interrupt <t>
hc put <t> ./screenshot.png
```

- `hc read <t> --lines 0` reads only the visible screen. While status is `working`, `blocked`, or `error`, history reads return only the visible screen (`complete: false`, `why` set) without scrolling the program.
- `hc interrupt <t>` sends the stop key (`esc` for status-reporting agents, `ctrl+c` otherwise) without killing the process.
- `hc put <t> <file>` copies bytes (up to 8 MiB) beside a live terminal on its machine and prints the destination path so you can pass that path to the program.

## Multi-machine execution (`--on`), `exec`, and `file`

Use `hc machine ls` to inspect configured remote machines (SSH hosts or `--via` sandboxes). Only target a remote machine when the user asks to work there.

```bash
hc machine ls
hc run --bg --on vps --cwd /srv/app cargo test
hc exec --on vps --cwd /srv/app git status
hc file read --on vps /srv/app/src/main.rs --offset 1 --limit 120
hc file edit --on vps /srv/app/src/main.rs --old 'old text' --new 'new text'
hc file write --on vps /srv/app/config.toml < config.toml
```

- Prefer `hc exec --on <m>` for short non-interactive commands (exact exit code and stdout/stderr, no leftover PTY, auto-cleaned on timeout/disconnect). Pass `-i` to pipe stdin.
- Prefer `hc file read`, `hc file edit`, and `hc file write` over remote shell quoting. `file edit` requires every `--old` block to match exactly once and applies all edits atomically (or none on `edit_failed`).
- Remote relative paths start at that machine's home directory unless `--cwd` is passed; prefer explicit absolute paths on remote machines.

## Status model and blocked-agent handoff

`herdr-core` tracks terminal `state` (`live` or `finished`) and OSC 7501 `status.state` (`idle`, `working`, `done`, `blocked`, `error`) plus a monotonic `turn` counter (incremented each time status leaves `working`). Do not guess status from screen text.

When a terminal enters `blocked` (`status.kind` is `permission`, `question`, or `auth`):

1. Read the current prompt with `hc get <t> --json` and `hc read <t> --lines 60`.
2. Ask the user how to answer — or post a Linger question card bound to the terminal address and `turn` when acting through Another Me.
3. Never approve permission prompts or bypass a blocked dialog yourself. `hc send` refuses blocked terminals unless `--force` is passed; NEVER use `--force` to bypass a user decision.
4. Once the user gives an explicit answer, deliver text or dialog keys (`hc keys <t> down enter`, `hc keys <t> y enter`, or `hc send --force <t> "<user's answer>"`) only after confirming the terminal is still on the same `blocked` `turn`.

When status is `error`, read the screen first to diagnose why before sending follow-up instructions or killing the terminal.

## Permission review

Read-only queries (`hc --version`, `hc --help`, `hc --skill`, `hc schema`, `hc ls`, `hc get`, `hc read`, `hc wait`, `hc events`, `hc templates`, `hc server status`, `hc machine ls`, `hc file read`) run without permission review.

Every command that starts a process, runs remotely, writes or edits files, sends input or keys, modifies labels/keep state, kills/removes terminals, or manages machines/servers goes through Linger's permission review with the target machine/terminal and delegated payload attached. If review requests sponsor approval, wait for approval and retry with the exact same arguments rather than working around the review.
