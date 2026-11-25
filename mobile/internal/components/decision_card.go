package components

import (
	"encoding/json"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/netimage"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// DecisionCardCallbacks routes decision actions and deep-links to settings/compute/zoom.
type DecisionCardCallbacks struct {
	ResolveURL         func(path string) string
	OnDecide           func(roomID, decisionID string, req api.DecisionRequest)
	OnOpenSettingsKey  func(kind, key string)           // provider_key / search_key / connection_auth
	OnOpenCompute      func(computerID, section string) // browser_connection / computer_permission
	OnZoomImage        func(url, title string)
	OnJumpToRoom       func(roomID string)
	ShowSourceRoomChip bool
}

// DecisionCardState holds per-decision interactive form & busy state across frames.
type DecisionCardState struct {
	mu           sync.Mutex
	busyAction   string // "", "approve", "deny", "submit", "connected", "done", "skipped"
	denyExpanded bool
	denyReason   string
	selectedConn string
	linksInput   string
	// Question card answers keyed by question ID.
	singleChoice map[string]string
	multiChoice  map[string]map[string]bool
	textAnswer   map[string]string
	// Cached editor.DiffState per patch string so diff buffers are not rebuilt every frame.
	diffPatch string
	diffState *editor.DiffState
}

// SetBusy marks a decision action in flight (or clears it when empty) to prevent duplicate taps.
func (s *DecisionCardState) SetBusy(action string) {
	s.mu.Lock()
	s.busyAction = action
	s.mu.Unlock()
}

// BusyAction returns the in-flight action label, or empty if idle.
func (s *DecisionCardState) BusyAction() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.busyAction
}

func (s *DecisionCardState) ensureMaps() {
	if s.singleChoice == nil {
		s.singleChoice = map[string]string{}
	}
	if s.multiChoice == nil {
		s.multiChoice = map[string]map[string]bool{}
	}
	if s.textAnswer == nil {
		s.textAnswer = map[string]string{}
	}
}

func (s *DecisionCardState) diffForPatch(patch string) *editor.DiffState {
	if s.diffState != nil && s.diffPatch == patch {
		return s.diffState
	}
	oldText, newText := reconstructUnifiedPatchSides(patch)
	ds := &editor.DiffState{
		Old:           editor.NewBuffer(oldText),
		New:           editor.NewBuffer(newText),
		Layout:        editor.DiffUnified,
		FitContent:    true,
		Wrap:          true,
		NoLineNumbers: false,
	}
	s.diffPatch = patch
	s.diffState = ds
	return ds
}

func reconstructUnifiedPatchSides(patch string) (oldText, newText string) {
	files, err := editor.ParsePatch(patch)
	if err != nil || len(files) == 0 {
		return "", patch
	}
	var oldLines, newLines []string
	for _, f := range files {
		for _, h := range f.Hunks {
			for _, line := range h.Lines {
				if line == "" {
					continue
				}
				switch line[0] {
				case ' ':
					oldLines = append(oldLines, line[1:])
					newLines = append(newLines, line[1:])
				case '-':
					oldLines = append(oldLines, line[1:])
				case '+':
					newLines = append(newLines, line[1:])
				}
			}
		}
	}
	return strings.Join(oldLines, "\n"), strings.Join(newLines, "\n")
}

