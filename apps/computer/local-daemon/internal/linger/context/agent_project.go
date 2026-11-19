package lingercontext

import (
	"errors"
	"os"
	"path/filepath"
)

// agentProjectDirectory is the Context's own package project. Packages an
// Agent installs there stay with its conversation, out of the computer's
// global environment, and later Runs of the same Context find them again.
const agentProjectDirectory = "agent"

// agentProjectFiles make the directory a project that `uv --directory ./agent`
// and `npm --prefix ./agent` accept. The pyproject names no requires-python, so
// uv resolves for the Python it finds instead of one the Daemon guessed.
var agentProjectFiles = []struct{ name, content string }{
	{"pyproject.toml", "[project]\nname = \"context-packages\"\nversion = \"0.0.0\"\ndependencies = []\n"},
	{"package.json", "{\n  \"private\": true\n}\n"},
}

// ensureAgentProject creates whichever project files the Context's workspace
// lacks. A failure only costs the Agent its ready-made project, so it is
// logged and the Operation still runs.
func (s *ViewStore) ensureAgentProject(record ViewRecord) {
	if err := createAgentProject(record.WorkspacePath); err != nil {
		s.logger.Warn("runner.context_view.agent_project_failed",
			"agent_id", record.View.AgentID, "view_digest", record.View.ViewDigest, "error", err.Error())
	}
}

// createAgentProject never replaces an existing file, and it leaves alone an
// `agent` entry that the Agent turned into a file or a link.
func createAgentProject(workspace string) error {
	root, err := os.OpenRoot(workspace)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := root.Lstat(agentProjectDirectory)
	switch {
	case errors.Is(err, os.ErrNotExist):
		if err := root.Mkdir(agentProjectDirectory, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
	case err != nil:
		return err
	case !info.IsDir():
		return nil
	}
	for _, file := range agentProjectFiles {
		name := filepath.Join(agentProjectDirectory, file.name)
		created, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return err
		}
		_, writeErr := created.WriteString(file.content)
		if err := errors.Join(writeErr, created.Close()); err != nil {
			// A partial file would count as the Agent's own on the next Run.
			_ = root.Remove(name)
			return err
		}
	}
	return nil
}
