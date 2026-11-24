package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// --- Agents, Skills & Templates ---

func (c *Client) ListTenantAgents(ctx context.Context, tenantID string) (TenantAgentPage, error) {
	var out TenantAgentPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/agents", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) CreateTenantAgent(ctx context.Context, tenantID string, body map[string]any) (TenantAgent, error) {
	var out TenantAgent
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/agents", url.PathEscape(tenantID)), body, &out)
	return out, err
}

func (c *Client) UpdateTenantAgent(ctx context.Context, tenantID, agentID string, body map[string]any) (TenantAgent, error) {
	var out TenantAgent
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/tenants/%s/agents/%s", url.PathEscape(tenantID), url.PathEscape(agentID)), body, &out)
	return out, err
}

func (c *Client) DeleteTenantAgent(ctx context.Context, tenantID, agentID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/tenants/%s/agents/%s", url.PathEscape(tenantID), url.PathEscape(agentID)), nil, nil)
}

func (c *Client) ListAgentSkillBindings(ctx context.Context, tenantID, agentID string) ([]AgentSkillBinding, error) {
	var out struct {
		Items []AgentSkillBinding `json:"items"`
	}
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/agents/%s/skill-bindings", url.PathEscape(tenantID), url.PathEscape(agentID)), nil, &out)
	return out.Items, err
}

func (c *Client) PutAgentSkillBinding(ctx context.Context, tenantID, agentID, skillID string, body map[string]any) (AgentSkillBinding, error) {
	var out AgentSkillBinding
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/agents/%s/skill-bindings/%s", url.PathEscape(tenantID), url.PathEscape(agentID), url.PathEscape(skillID)), body, &out)
	return out, err
}

func (c *Client) DeleteAgentSkillBinding(ctx context.Context, tenantID, agentID, skillID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/tenants/%s/agents/%s/skill-bindings/%s", url.PathEscape(tenantID), url.PathEscape(agentID), url.PathEscape(skillID)), nil, nil)
}

func (c *Client) ListSkillManifests(ctx context.Context, tenantID string) (SkillManifestPage, error) {
	var out SkillManifestPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/skill-manifests", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) ListAgentTemplates(ctx context.Context, tenantID string) ([]AgentTemplate, error) {
	var out AgentTemplatePage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/agent-templates", url.PathEscape(tenantID)), nil, &out)
	return out.Items, err
}

// --- Local Computers, Local Models, BYOK, Permissions & Browser Connection ---

func (c *Client) ListLocalComputers(ctx context.Context, tenantID string) ([]LocalComputer, error) {
	var out LocalComputerPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/local-computers", url.PathEscape(tenantID)), nil, &out)
	return out.Items, err
}

func (c *Client) GetLocalComputerModels(ctx context.Context, tenantID, computerID string) (LocalModelsView, error) {
	var out LocalModelsView
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/local-models", url.PathEscape(tenantID), url.PathEscape(computerID)), nil, &out)
	return out, err
}

func (c *Client) RefreshLocalComputerModels(ctx context.Context, tenantID, computerID string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/local-models", url.PathEscape(tenantID), url.PathEscape(computerID)), struct{}{}, nil)
}

// ActOnLocalComputerModel executes pull, cancel_pull, load, unload, or remove on a local model.
func (c *Client) ActOnLocalComputerModel(ctx context.Context, tenantID, computerID, modelID, action string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/local-models/%s/actions", url.PathEscape(tenantID), url.PathEscape(computerID), url.PathEscape(modelID)), map[string]string{
		"action": action,
	}, nil)
}

func (c *Client) GetLocalComputerModelSource(ctx context.Context, tenantID, computerID string) (ModelSourceView, error) {
	var out ModelSourceView
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/model-source", url.PathEscape(tenantID), url.PathEscape(computerID)), nil, &out)
	return out, err
}

func (c *Client) SwitchLocalComputerModelSource(ctx context.Context, tenantID, computerID string, req ModelSourceSwitchRequest) (ModelSourceView, error) {
	var out ModelSourceView
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/model-source", url.PathEscape(tenantID), url.PathEscape(computerID)), req, &out)
	return out, err
}

