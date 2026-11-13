---
name: herdr
description: "Drive coding agents and terminal commands on the user's Computer through herdr, a terminal multiplexer for coding agents: open your own herdr workspace, start Claude Code or Codex there, prompt it, wait until it is idle or blocked, and read its output. Use only when the user mentions herdr, or asks you to hand work to a coding agent running in their terminal. Do not use merely because a task could benefit from parallel work."
---

<!-- Adapted for Linger Agents from herdr v0.9.5 skills/herdr/SKILL.md, Apache License 2.0, https://github.com/herdrdev/herdr. See NOTICE. -->

# herdr

herdr organizes terminals into workspaces, tabs, and panes, recognizes the coding agents running inside panes, and exposes the user's live terminal session through the `herdr` CLI. The panes run as the user, on the user's Computer, with the user's credentials.

## Check that herdr is available

You run on the user's Computer, not inside a herdr pane, so `HERDR_ENV`, `HERDR_PANE_ID`, and `--current` do not apply to you. Before anything else, run:

```bash
which herdr && herdr agent list
```

If `herdr` is not installed or `herdr agent list` fails, tell the user herdr is not available on this Computer and stop. Do not install herdr, start or stop a herdr server, or create a `--session`; those are the user's to do.

Never run bare `herdr`: it launches or attaches the TUI. Never run `herdr server stop`, `herdr update`, or kill a herdr process.

## Learn the current CLI

The installed binary is the authority for command syntax:

```bash
herdr --help
```

Print a command group's subcommands by running the group alone, for example `herdr agent`, `herdr pane`, `herdr workspace`, or `herdr tab`. Do not probe a mutating subcommand by leaving out its arguments: `herdr workspace create` is valid with defaults and runs.

Most control commands return JSON. Read IDs and state from those responses; never predict them. IDs look like `w1` (workspace), `w1:t1` (tab), and `w1:p1` (pane), and closed IDs are not reused.

## Work in your own workspace

The user's panes hold the user's own work, which may include their own coding agents. Keep yours apart:

- Create one herdr workspace for your work, in the directory the work belongs to, without taking the user's focus:

  ```bash
  herdr workspace create --cwd "$PWD" --label "<short task label>" --no-focus
  ```

  Use `.result.workspace.workspace_id` and `.result.root_pane.pane_id` from the response.

- Make further panes only inside that workspace, always naming the pane to split:

  ```bash
  herdr pane split <your-pane-id> --direction right --cwd "$PWD" --no-focus
  ```

  The new pane is `.result.pane.pane_id`. Never omit the pane: an omitted target splits the pane the user is focused on.

- Only type into, run commands in, prompt, or send keys to panes and agents you created in this workspace. Touch a pane or agent you did not create only when the user named that exact pane or agent in this request, and then only in the way they asked.
- Read other panes (`herdr pane read`, `herdr agent read`) only when the user's request is about them.
- Never close, move, rename, or focus a workspace, tab, or pane you did not create. When your work is done and you have read what you need, close the workspace you created with `herdr workspace close <your-workspace-id>`, unless the user wants to keep it.

## Start and prompt a coding agent

A pane can host an agent only when its shell is at the interactive prompt with nothing in the foreground. Start the kind the user asked for, with a short unique name (`[a-z][a-z0-9_-]{0,31}`):

```bash
herdr agent start reviewer --kind codex --pane <your-pane-id>
```

Run `herdr agent` to see the installed kinds and options. Native agent arguments go after `--`. Never pass arguments that switch off the agent's own approvals or sandbox unless the user explicitly asked for them.

A successful `agent start` returns once the agent is ready. If it returns `agent_not_ready`, the agent is blocked during startup; inspect it as described under "When an agent is blocked".

Submit work as one prompt:

```bash
herdr agent prompt reviewer "Review the current diff and report only actionable findings." --wait --timeout 100000
```

Write the prompt as a self-contained task: the goal, the files or scope, what to leave alone, and what to report back. The coding agent acts as the user and is not reviewed by Linger once it has the prompt, so ask it only for the work the user asked you to hand over, and never for sends, posts, pushes, deletions, or other effects the user did not ask for.

`--wait` returns at the first settled state: `idle`, `done`, or `blocked`. `agent_prompt_stalled` means no activity followed the submission, and `timeout` means your timeout ran out; neither proves the prompt was not delivered, so inspect before sending it again.

Keep every wait within your shell tool's time limit, and wait again for long work:

```bash
herdr agent wait reviewer --timeout 100000
```

Use `--until <state>` only to wait for one specific state, such as `--until blocked`.

## Read the result

```bash
herdr agent get reviewer
herdr agent read reviewer --source recent-unwrapped --lines 200
```

`idle` and `done` usually mean the agent is ready for input, but neither proves an unfamiliar approval dialog was recognized. `unknown` does not prove completion. If a larger read still does not show the full answer, prompt the agent to write it as a Markdown file in a temporary directory and reply only with the path, then read that file.

Report what the coding agent did and found in your own words, and say which parts you checked yourself.

## When an agent is blocked

`blocked` means herdr recognized an approval or question in the agent's UI. Read it with `herdr agent read`, then ask the user how to answer; do not approve the agent's requests yourself. Send the user's answer with `herdr agent send-keys <name> <key> ...` using logical keys such as `esc`, `enter`, or `ctrl+c`.

## Run an ordinary command in your pane

Use a pane of your own workspace:

```bash
herdr pane run <your-pane-id> "just test"
herdr pane wait-output <your-pane-id> --match "test result" --timeout 100000
herdr pane read <your-pane-id> --source recent-unwrapped --lines 120
```

`pane run` queues the command and Enter; success means it was admitted, not that it ran. `pane wait-output` also matches output that already exists. Use `--regex <pattern>` instead of `--match` for a pattern.

Read sources: `visible` is the current viewport, `recent` includes soft wraps, and `recent-unwrapped` joins soft wraps and suits logs and transcripts.

## Permission review

Read commands such as `herdr agent list`, `herdr agent read`, `herdr pane read`, `herdr pane wait-output`, `herdr workspace list`, and `herdr tab list` run without review. Every command that creates or changes the session, types into a pane, runs a command there, starts an agent, or prompts one goes to the permission review with the text it hands to the pane, which is judged as if you did that work yourself. When the review asks for the sponsor's approval, follow the message it returns: retry with exactly the same arguments after the approval arrives, and never reach the same effect another way, such as through a different pane or a different agent.

## Other machines

herdr can forward commands to a saved SSH machine with `herdr --machine <label> ...`. Use it only when the user names that machine, and discover IDs on that machine first: local IDs do not identify remote panes.
