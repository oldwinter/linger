package native

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strings"
)

// AntigravityProbe is what one ACP session/new tells about the signed-in
// account: whether a session opens and which models it offers.
type AntigravityProbe struct {
	AuthenticationRequired bool
	Models                 ModelList
}

// ProbeAntigravity opens an empty ACP session in the invocation's HOME and
// closes it again; no prompt is sent, so Antigravity stores no conversation.
func ProbeAntigravity(ctx context.Context, inv Invocation) (AntigravityProbe, error) {
	env := invocationEnvironment(inv)
	home := env["HOME"]
	if home == "" {
		return AntigravityProbe{}, errors.New("Antigravity probe requires HOME")
	}
	var result AntigravityProbe
	err := withACPProcess(ctx, inv, home, nil, func(conn *acpConn) error {
		if err := acpInitialize(ctx, conn); err != nil {
			return err
		}
		raw, err := acpOpenSession(ctx, conn, env, func() (json.RawMessage, error) {
			return conn.call(ctx, "session/new", map[string]any{"cwd": home, "mcpServers": []any{}})
		})
		if acpNeedsAuth(err) {
			result.AuthenticationRequired = true
			return nil
		}
		if err != nil {
			return err
		}
		var session acpSession
		if json.Unmarshal(raw, &session) != nil || session.SessionID == "" {
			return errors.New("Antigravity session/new returned no session")
		}
		result.Models = antigravityCatalog(session)
		return nil
	})
	return result, err
}

// DiscoverAntigravityModels lists the models of the signed-in account.
func DiscoverAntigravityModels(ctx context.Context, inv Invocation) (ModelList, error) {
	probe, err := ProbeAntigravity(ctx, inv)
	if err != nil {
		return ModelList{}, err
	}
	if probe.AuthenticationRequired {
		return ModelList{}, errors.New("Antigravity sign-in is required to list models")
	}
	return probe.Models, nil
}

// antigravityCatalog turns a session's model selector into the catalog.
// Antigravity selects a model family and a thinking level separately, and
// names each family-and-level pair "<family>-<level>" in availableModels;
// the levels a family offers are the suffixes of its pairs.
func antigravityCatalog(session acpSession) ModelList {
	var families *acpConfigOption
	for i := range session.ConfigOptions {
		if session.ConfigOptions[i].Category == "model" {
			families = &session.ConfigOptions[i]
			break
		}
	}
	var catalog catalogModels
	if families == nil {
		return catalog.list()
	}
	var pairs []string
	current := ""
	if session.Models != nil {
		for _, model := range session.Models.AvailableModels {
			pairs = append(pairs, model.ModelID)
		}
		current = session.Models.CurrentModelID
	}
	for _, family := range families.Options {
		var efforts effortCatalog
		for _, level := range antigravityLevels {
			if slices.Contains(pairs, family.Value+"-"+level) {
				efforts.add(level, "")
			}
		}
		defaultEffort := ""
		if family.Value == families.CurrentValue {
			defaultEffort, _ = strings.CutPrefix(current, family.Value+"-")
		}
		catalog.add(ModelOption{
			ID: family.Value, Label: family.Name, Provider: "antigravity",
			Default: family.Value == families.CurrentValue, Effort: efforts.support(defaultEffort),
		})
	}
	return catalog.list()
}

// antigravityLevels are the product reasoning efforts Antigravity also
// names, in ascending order.
var antigravityLevels = []string{"low", "medium", "high", "xhigh", "max"}

// withACPProcess runs exchange against a fresh `agy acp` in dir, then
// reaps the process tree. ctx bounds the exchange only.
func withACPProcess(ctx context.Context, inv Invocation, dir string, handle func(acpFrame), exchange func(*acpConn) error) error {
	proc, err := startACP(inv, dir, nil, handle)
	if err != nil {
		return err
	}
	exchangeErr := exchange(proc.conn)
	if !proc.stop() && exchangeErr == nil {
		exchangeErr = errors.New("Antigravity probe process did not exit")
	}
	return exchangeErr
}

// invocationEnvironment reads back the environment an Invocation carries.
func invocationEnvironment(inv Invocation) map[string]string {
	env := map[string]string{}
	entries := inv.Env
	if entries == nil {
		entries = os.Environ()
	}
	for _, entry := range entries {
		if key, value, ok := strings.Cut(entry, "="); ok {
			env[key] = value
		}
	}
	return env
}
