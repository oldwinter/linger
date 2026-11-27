package permission

import (
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// herdr-core (hc, https://github.com/herdrdev/herdr-core) runs persistent
// terminals, remote shell commands, and remote file edits as the user outside
// Linger's sandbox. Read-only queries run without review; every mutating or
// delegating subcommand is reviewed with structured Delegation evidence so the
// judge and SystemPrivacyUI see the exact target machine, command, input, or
// file edit.

// herdrCoreExactReadOnlyCommands print help, version, skill, or schema only
// when given as these exact argument lists.
var herdrCoreExactReadOnlyCommands = [][]string{
	{"--version"},
	{"-V"},
	{"--help"},
	{"-h"},
	{"--skill"},
	{"--licenses"},
	{"schema"},
	{"schema", "--json"},
	{"--json", "schema"},
	{"file"},
	{"file", "--help"},
	{"file", "-h"},
	{"machine"},
	{"machine", "--help"},
	{"machine", "-h"},
	{"server"},
	{"server", "--help"},
	{"server", "-h"},
}

// herdrCoreReadOnlyPrefixes name hc/herdr-core subcommands that only read
// local or remote state, whatever their options or operands.
var herdrCoreReadOnlyPrefixes = [][]string{
	{"ls"},
	{"get"},
	{"read"},
	{"wait"},
	{"events"},
	{"templates"},
	{"server", "status"},
	{"machine", "ls"},
	{"file", "read"},
}

// herdrCoreReadOnly reports whether hc / herdr-core arguments name a read-only
// command. Leading flags other than --json go to review.
func herdrCoreReadOnly(args []string) bool {
	if len(args) == 0 {
		return false
	}
	if slices.ContainsFunc(herdrCoreExactReadOnlyCommands, func(command []string) bool {
		return slices.Equal(args, command)
	}) {
		return true
	}
	trimmed := args
	if trimmed[0] == "--json" {
		trimmed = trimmed[1:]
		if len(trimmed) == 0 {
			return false
		}
	}
	return slices.ContainsFunc(herdrCoreReadOnlyPrefixes, func(prefix []string) bool {
		return len(trimmed) >= len(prefix) && slices.Equal(trimmed[:len(prefix)], prefix)
	})
}

// HerdrCoreUnreadMissing tells the judge the host could not extract what an
// hc / herdr-core command delegates because it uses shell syntax outside
// parseShell's subset.
const HerdrCoreUnreadMissing = "The command runs herdr-core (hc) with shell syntax the host does not read, so the delegated command, terminal input, or file edit is not shown separately."

// herdrCoreMutatingPattern matches an hc or herdr-core invocation (bare,
// full-path, or quoted) followed by optional flags and a mutating/delegating
// subcommand across spaces, tabs, or backslash-newline continuations. Read-only
// invocations with unreadable redirect targets (such as `hc read t1 > ~/out`)
// do not match.
var herdrCoreMutatingPattern = regexp.MustCompile(
	`(^|[^A-Za-z0-9_.-])(?:` +
		herdrShellWord("hc") + `|` + herdrShellWord("herdr-core") +
		`)(?:[ \t]|\\\n)+` +
		`(?:(?:--[A-Za-z0-9_=-]+|'--[A-Za-z0-9_=-]+'|"--[A-Za-z0-9_=-]+")(?:[ \t]|\\\n)+)*` +
		`(?:` +
		herdrShellWord("run") + `|` +
		herdrShellWord("send") + `|` +
		herdrShellWord("keys") + `|` +
		herdrShellWord("interrupt") + `|` +
		herdrShellWord("put") + `|` +
		herdrShellWord("kill") + `|` +
		herdrShellWord("rm") + `|` +
		herdrShellWord("keep") + `|` +
		herdrShellWord("label") + `|` +
		herdrShellWord("exec") + `|` +
		herdrShellWord("update") + `|` +
		herdrShellWord("attach") + `|` +
		herdrShellWord("connect") + `|` +
		herdrShellWord("file") + `(?:[ \t]|\\\n)+(?:` + herdrShellWord("write") + `|` + herdrShellWord("edit") + `)|` +
		herdrShellWord("machine") + `(?:[ \t]|\\\n)+(?:` +
		herdrShellWord("add") + `|` + herdrShellWord("rm") + `|` + herdrShellWord("rename") + `|` + herdrShellWord("login") + `|` + herdrShellWord("update") + `)|` +
		herdrShellWord("server") + `(?:[ \t]|\\\n)+(?:` + herdrShellWord("start") + `|` + herdrShellWord("stop") + `|` + herdrShellWord("restart") + `)` +
		`)([^A-Za-z0-9_.-]|$)`,
)

// HerdrCoreDelegations returns structured Delegation entries for each mutating
// or delegating hc / herdr-core step in a shell command. unread is true when
// parseShell cannot read the command's shell syntax and the raw text invokes
// hc / herdr-core with a mutating or delegating subcommand.
func HerdrCoreDelegations(command string) (delegations []Delegation, unread bool) {
	steps, ok := parseShell(command)
	if !ok {
		return nil, herdrCoreMutatingPattern.MatchString(command)
	}
	for _, step := range steps {
		if !isHerdrCoreBinary(step.words[0]) {
			continue
		}
		if delegation, matched := herdrCoreDelegation(step.words[1:]); matched {
			delegations = append(delegations, delegation)
		}
	}
	return delegations, false
}

func isHerdrCoreBinary(word string) bool {
	base := strings.ToLower(strings.TrimSuffix(filepath.Base(word), ".exe"))
	return base == "hc" || base == "herdr-core"
}

func herdrCoreDelegation(args []string) (Delegation, bool) {
	// Skip leading global flags such as --json.
	for len(args) > 0 && args[0] == "--json" {
		args = args[1:]
	}
	if len(args) == 0 {
		return Delegation{}, false
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "run":
		operands, options, trailing := hcParseArgs(rest, []string{"--name", "--cwd", "--on", "--label", "--parent", "--timeout"}, true)
		argv := slices.Concat(operands, trailing)
		target := hcRunTarget(options["--on"], options["--name"])
		text := strings.Join(argv, " ")
		if text == "" {
			text = "shell"
		}
		return Delegation{Kind: DelegationShellCommand, Target: target, Text: text}, true

	case "exec":
		operands, options, trailing := hcParseArgs(rest, []string{"--on", "--cwd", "--env", "--timeout"}, true)
		argv := slices.Concat(operands, trailing)
		target := hcMachineTarget(options["--on"])
		return Delegation{Kind: DelegationShellCommand, Target: target, Text: strings.Join(argv, " ")}, true

	case "send":
		operands, _, trailing := hcParseArgs(rest, []string{"--if", "--timeout"}, false)
		all := slices.Concat(operands, trailing)
		if len(all) == 0 {
			return Delegation{}, false
		}
		return Delegation{Kind: DelegationTerminalInput, Target: all[0], Text: strings.Join(all[1:], " ")}, true

	case "keys":
		operands, _, trailing := hcParseArgs(rest, nil, false)
		all := slices.Concat(operands, trailing)
		if len(all) == 0 {
			return Delegation{}, false
		}
		return Delegation{Kind: DelegationTerminalInput, Target: all[0], Text: strings.Join(all[1:], " ")}, true

	case "interrupt":
		operands, _, _ := hcParseArgs(rest, []string{"--timeout"}, false)
		return Delegation{Kind: DelegationTerminalInput, Target: hcTerminalTarget(operands), Text: "interrupt"}, true

	case "put":
		operands, _, _ := hcParseArgs(rest, nil, false)
		if len(operands) == 0 {
			return Delegation{}, false
		}
		return Delegation{Kind: DelegationTerminalInput, Target: operands[0], Text: strings.TrimSpace("put " + strings.Join(operands[1:], " "))}, true

	case "kill", "rm":
		operands, _, _ := hcParseArgs(rest, nil, false)
		return Delegation{Kind: DelegationTerminalInput, Target: hcTerminalTarget(operands), Text: sub}, true

	case "keep":
		operands, options, _ := hcParseArgs(rest, nil, false)
		text := "keep"
		if _, off := options["--off"]; off {
			text = "keep --off"
		}
		return Delegation{Kind: DelegationTerminalInput, Target: hcTerminalTarget(operands), Text: text}, true

	case "label":
		operands, _, _ := hcParseArgs(rest, nil, false)
		if len(operands) == 0 {
			return Delegation{}, false
		}
		return Delegation{Kind: DelegationTerminalInput, Target: operands[0], Text: strings.TrimSpace("label " + strings.Join(operands[1:], " "))}, true

	case "file":
		return herdrCoreFileDelegation(rest)

	case "machine":
		return herdrCoreMachineDelegation(rest)

	case "server":
		return herdrCoreServerDelegation(rest)

	case "update":
		_, options, _ := hcParseArgs(rest, []string{"--from", "--version"}, false)
		parts := []string{"update"}
		if v := options["--version"]; v != "" {
			parts = append(parts, "--version", v)
		}
		if f := options["--from"]; f != "" {
			parts = append(parts, "--from", f)
		}
		if _, force := options["--force"]; force {
			parts = append(parts, "--force")
		}
		return Delegation{Kind: DelegationShellCommand, Target: "local", Text: strings.Join(parts, " ")}, true

	case "attach":
		operands, _, _ := hcParseArgs(rest, []string{"--history"}, false)
		return Delegation{Kind: DelegationTerminalInput, Target: hcTerminalTarget(operands), Text: "attach"}, true

	case "connect":
		_, options, _ := hcParseArgs(rest, []string{"--session"}, false)
		target := "local"
		if session := options["--session"]; session != "" {
			target = session
		}
		return Delegation{Kind: DelegationTerminalInput, Target: target, Text: "connect"}, true
	}
	return Delegation{}, false
}

func herdrCoreFileDelegation(args []string) (Delegation, bool) {
	if len(args) == 0 {
		return Delegation{}, false
	}
	sub := args[0]
	rest := args[1:]
	switch sub {
	case "write":
		operands, options, _ := hcParseArgs(rest, []string{"--on", "--cwd"}, false)
		filePath := ""
		if len(operands) > 0 {
			filePath = operands[0]
		}
		target := hcFileTarget(options["--on"], filePath)
		text := strings.TrimSpace("file write " + filePath)
		return Delegation{Kind: DelegationShellCommand, Target: target, Text: text}, true

	case "edit":
		operands, options, olds, news := hcParseFileEditArgs(rest)
		filePath := ""
		if len(operands) > 0 {
			filePath = operands[0]
		}
		target := hcFileTarget(options["--on"], filePath)
		parts := []string{"file edit"}
		if filePath != "" {
			parts = append(parts, filePath)
		}
		for index := 0; index < len(olds) || index < len(news); index++ {
			if index < len(olds) {
				parts = append(parts, "--old", olds[index])
			}
			if index < len(news) {
				parts = append(parts, "--new", news[index])
			}
		}
		return Delegation{Kind: DelegationShellCommand, Target: target, Text: strings.Join(parts, " ")}, true
	}
	return Delegation{}, false
}

func herdrCoreMachineDelegation(args []string) (Delegation, bool) {
	if len(args) == 0 {
		return Delegation{}, false
	}
	sub := args[0]
	rest := args[1:]
	switch sub {
	case "add":
		operands, options, _ := hcParseArgs(rest, []string{"--via", "--name", "--session"}, false)
		target := options["--name"]
		if target == "" && len(operands) > 0 {
			target = operands[0]
		}
		if target == "" {
			target = "local"
		}
		parts := []string{"machine add"}
		if len(operands) > 0 {
			parts = append(parts, operands...)
		}
		if via := options["--via"]; via != "" {
			parts = append(parts, "--via", via)
		}
		return Delegation{Kind: DelegationShellCommand, Target: target, Text: strings.Join(parts, " ")}, true

	case "rm", "rename", "login", "update":
		operands, _, _ := hcParseArgs(rest, nil, false)
		target := "local"
		if len(operands) > 0 {
			target = operands[0]
		}
		parts := append([]string{"machine", sub}, operands...)
		return Delegation{Kind: DelegationShellCommand, Target: target, Text: strings.Join(parts, " ")}, true
	}
	return Delegation{}, false
}

func herdrCoreServerDelegation(args []string) (Delegation, bool) {
	if len(args) == 0 {
		return Delegation{}, false
	}
	sub := args[0]
	rest := args[1:]
	switch sub {
	case "start", "stop", "restart":
		_, options, _ := hcParseArgs(rest, nil, false)
		text := "server " + sub
		if _, fresh := options["--fresh"]; fresh {
			text += " --fresh"
		}
		return Delegation{Kind: DelegationShellCommand, Target: "local", Text: text}, true
	}
	return Delegation{}, false
}

// hcParseArgs splits hc subcommand arguments into positional operands, flag
// options (with values for valueFlags), and trailing arguments after "--".
// When stopAtFirstOperand is true (as in `hc run` and `hc exec`), all tokens
// from the first positional operand onward belong to the delegated program's
// argv so its own flags are preserved verbatim.
func hcParseArgs(args []string, valueFlags []string, stopAtFirstOperand bool) (operands []string, options map[string]string, trailing []string) {
	options = map[string]string{}
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch {
		case arg == "--":
			return operands, options, args[index+1:]
		case slices.Contains(valueFlags, arg) && index+1 < len(args):
			options[arg] = args[index+1]
			index++
		case strings.HasPrefix(arg, "--"):
			if name, value, found := strings.Cut(arg, "="); found {
				options[name] = value
			} else {
				options[arg] = ""
			}
		case strings.HasPrefix(arg, "-") && len(arg) > 1:
			options[arg] = ""
		default:
			if stopAtFirstOperand {
				return operands, options, args[index:]
			}
			operands = append(operands, arg)
		}
	}
	return operands, options, nil
}