func (c *Client) TestLocalComputerModelSource(ctx context.Context, tenantID, computerID string, body map[string]any) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/model-source/test", url.PathEscape(tenantID), url.PathEscape(computerID)), body, &out)
	return out, err
}

func (c *Client) ListLocalComputerByokModels(ctx context.Context, tenantID, computerID string, body map[string]any) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/model-source/models", url.PathEscape(tenantID), url.PathEscape(computerID)), body, &out)
	return out, err
}

func (c *Client) GetLocalComputerPermissions(ctx context.Context, tenantID, computerID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/permissions", url.PathEscape(tenantID), url.PathEscape(computerID)), nil, &out)
	return out, err
}

func (c *Client) ActOnLocalComputerPermission(ctx context.Context, tenantID, computerID string, body map[string]any) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/permissions", url.PathEscape(tenantID), url.PathEscape(computerID)), body, &out)
	return out, err
}

func (c *Client) GetLocalComputerBrowserConnection(ctx context.Context, tenantID, computerID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/browser-connection", url.PathEscape(tenantID), url.PathEscape(computerID)), nil, &out)
	return out, err
}

func (c *Client) PutLocalComputerBrowserConnection(ctx context.Context, tenantID, computerID string, body map[string]any) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/browser-connection", url.PathEscape(tenantID), url.PathEscape(computerID)), body, &out)
	return out, err
}

func (c *Client) DeleteLocalComputerBrowserConnection(ctx context.Context, tenantID, computerID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/browser-connection", url.PathEscape(tenantID), url.PathEscape(computerID)), nil, nil)
}

func (c *Client) ScanLocalComputerSkills(ctx context.Context, tenantID, computerID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/local-computers/%s/skill-scans", url.PathEscape(tenantID), url.PathEscape(computerID)), struct{}{}, &out)
	return out, err
}

// --- Work Items, Tasks, Routines, Pocket Notes & Proactive Rules ---

func (c *Client) ListWorkItems(ctx context.Context, tenantID string, state string, limit int, cursor string) (WorkItemPage, error) {
	q := url.Values{}
	if state != "" {
		q.Set("state", state)
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out WorkItemPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/work-items%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

func (c *Client) CreateWorkItem(ctx context.Context, tenantID string, body map[string]any) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/work-items", url.PathEscape(tenantID)), body, &out)
	return out, err
}

func (c *Client) GetWorkItem(ctx context.Context, workItemID string) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/work-items/%s", url.PathEscape(workItemID)), nil, &out)
	return out, err
}

func (c *Client) UpdateWorkItem(ctx context.Context, workItemID string, body map[string]any) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/work-items/%s", url.PathEscape(workItemID)), body, &out)
	return out, err
}

func (c *Client) TransitionWorkItem(ctx context.Context, workItemID, state string, expectedVersion int64) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/work-items/%s/transitions", url.PathEscape(workItemID)), map[string]any{
		"state":            state,
		"expected_version": expectedVersion,
	}, &out)
	return out, err
}

func (c *Client) ListWorkItemComments(ctx context.Context, workItemID string) (WorkItemCommentPage, error) {
	var out WorkItemCommentPage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/work-items/%s/comments", url.PathEscape(workItemID)), nil, &out)
	return out, err
}

func (c *Client) CreateWorkItemComment(ctx context.Context, workItemID, body string) (WorkItemComment, error) {
	var out WorkItemComment
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/work-items/%s/comments", url.PathEscape(workItemID)), map[string]string{
		"body": body,
	}, &out)
	return out, err
}

func (c *Client) ListWorkItemTimeline(ctx context.Context, workItemID string) ([]json.RawMessage, error) {
	var out struct {
		Items []json.RawMessage `json:"items"`
	}
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/work-items/%s/timeline", url.PathEscape(workItemID)), nil, &out)
	return out.Items, err
}

func (c *Client) ArchiveWorkItem(ctx context.Context, workItemID string, expectedVersion int64) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/work-items/%s/archive", url.PathEscape(workItemID)), map[string]int64{
		"expected_version": expectedVersion,
	}, &out)
	return out, err
}

func (c *Client) UnarchiveWorkItem(ctx context.Context, workItemID string, expectedVersion int64) (WorkItem, error) {
	var out WorkItem
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/work-items/%s/unarchive", url.PathEscape(workItemID)), map[string]int64{
		"expected_version": expectedVersion,
	}, &out)
	return out, err
}