// DecisionCardView renders any of Linger's 12 typed DecisionRequestedMessageCard kinds.
func DecisionCardView(
	c *ui.Context,
	roomID, roomName string,
	card api.DecisionRequestedMessageCard,
	st *DecisionCardState,
	cb DecisionCardCallbacks,
) ui.Element {
	if st == nil {
		st = &DecisionCardState{}
	}
	st.ensureMaps()

	t := c.Theme()
	ex := theme.Extra(t)
	pending := isPendingDecision(card.Status)
	busyAction := st.BusyAction()
	busy := busyAction != ""

	statusTone := ToneNeutral
	switch strings.ToLower(card.Status) {
	case "pending", "open", "waiting", "requested":
		statusTone = ToneWarning
	case "approved", "succeeded", "answered", "consumed", "connected", "configured", "granted":
		statusTone = ToneSuccess
	case "denied", "failed", "expired":
		statusTone = ToneDanger
	case "executing", "authorizing":
		statusTone = ToneInfo
	}

	borderColor := t.Border
	if pending {
		borderColor = t.Warning.Alpha(0.45)
	}

	return ui.Column(c.Key(card.DecisionID)).FillWidth().Background(t.Surface).Radius(12).
		Border(1, borderColor).Padding(12, 12).Gap(8).
		Role(ui.RoleGroup).Label(i18n.Tf("decision.a11y_header", map[string]any{"kind": i18n.DecisionKindLabel(card.Kind), "title": card.Title})).Children(func() {
		// Header row: kind pill + status pill + optional jump-to-room chip
		ui.Row(c).FillWidth().Wrap().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
			ui.Row(c).Wrap().AlignItems(ui.Center).Gap(6).Children(func() {
				StatusPill(c, i18n.DecisionKindLabel(card.Kind), ToneInfo)
				StatusPill(c, i18n.StatusLabel(card.Status), statusTone)
			})
			if cb.ShowSourceRoomChip && roomName != "" && cb.OnJumpToRoom != nil {
				jump := ui.Row(c).MinHeight(32).Padding(4, 8).Radius(8).Background(ex.MutedBg).
					AlignItems(ui.Center).Role(ui.RoleButton).Label(i18n.Tf("decision.open_room", map[string]any{"name": roomName}))
				jump.Children(func() {
					ui.Text(c, roomName+" ›").FontSize(11).FontWeight(600).TextColor(t.Accent).NoWrap()
				})
				if jump.Clicked() {
					cb.OnJumpToRoom(roomID)
				}
			}
		})

		// Card title & requester
		ui.Text(c, card.Title).FontSize(15).FontWeight(600).TextColor(t.Text)
		if card.Requester.DisplayName != "" {
			meta := i18n.Tf("decision.requested_by", map[string]any{"actor": card.Requester.DisplayName})
			if card.Intent != "" && card.Intent != card.Title {
				meta += " · " + card.Intent
			}
			ui.Text(c, meta).FontSize(12).TextColor(t.TextMuted)
		}

		// Kind-specific rich body & actions (all 12 real TeamHub decision kinds).
		switch card.Kind {
		case "runtime_permission":
			renderRuntimePermissionCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "connector_write":
			renderConnectorWriteCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "question":
			renderQuestionCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "agent_change":
			renderAgentChangeCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "room_creation":
			renderRoomCreationCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "connection_auth":
			renderConnectionAuthCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "provider_key":
			renderProviderKeyCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "search_key":
			renderSearchKeyCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "browser_connection":
			renderBrowserConnectionCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "computer_permission":
			renderComputerPermissionCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "profile_setup_apps":
			renderProfileSetupAppsCard(c, roomID, card, st, pending, busy, busyAction, cb)
		case "profile_setup_sources":
			renderProfileSetupSourcesCard(c, roomID, card, st, pending, busy, busyAction, cb)
		default:
			renderApproveDenyBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.approve"), i18n.T("decision.deny"), false, cb)
		}

		// Outcome / resolved summary footer.
		if !pending && card.Outcome != nil && *card.Outcome != "" {
			ui.Text(c, i18n.Tf("decision.outcome", map[string]any{"value": *card.Outcome})).FontSize(12).TextColor(t.TextMuted)
		}
	})
}

func renderRuntimePermissionCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	ex := theme.Extra(t)
	var v api.RuntimePermissionDecisionView
	if len(card.RuntimePermission) > 0 {
		_ = json.Unmarshal(card.RuntimePermission, &v)
	}
	if v.Tool != "" {
		ui.Row(c).Wrap().Gap(6).Children(func() {
			StatusPill(c, i18n.Tf("decision.tool", map[string]any{"name": v.Tool}), ToneNeutral)
			if v.Kind != "" {
				StatusPill(c, v.Kind, ToneNeutral)
			}
		})
	}
	if v.Rationale != "" {
		ui.Text(c, v.Rationale).FontSize(13).TextColor(t.Text)
	}
	if v.Page != nil && v.Page.URL != "" {
		target := v.Page.URL
		if v.Page.TargetName != nil && *v.Page.TargetName != "" {
			target = *v.Page.TargetName + " (" + v.Page.URL + ")"
		}
		ui.Text(c, i18n.Tf("decision.target", map[string]any{"path": target})).FontSize(12).TextColor(t.TextMuted)
	}
	if v.Input != "" {
		ui.Column(c).FillWidth().Padding(8, 10).Radius(8).Background(ex.MutedBg).Border(1, t.Border).Children(func() {
			ui.Text(c, v.Input).FontSize(12).TextColor(t.Text)
		})
	}
	if v.Patch != nil && strings.TrimSpace(*v.Patch) != "" {
		ui.Column(c).FillWidth().Radius(8).Clip().Border(1, t.Border).MaxHeight(220).Children(func() {
			editor.DiffView(c, st.diffForPatch(*v.Patch)).FillWidth()
		})
	}
	if v.Screenshot != nil && v.Screenshot.URL != "" {
		imgURL := v.Screenshot.URL
		if cb.ResolveURL != nil {
			imgURL = cb.ResolveURL(imgURL)
		}
		shot := ui.Box(c).FillWidth().Height(140).Radius(8).Clip().Border(1, t.Border).
			Role(ui.RoleButton).Label(i18n.T("decision.inspect_screenshot"))
		shot.Children(func() {
			netimage.Image(c, imgURL, netimage.Options{Fit: ui.Contain, MaxSide: 900, NoFade: true}).Fill()
		})
		if shot.Clicked() && cb.OnZoomImage != nil {
			cb.OnZoomImage(imgURL, card.Title)
		}
	}
	renderApproveDenyBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.approve"), i18n.T("decision.deny"), false, cb)
}

func renderConnectorWriteCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	ex := theme.Extra(t)
	var v api.ConnectorWriteDecisionView
	if len(card.ConnectorWrite) > 0 {
		_ = json.Unmarshal(card.ConnectorWrite, &v)
	}
	if v.App != "" || v.Account != "" {
		ui.Row(c).Wrap().Gap(6).Children(func() {
			if v.App != "" {
				StatusPill(c, v.App, ToneInfo)
			}
			if v.Account != "" {
				StatusPill(c, v.Account, ToneNeutral)
			}
		})
	}
	if v.Message != nil {
		ui.Column(c).FillWidth().Padding(8, 10).Radius(8).Background(ex.MutedBg).Border(1, t.Border).Gap(4).Children(func() {
			if len(v.Message.To) > 0 {
				ui.Text(c, i18n.Tf("decision.email.to", map[string]any{"list": strings.Join(v.Message.To, ", ")})).FontSize(12).TextColor(t.TextMuted)
			}
			if len(v.Message.Cc) > 0 {
				ui.Text(c, i18n.Tf("decision.email.cc", map[string]any{"list": strings.Join(v.Message.Cc, ", ")})).FontSize(12).TextColor(t.TextMuted)
			}
			if len(v.Message.Bcc) > 0 {
				ui.Text(c, i18n.Tf("decision.email.bcc", map[string]any{"list": strings.Join(v.Message.Bcc, ", ")})).FontSize(12).TextColor(t.TextMuted)
			}
			if v.Message.Destination != nil && *v.Message.Destination != "" {
				ui.Text(c, i18n.Tf("decision.email.channel", map[string]any{"channel": *v.Message.Destination})).FontSize(12).TextColor(t.TextMuted)
			}
			if v.Message.Subject != nil && *v.Message.Subject != "" {
				ui.Text(c, i18n.Tf("decision.email.subject", map[string]any{"subject": *v.Message.Subject})).FontSize(13).FontWeight(600).TextColor(t.Text)
			}
			if v.Message.Body != "" {
				ui.Text(c, v.Message.Body).FontSize(13).TextColor(t.Text)
			}
		})
	}
	for i, field := range v.Fields {
		ui.Row(c.Key(i)).FillWidth().Gap(6).Children(func() {
			ui.Text(c, field.Label+":").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
			ui.Text(c, field.Value).FontSize(12).TextColor(t.Text).Grow(1).Basis(0)
		})
	}
	if v.Message == nil && len(v.Fields) == 0 && v.Input != "" {
		ui.Column(c).FillWidth().Padding(8, 10).Radius(8).Background(ex.MutedBg).Children(func() {
			ui.Text(c, v.Input).FontSize(12).TextColor(t.Text)
		})
	}
	approveLabel := i18n.T("decision.approve")
	if v.Kind == "message" {
		approveLabel = i18n.T("decision.email.send_approve")
	}
	renderApproveDenyBar(c, roomID, card, st, pending, busy, busyAction, approveLabel, i18n.T("decision.email.dont_send"), false, cb)
}

func renderQuestionCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	var v api.QuestionDecisionView
	if len(card.Question) > 0 {
		_ = json.Unmarshal(card.Question, &v)
	}
	for qi, q := range v.Questions {
		q := q
		ui.Column(c.Key(qi)).FillWidth().Gap(6).Children(func() {
			ui.Text(c, q.Prompt).FontSize(13).FontWeight(600).TextColor(t.Text)
			if len(q.Options) > 0 {
				isMulti := strings.Contains(strings.ToLower(q.Input), "multi") || strings.Contains(strings.ToLower(q.Input), "check")
				if isMulti {
					if st.multiChoice[q.ID] == nil {
						st.multiChoice[q.ID] = map[string]bool{}
					}
					for _, opt := range q.Options {
						checked := st.multiChoice[q.ID][opt.ID]
						chk := ui.Checkbox(c.Key(opt.ID), &checked, opt.Label).MinHeight(36).Disabled(!pending || busy)
						if chk.Changed() {
							st.multiChoice[q.ID][opt.ID] = checked
						}
					}
				} else {
					cur := st.singleChoice[q.ID]
					for _, opt := range q.Options {
						rad := ui.Radio(c.Key(opt.ID), &cur, opt.ID, opt.Label).MinHeight(36).Disabled(!pending || busy)
						if rad.Changed() {
							st.singleChoice[q.ID] = cur
						}
					}
				}
			}
			if pending {
				txt := st.textAnswer[q.ID]
				in := ui.TextInput(c.Key("txt_"+q.ID), &txt).FillWidth().MinHeight(40).
					Placeholder(i18n.T("decision.question.placeholder")).Label(i18n.Tf("decision.question.a11y", map[string]any{"title": q.Prompt})).Disabled(busy)
				if in.Changed() {
					st.textAnswer[q.ID] = txt
				}
			}
		})
	}
	if !pending {
		return
	}
	label := i18n.T("decision.question.submit")
	if busyAction == "submit" {
		label = i18n.T("decision.question.submitting")
	}
	btn := PrimaryTouchButton(c, label, busy)
	btn.FillWidth()
	if btn.Clicked() && cb.OnDecide != nil {
		answers := make(map[string]api.DecisionAnswerValue, len(v.Questions))
		for _, q := range v.Questions {
			var val api.DecisionAnswerValue
			if sel := st.singleChoice[q.ID]; sel != "" {
				val.Selected = []string{sel}
			} else if multi := st.multiChoice[q.ID]; len(multi) > 0 {
				for id, on := range multi {
					if on {
						val.Selected = append(val.Selected, id)
					}
				}
			}
			if txt := strings.TrimSpace(st.textAnswer[q.ID]); txt != "" {
				tCopy := txt
				val.Text = &tCopy
			}
			answers[q.ID] = val
		}
		mygo.Haptics.Success()
		st.SetBusy("submit")
		cb.OnDecide(roomID, card.DecisionID, api.DecisionRequest{
			Decision:        "submit",
			ExpectedVersion: card.Version,
			Answers:         answers,
		})
	}
}

func renderAgentChangeCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	ex := theme.Extra(t)
	var v api.AgentChangeDecisionView
	if len(card.AgentChange) > 0 {
		_ = json.Unmarshal(card.AgentChange, &v)
	}
	if v.AgentName != "" {
		ui.Text(c, i18n.Tf("decision.agent_label", map[string]any{"name": v.AgentName, "harness": v.Action})).FontSize(13).FontWeight(600).TextColor(t.Text)
	}
	for i, ch := range v.Changes {
		ui.Column(c.Key(i)).FillWidth().Padding(8, 10).Radius(8).Background(ex.MutedBg).Gap(2).Children(func() {
			ui.Text(c, strings.ToUpper(ch.Field)).FontSize(11).FontWeight(600).TextColor(t.TextMuted)
			if ch.Before != nil && *ch.Before != "" {
				ui.Text(c, "- "+*ch.Before).FontSize(12).TextColor(t.Danger)
			}
			ui.Text(c, "+ "+ch.After).FontSize(12).TextColor(t.Success)
		})
	}
	renderApproveDenyBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.approve_change"), i18n.T("decision.deny"), false, cb)
}

func renderRoomCreationCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	var v api.RoomCreationDecisionView
	if len(card.RoomCreation) > 0 {
		_ = json.Unmarshal(card.RoomCreation, &v)
	}
	if v.Name != "" {
		ui.Text(c, i18n.Tf("decision.new_room", map[string]any{"name": v.Name})).FontSize(13).FontWeight(600).TextColor(t.Text)
	}
	if v.Description != nil && *v.Description != "" {
		ui.Text(c, *v.Description).FontSize(12).TextColor(t.TextMuted)
	}
	if len(v.MemberIDs) > 0 {
		ui.Text(c, i18n.Tf("decision.initial_members", map[string]any{"count": len(v.MemberIDs)})).FontSize(12).TextColor(t.TextMuted)
	}
	// TeamHub requires a comment when denying room_creation.
	renderApproveDenyBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.create_room"), i18n.T("decision.deny"), true, cb)
}

func renderConnectionAuthCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	var v api.ConnectionAuthDecisionView
	if len(card.ConnectionAuth) > 0 {
		_ = json.Unmarshal(card.ConnectionAuth, &v)
	}
	appDisplay := v.AppKey
	if v.Account != nil && *v.Account != "" {
		appDisplay += " (" + *v.Account + ")"
	}
	ui.Text(c, i18n.Tf("decision.app_line", map[string]any{"name": appDisplay})).FontSize(13).TextColor(t.Text)
	if pending && cb.OnOpenSettingsKey != nil {
		openBtn := SecondaryTouchButton(c, i18n.T("decision.manage_apps"), busy)
		openBtn.FillWidth()
		if openBtn.Clicked() {
			cb.OnOpenSettingsKey("connection_auth", v.AppKey)
		}
	}
	renderApproveDenyBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.approve_access"), i18n.T("decision.deny"), false, cb)
}

func renderProviderKeyCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	var v api.ProviderKeyDecisionView
	if len(card.ProviderKey) > 0 {
		_ = json.Unmarshal(card.ProviderKey, &v)
	}
	appKey := i18n.T("decision.connected_apps_default")
	settingsKey := "connected apps"
	if v.AppKey != nil && *v.AppKey != "" {
		appKey = *v.AppKey
		settingsKey = *v.AppKey
	}
	ui.Text(c, i18n.Tf("decision.provider_key_hint", map[string]any{"app": appKey})).FontSize(13).TextColor(t.TextMuted)
	renderSettingsOrDeclineBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.configure_provider_key"), func() {
		if cb.OnOpenSettingsKey != nil {
			cb.OnOpenSettingsKey("provider_key", settingsKey)
		}
	}, cb)
}

func renderSearchKeyCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	var v api.SearchKeyDecisionView
	if len(card.SearchKey) > 0 {
		_ = json.Unmarshal(card.SearchKey, &v)
	}
	ui.Text(c, i18n.Tf("decision.search_key_hint", map[string]any{"provider": v.Backend, "kind": v.Reason})).FontSize(13).TextColor(t.TextMuted)
	renderSettingsOrDeclineBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.configure_search_key"), func() {
		if cb.OnOpenSettingsKey != nil {
			cb.OnOpenSettingsKey("search_key", v.Backend)
		}
	}, cb)
}

func renderBrowserConnectionCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	var v api.BrowserConnectionDecisionView
	if len(card.BrowserConnection) > 0 {
		_ = json.Unmarshal(card.BrowserConnection, &v)
	}
	ui.Text(c, i18n.Tf("decision.browser_hint", map[string]any{"name": v.ComputerID})).FontSize(13).TextColor(t.TextMuted)
	renderSettingsOrDeclineBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.open_browser"), func() {
		if cb.OnOpenCompute != nil {
			cb.OnOpenCompute(v.ComputerID, "browser")
		}
	}, cb)
}

func renderComputerPermissionCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	t := c.Theme()
	var v api.ComputerPermissionDecisionView
	if len(card.ComputerPermission) > 0 {
		_ = json.Unmarshal(card.ComputerPermission, &v)
	}
	ui.Row(c).Wrap().Gap(4).Children(func() {
		if v.Subject != "" {
			StatusPill(c, v.Subject, ToneInfo)
		}
		for _, perm := range v.Permissions {
			StatusPill(c, perm, ToneWarning)
		}
	})
	if v.Reason != nil && *v.Reason != "" {
		ui.Text(c, *v.Reason).FontSize(12).TextColor(t.TextMuted)
	}
	renderSettingsOrDeclineBar(c, roomID, card, st, pending, busy, busyAction, i18n.T("decision.open_computer_perms"), func() {
		if cb.OnOpenCompute != nil {
			cb.OnOpenCompute(v.ComputerID, "permissions")
		}
	}, cb)
}

func renderProfileSetupAppsCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	var v api.ProfileSetupDecisionView
	if len(card.ProfileSetup) > 0 {
		_ = json.Unmarshal(card.ProfileSetup, &v)
	}
	if len(v.Apps) > 0 {
		ui.Row(c).Wrap().Gap(4).Children(func() {
			for _, appKey := range v.Apps {
				StatusPill(c, appKey, ToneNeutral)
			}
		})
	}
	if !pending {
		return
	}
	ui.Row(c).FillWidth().Gap(8).Children(func() {
		connLbl := i18n.T("decision.connected_btn")
		if busyAction == "connected" {
			connLbl = i18n.T("common.saving")
		}
		b1 := PrimaryTouchButton(c, connLbl, busy)
		b1.Grow(1).Basis(0)
		if b1.Clicked() && cb.OnDecide != nil {
			mygo.Haptics.Success()
			st.SetBusy("connected")
			cb.OnDecide(roomID, card.DecisionID, api.DecisionRequest{Decision: "connected", ExpectedVersion: card.Version})
		}
		b2 := SecondaryTouchButton(c, i18n.T("common.skip"), busy)
		b2.Grow(1).Basis(0)
		if b2.Clicked() && cb.OnDecide != nil {
			st.SetBusy("skipped")
			cb.OnDecide(roomID, card.DecisionID, api.DecisionRequest{Decision: "skipped", ExpectedVersion: card.Version})
		}
	})
}

