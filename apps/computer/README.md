# Local Computer

The Local Computer is the resident Daemon on a user's machine, its
`linger-computer` control CLI, the outbound Runner Gateway transport, and the
workspace grants. Both programs are Go binaries built from `local-daemon/`; the
release bundle also ships a pinned Node runtime for the `teamhub` CLI and the
managed Computer tools.

## Install

Install from the Computers page of the Linger Web app, or run the installer
the Web origin serves. On macOS and Linux:

```bash
curl -fsSL "http://localhost:3000/install/linger-computer.sh" | bash
linger-computer login
```

On Windows, in an ordinary (non-elevated) PowerShell:

```powershell
irm "http://localhost:3000/install/linger-computer.ps1" | iex
linger-computer login
```

`linger-computer login` authorizes the computer in the browser and starts the
Daemon. A server connection token from the Web app works too:
`linger-computer login --token-stdin`. Then use `linger-computer daemon status`,
`linger-computer runtime check <codex|claude|pi|antigravity>`, and `linger-computer doctor`;
`linger-computer --help` lists every command.

## Runtimes

The Daemon and the CLI share one Runtime environment and launcher path, so
`linger-computer runtime check` reports what the Daemon will run.
`AUTH_REQUIRED` means the Runtime runs but has no provider yet.
`linger-computer runtime login <type>` opens the Runtime the way the Daemon
starts it and works on every platform, for example:

```bash
linger-computer runtime login pi
```

In Pi, enter `/login`. On Windows this is the way to sign in, because a bare
Runtime command may start on a different Node and launcher. On macOS and Linux
the Runtime's own sign-in command (`codex login`, `claude auth login`, or `pi`
then `/login`) works too. Leaving the Runtime prints the check again; a
configured provider reads `READY`, and the Daemon reports the same state on its
next probe.

On Windows, an npm-installed Codex, Claude Code or Pi starts on the Node the
bundle ships in `<install>/runtime/bin`, so a machine Node below a Runtime's
engine requirement cannot fail its startup. `PATH` is unchanged, so the tools a
Runtime runs still resolve through the user's environment. Pi starts through
its `cli.js` instead of its PowerShell launcher, which drops the empty
`--system-prompt` value the Daemon's probe sends.

## Optional integrations

- herdr: when `herdr` is on your terminal PATH, the Daemon watches the coding
  agents in its panes through herdr's local socket and reports a pane that
  becomes blocked or finishes to Another Me (see
  [Proactive Another Me](../../docs/proactive.md#coding-agents-in-herdr)).
  Your answer to Another Me's question card about a pane is typed into that
  pane by Linger, once and only while the pane still waits on the same
  question; Another Me itself cannot type into a pane. The Daemon never
  starts, splits or closes herdr panes or agents.
  `linger-computer doctor` shows a herdr line only when herdr is installed;
  restart the Daemon after installing herdr.

Conventions and boundaries are in [AGENTS.md](./AGENTS.md).