func (c *Client) GetTaskExecution(ctx context.Context, taskID string) (TaskExecutionProjection, error) {
	var out TaskExecutionProjection
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tasks/%s/execution", url.PathEscape(taskID)), nil, &out)
	return out, err
}

func (c *Client) GetTaskConversation(ctx context.Context, taskID string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tasks/%s/conversation", url.PathEscape(taskID)), nil, &out)
	return out, err
}

func (c *Client) ListRoomRoutines(ctx context.Context, roomID string) ([]Routine, error) {
	var out RoutineList
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/rooms/%s/routines", url.PathEscape(roomID)), nil, &out)
	return out.Items, err
}

func (c *Client) CreateRoomRoutine(ctx context.Context, roomID string, body map[string]any) (Routine, error) {
	var out Routine
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/routines", url.PathEscape(roomID)), body, &out)
	return out, err
}

func (c *Client) UpdateRoutine(ctx context.Context, routineID string, body map[string]any) (Routine, error) {
	var out Routine
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/routines/%s", url.PathEscape(routineID)), body, &out)
	return out, err
}

func (c *Client) RunRoutineNow(ctx context.Context, routineID string) error {
	return c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/routines/%s/run", url.PathEscape(routineID)), struct{}{}, nil)
}

func (c *Client) DeleteRoutine(ctx context.Context, routineID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/routines/%s", url.PathEscape(routineID)), nil, nil)
}

func (c *Client) ListPocketNotes(ctx context.Context, tenantID string, limit int, cursor string) (PocketNotePage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out PocketNotePage
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/me/pocket-notes%s", url.PathEscape(tenantID), BuildQuery(q)), nil, &out)
	return out, err
}

func (c *Client) PutTodayPocketNote(ctx context.Context, tenantID, body string) (PocketNote, error) {
	var out PocketNote
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/me/pocket-notes/today", url.PathEscape(tenantID)), map[string]string{
		"body": body,
	}, &out)
	return out, err
}

func (c *Client) DeletePocketNote(ctx context.Context, tenantID, noteDate string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/tenants/%s/me/pocket-notes/%s", url.PathEscape(tenantID), url.PathEscape(noteDate)), nil, nil)
}

func (c *Client) ListProactiveRules(ctx context.Context, tenantID string) (ProactiveRuleBook, error) {
	var out ProactiveRuleBook
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules", url.PathEscape(tenantID)), nil, &out)
	return out, err
}

func (c *Client) EditProactiveRule(ctx context.Context, tenantID, ruleID, text string) (ProactiveRule, error) {
	var out ProactiveRule
	err := c.DoJSON(ctx, http.MethodPatch, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s", url.PathEscape(tenantID), url.PathEscape(ruleID)), map[string]string{
		"text": text,
	}, &out)
	return out, err
}

func (c *Client) SetProactiveRulePin(ctx context.Context, tenantID, ruleID string, pinned bool) (ProactiveRule, error) {
	var out ProactiveRule
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s/pin", url.PathEscape(tenantID), url.PathEscape(ruleID)), map[string]bool{
		"pinned": pinned,
	}, &out)
	return out, err
}

func (c *Client) SetProactiveRuleMandate(ctx context.Context, tenantID, ruleID, mandate string) (ProactiveRule, error) {
	var out ProactiveRule
	err := c.DoJSON(ctx, http.MethodPut, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s/mandate", url.PathEscape(tenantID), url.PathEscape(ruleID)), map[string]string{
		"mandate": mandate,
	}, &out)
	return out, err
}

func (c *Client) PromoteProactiveRule(ctx context.Context, tenantID, ruleID string) (ProactiveRule, error) {
	var out ProactiveRule
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s/promotion", url.PathEscape(tenantID), url.PathEscape(ruleID)), struct{}{}, &out)
	return out, err
}

func (c *Client) DeleteProactiveRule(ctx context.Context, tenantID, ruleID string) error {
	return c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/tenants/%s/me/proactive-rules/%s", url.PathEscape(tenantID), url.PathEscape(ruleID)), nil, nil)
}