func renderProfileSetupSourcesCard(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction string, cb DecisionCardCallbacks,
) {
	if !pending {
		return
	}
	FormField(c, i18n.T("decision.share_links_label"), i18n.T("decision.share_links_placeholder"), &st.linksInput, false)
	ui.Row(c).FillWidth().Gap(8).Children(func() {
		doneLbl := i18n.T("common.done")
		if busyAction == "done" {
			doneLbl = i18n.T("common.saving")
		}
		b1 := PrimaryTouchButton(c, doneLbl, busy)
		b1.Grow(1).Basis(0)
		if b1.Clicked() && cb.OnDecide != nil {
			var links []string
			for _, raw := range strings.Split(st.linksInput, ",") {
				if trimmed := strings.TrimSpace(raw); trimmed != "" {
					links = append(links, trimmed)
				}
			}
			mygo.Haptics.Success()
			st.SetBusy("done")
			cb.OnDecide(roomID, card.DecisionID, api.DecisionRequest{
				Decision:        "done",
				ExpectedVersion: card.Version,
				Links:           links,
			})
		}
		b2 := SecondaryTouchButton(c, i18n.T("common.skip"), busy)
		b2.Grow(1).Basis(0)
		if b2.Clicked() && cb.OnDecide != nil {
			st.SetBusy("skipped")
			cb.OnDecide(roomID, card.DecisionID, api.DecisionRequest{Decision: "skipped", ExpectedVersion: card.Version})
		}
	})
}

func renderSettingsOrDeclineBar(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction, openLabel string, onOpen func(), cb DecisionCardCallbacks,
) {
	if !pending {
		return
	}
	ui.Row(c).FillWidth().Gap(8).Children(func() {
		openBtn := PrimaryTouchButton(c, openLabel, busy)
		openBtn.Grow(1).Basis(0)
		if openBtn.Clicked() && onOpen != nil {
			onOpen()
		}
		denyLbl := i18n.T("decision.decline")
		if busyAction == "deny" {
			denyLbl = i18n.T("decision.declining")
		}
		denyBtn := DangerTouchButton(c, denyLbl, busy)
		if denyBtn.Clicked() && cb.OnDecide != nil {
			mygo.Haptics.Warning()
			st.SetBusy("deny")
			cb.OnDecide(roomID, card.DecisionID, api.DecisionRequest{Decision: "deny", ExpectedVersion: card.Version})
		}
	})
}

func renderApproveDenyBar(
	c *ui.Context, roomID string, card api.DecisionRequestedMessageCard,
	st *DecisionCardState, pending, busy bool, busyAction, approveLabel, denyLabel string, requireDenyReason bool, cb DecisionCardCallbacks,
) {
	if !pending {
		return
	}
	if st.denyExpanded {
		FormField(c, i18n.T("decision.reason_label"), i18n.T("decision.reason_placeholder"), &st.denyReason, false)
	}
	ui.Row(c).FillWidth().Gap(8).Children(func() {
		appTxt := approveLabel
		if busyAction == "approve" {
			appTxt = i18n.T("decision.approving")
		}
		appBtn := PrimaryTouchButton(c, appTxt, busy)
		appBtn.Grow(1).Basis(0)
		if appBtn.Clicked() && cb.OnDecide != nil {
			mygo.Haptics.Success()
			st.SetBusy("approve")
			cb.OnDecide(roomID, card.DecisionID, api.DecisionRequest{
				Decision:        "approve",
				ExpectedVersion: card.Version,
			})
		}

		denTxt := denyLabel
		if busyAction == "deny" {
			denTxt = i18n.T("decision.denying")
		}
		denBtn := DangerTouchButton(c, denTxt, busy)
		denBtn.Grow(1).Basis(0)
		if denBtn.Clicked() && cb.OnDecide != nil {
			reason := strings.TrimSpace(st.denyReason)
			if requireDenyReason && reason == "" {
				st.denyExpanded = true
				return
			}
			mygo.Haptics.Warning()
			st.SetBusy("deny")
			var commentPtr *string
			if reason != "" {
				commentPtr = &reason
			}
			cb.OnDecide(roomID, card.DecisionID, api.DecisionRequest{
				Decision:        "deny",
				ExpectedVersion: card.Version,
				Comment:         commentPtr,
			})
		}
	})
}

func isPendingDecision(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "pending", "open", "waiting", "requested":
		return true
	default:
		return false
	}
}