func hcParseFileEditArgs(args []string) (operands []string, options map[string]string, olds, news []string) {
	options = map[string]string{}
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch {
		case arg == "--":
			return append(operands, args[index+1:]...), options, olds, news
		case arg == "--old" && index+1 < len(args):
			olds = append(olds, args[index+1])
			index++
		case strings.HasPrefix(arg, "--old="):
			olds = append(olds, strings.TrimPrefix(arg, "--old="))
		case arg == "--new" && index+1 < len(args):
			news = append(news, args[index+1])
			index++
		case strings.HasPrefix(arg, "--new="):
			news = append(news, strings.TrimPrefix(arg, "--new="))
		case (arg == "--on" || arg == "--cwd") && index+1 < len(args):
			options[arg] = args[index+1]
			index++
		case strings.HasPrefix(arg, "--"):
			if name, value, found := strings.Cut(arg, "="); found {
				options[name] = value
			} else {
				options[arg] = ""
			}
		default:
			operands = append(operands, arg)
		}
	}
	return operands, options, olds, news
}

func hcRunTarget(machine, name string) string {
	switch {
	case machine != "" && name != "":
		return machine + "/" + name
	case machine != "":
		return machine
	case name != "":
		return name
	default:
		return "local"
	}
}

func hcMachineTarget(machine string) string {
	if machine != "" {
		return machine
	}
	return "local"
}

func hcTerminalTarget(operands []string) string {
	if len(operands) > 0 && operands[0] != "" {
		return operands[0]
	}
	return "current"
}

func hcFileTarget(machine, path string) string {
	switch {
	case machine != "" && path != "":
		return machine + ":" + path
	case machine != "":
		return machine
	case path != "":
		return path
	default:
		return "local"
	}
}
