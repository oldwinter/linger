package permission

import (
	"regexp"
	"slices"
	"strings"
)

// herdr (https://github.com/herdrdev/herdr) is a terminal multiplexer whose
// CLI drives the panes of the user's terminal session and the coding agents
// running in them. Its read commands are classified here; the commands that
// hand text to a pane are reviewed with that text attached, because what the
// pane runs next is never reviewed again.

// herdrReadOnlyCommands only read the session, whatever their arguments.
var herdrReadOnlyCommands = [][]string{
	{"--version"}, {"status"}, {"api", "schema"},
	{"agent", "list"}, {"agent", "get"}, {"agent", "read"}, {"agent", "wait"},
	{"pane", "list"}, {"pane", "get"}, {"pane", "current"}, {"pane", "layout"}, {"pane", "read"}, {"pane", "wait-output"},
	{"workspace", "list"}, {"workspace", "get"},
	{"tab", "list"}, {"tab", "get"},
}

// herdrReadOnly reports whether herdr arguments name a read-only command.
// A leading global option such as --session or --machine is reviewed, since
// --session may start a new server.
func herdrReadOnly(args []string) bool {
	return slices.ContainsFunc(herdrReadOnlyCommands, func(command []string) bool {
		if command[0] == "--version" {
			return slices.Equal(args, command)
		}
		return len(args) >= len(command) && slices.Equal(args[:len(command)], command)
	})
}

// Delegation kinds name what the pane does with the text.
const (
	// DelegationShellCommand is a command line the pane's shell runs.
	DelegationShellCommand = "shell_command"
	// DelegationTerminalInput is text or keys typed into whatever program the
	// pane runs.
	DelegationTerminalInput = "terminal_input"
	// DelegationAgentPrompt is a task for the coding agent in the pane.
	DelegationAgentPrompt = "agent_prompt"
	// DelegationAgentStart starts a coding agent in the pane; Text holds its
	// native arguments.
	DelegationAgentStart = "agent_start"
)

var herdrWord = regexp.MustCompile(`(^|[^A-Za-z0-9_.-])herdr([^A-Za-z0-9_.-]|$)`)

// HerdrUnreadMissing tells the judge the host could not pick out what a herdr
// command hands to a pane.
const HerdrUnreadMissing = "The command runs herdr with shell syntax the host does not read, so the text it hands to a pane is not shown separately."

// HerdrDelegations returns the text each herdr step of a shell command hands
// to a pane. unread is set when the command names herdr but uses shell syntax
// parseShell does not read.
func HerdrDelegations(command string) (delegations []Delegation, unread bool) {
	steps, ok := parseShell(command)
	if !ok {
		return nil, herdrWord.MatchString(command)
	}
	for _, step := range steps {
		if step.words[0] != "herdr" {
			continue
		}
		if delegation, ok := herdrDelegation(step.words[1:]); ok {
			delegations = append(delegations, delegation)
		}
	}
	return delegations, false
}

// herdrGlobalOptions take a value and may precede the command group.
var herdrGlobalOptions = []string{"--session", "--machine", "--remote"}

// herdrValueOptions are the options of the delegating commands that take a
// value, so the value is not mistaken for an operand.
var herdrValueOptions = []string{"--until", "--timeout", "--kind", "--pane"}

func herdrDelegation(args []string) (Delegation, bool) {
	for len(args) >= 2 && slices.Contains(herdrGlobalOptions, args[0]) {
		args = args[2:]
	}
	if len(args) < 2 {
		return Delegation{}, false
	}
	operands, options, native := herdrOperands(args[2:])
	switch args[0] + " " + args[1] {
	case "pane run":
		if len(operands) >= 2 {
			return Delegation{Kind: DelegationShellCommand, Target: operands[0], Text: strings.Join(operands[1:], " ")}, true
		}
	case "pane send-text", "pane send-keys", "agent send-keys":
		if len(operands) >= 2 {
			return Delegation{Kind: DelegationTerminalInput, Target: operands[0], Text: strings.Join(operands[1:], " ")}, true
		}
	case "agent prompt":
		if len(operands) >= 2 {
			return Delegation{Kind: DelegationAgentPrompt, Target: operands[0], Text: strings.Join(operands[1:], " ")}, true
		}
	case "agent start":
		if options["--pane"] != "" {
			return Delegation{Kind: DelegationAgentStart, Target: options["--pane"], Agent: options["--kind"], Text: strings.Join(native, " ")}, true
		}
	}
	return Delegation{}, false
}

// herdrOperands splits command arguments into operands, the values of
// herdrValueOptions, and the native arguments after "--".
func herdrOperands(args []string) (operands []string, options map[string]string, native []string) {
	options = map[string]string{}
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch {
		case arg == "--":
			return operands, options, args[index+1:]
		case slices.Contains(herdrValueOptions, arg) && index+1 < len(args):
			options[arg] = args[index+1]
			index++
		case strings.HasPrefix(arg, "--"):
			if name, value, found := strings.Cut(arg, "="); found {
				options[name] = value
			}
		default:
			operands = append(operands, arg)
		}
	}
	return operands, options, nil
}
