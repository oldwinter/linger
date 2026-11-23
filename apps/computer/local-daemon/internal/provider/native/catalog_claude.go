package native

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
)

const claudeCatalogRequestID = "linger-catalog"

// claudeCatalogArgs start Claude without tools, MCP, slash commands or
// session persistence; only the initialize control request is ever sent.
// They read the user settings a turn reads, so the env there (gateway base
// URL, model mappings, gateway model discovery) shapes the list; --safe-mode
// keeps hooks, plugins and CLAUDE.md off.
var claudeCatalogArgs = []string{
	"-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
	"--safe-mode", "--no-session-persistence", "--disable-slash-commands",
	"--strict-mcp-config", "--mcp-config", `{"mcpServers":{}}`, "--tools", "",
}

type claudeCatalogModel struct {
	Value                 string   `json:"value"`
	ResolvedModel         string   `json:"resolvedModel"`
	DisplayName           string   `json:"displayName"`
	SupportedEffortLevels []string `json:"supportedEffortLevels"`
	SupportsEffort        *bool    `json:"supportsEffort"`
}

type claudeCatalogReply struct {
	Type     string `json:"type"`
	Response struct {
		RequestID string `json:"request_id"`
		Subtype   string `json:"subtype"`
		Response  struct {
			Models []json.RawMessage `json:"models"`
		} `json:"response"`
	} `json:"response"`
}

// claudeCatalogReplyFrame reports whether frame is the answer to the catalog
// initialize request. Every other stdout line is noise the exchange skips.
func claudeCatalogReplyFrame(frame []byte) (claudeCatalogReply, bool) {
	var reply claudeCatalogReply
	if json.Unmarshal(frame, &reply) != nil {
		return reply, false
	}
	return reply, reply.Type == "control_response" && reply.Response.RequestID == claudeCatalogRequestID
}

func claudeCatalog(ctx context.Context, inv Invocation) (ModelList, error) {
	request := map[string]any{
		"type":       "control_request",
		"request_id": claudeCatalogRequestID,
		"request":    map[string]any{"subtype": "initialize"},
	}
	var advertised []json.RawMessage
	err := exchangeCatalog(ctx, claudeInvocation(inv), claudeCatalogArgs, []any{request}, func(frame []byte, _ func(...any) error) (bool, error) {
		reply, ours := claudeCatalogReplyFrame(frame)
		if !ours {
			return false, nil
		}
		if reply.Response.Subtype != "success" {
			return false, errors.New("Claude rejected catalog initialization")
		}
		advertised = reply.Response.Response.Models
		return true, nil
	})
	if err != nil {
		return ModelList{}, err
	}
	var models catalogModels
	var resolved []ModelOption
	for _, raw := range advertised {
		var entry claudeCatalogModel
		if json.Unmarshal(raw, &entry) != nil {
			continue
		}
		id := entry.Value
		if !validCatalogToken(id) {
			id = entry.ResolvedModel
		}
		var efforts effortCatalog
		if entry.SupportsEffort == nil || *entry.SupportsEffort {
			for _, level := range entry.SupportedEffortLevels {
				efforts.add(level, "")
			}
		}
		option := ModelOption{ID: id, Label: claudeModelLabel(id, entry), Provider: "anthropic", Default: entry.Value == "default", Effort: efforts.support("")}
		if entry.ResolvedModel != id {
			option.Resolved = entry.ResolvedModel
		}
		models.add(option)
		concrete := ModelOption{ID: entry.ResolvedModel, Label: entry.ResolvedModel, Provider: "anthropic", Effort: efforts.support("")}
		if i := slices.IndexFunc(resolved, func(m ModelOption) bool { return m.ID == concrete.ID }); i < 0 {
			resolved = append(resolved, concrete)
		} else if resolved[i].Effort == nil {
			resolved[i].Effort = concrete.Effort
		}
	}
	// The concrete model behind each alias is selectable too. Agents set up
	// before the catalog was discovered are pinned to such ids (for example
	// claude-opus-5-5), and Claude accepts them as --model.
	for _, model := range resolved {
		models.add(model)
	}
	if len(models.models) == 0 {
		return ModelList{}, errors.New("Claude initialized without a selectable model catalog")
	}
	list := models.list()
	disambiguateModelLabels(list.Models)
	return list, nil
}

// claudeModelLabel formats a Claude catalog entry using only structured fields
// (displayName, id, and resolvedModel). Free-form description prose varies
// across Anthropic first-party, cloud hosts, and third-party gateways, so it is
// never parsed into the display label. When id is an alias for a different
// concrete model, the resolved model id is appended unless the display name
// already contains it. This formatting never selects a model.
func claudeModelLabel(id string, entry claudeCatalogModel) string {
	label := strings.TrimSpace(entry.DisplayName)
	if label == "" {
		return ""
	}
	resolved := strings.TrimSpace(entry.ResolvedModel)
	if validCatalogToken(resolved) && claudeIsAlias(id, resolved) && !strings.Contains(strings.ToLower(label), strings.ToLower(resolved)) {
		return label + " · " + resolved
	}
	return label
}

// claudeIsAlias reports whether id selects resolved through an alias rather
// than naming resolved directly (or with a bracket modifier such as "[1m]").
func claudeIsAlias(id, resolved string) bool {
	if id == resolved {
		return false
	}
	if strings.HasPrefix(id, resolved+"[") && strings.HasSuffix(id, "]") {
		return false
	}
	return true
}

// disambiguateModelLabels appends the selectable id to entries that share the
// same display label so distinct models remain distinguishable.
func disambiguateModelLabels(models []ModelOption) {
	counts := make(map[string]int, len(models))
	for _, model := range models {
		counts[model.Label]++
	}
	for i := range models {
		if counts[models[i].Label] > 1 && models[i].Label != models[i].ID {
			models[i].Label += " (" + models[i].ID + ")"
		}
	}
}
