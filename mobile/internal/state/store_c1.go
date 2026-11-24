package state

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
)

// PendingDecisionItem aggregates an unresolved DecisionRequestedMessageCard with its source Room context.
type PendingDecisionItem struct {
	RoomID    string
	RoomName  string
	MessageID string
	Card      api.DecisionRequestedMessageCard
	CreatedAt time.Time
}

// SetComposerReturnSends toggles whether pressing bare Return in the mobile chat
// composer submits the message (false by default on mobile; Cmd/Ctrl+Enter always sends).
func (s *AppStore) SetComposerReturnSends(enabled bool) {
	s.mu.Lock()
	s.composerReturnSends = enabled
	s.mu.Unlock()
	s.notify()
}

// GetDraft returns the unsent draft text for roomID.
func (s *AppStore) GetDraft(roomID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.roomDrafts[roomID]
}

// SetDraft stores the unsent draft text for roomID without losing state across tab/room switches.
func (s *AppStore) SetDraft(roomID, text string) {
	if roomID == "" {
		return
	}
	s.mu.Lock()
	if text == "" {
		delete(s.roomDrafts, roomID)
	} else {
		s.roomDrafts[roomID] = text
	}
	s.mu.Unlock()
}

// ExportDrafts returns a copy of all unsent drafts (suitable for mygo.KeepState persistence).
func (s *AppStore) ExportDrafts() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]string, len(s.roomDrafts))
	for k, v := range s.roomDrafts {
		out[k] = v
	}
	return out
}

// RestoreDrafts merges restored drafts without clobbering newer in-memory drafts.
func (s *AppStore) RestoreDrafts(drafts map[string]string) {
	s.mu.Lock()
	for k, v := range drafts {
		if _, exists := s.roomDrafts[k]; !exists && v != "" {
			s.roomDrafts[k] = v
		}
	}
	s.mu.Unlock()
}

// RoomMessages returns a copy of currently loaded/cached messages for roomID.
func (s *AppStore) RoomMessages(roomID string) ([]api.Message, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]api.Message(nil), s.roomMessages[roomID]...), s.roomHasMore[roomID]
}

// RunPresentationEvents returns the parsed runtime presentation event timeline for runID.
func (s *AppStore) RunPresentationEvents(runID string) []api.ParsedPresentationEvent {
	s.mu.RLock()
	raw := append([]api.RuntimePresentationEvent(nil), s.runPresEvents[runID]...)
	s.mu.RUnlock()
	out := make([]api.ParsedPresentationEvent, 0, len(raw))
	for _, ev := range raw {
		out = append(out, api.ParsePresentationEvent(ev))
	}
	return out
}

// RoomRunStatuses returns active/recent runs belonging to roomID.
func (s *AppStore) RoomRunStatuses(roomID string) []api.RoomRunStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []api.RoomRunStatus
	for _, run := range s.activeRuns {
		if run.RoomID == roomID {
			out = append(out, run)
		}
	}
	return out
}

// LoadRoomMessages fetches messages for roomID (with SQLite cache fallback when offline)
// and registers the room cursor on the single SSE stream.
func (s *AppStore) LoadRoomMessages(ctx context.Context, roomID string, older bool) error {
	if roomID == "" {
		return nil
	}
	client := s.Client()
	s.mu.RLock()
	cs := s.cacheStore
	cursor := ""
	if older {
		cursor = s.roomNextCursor[roomID]
	}
	s.mu.RUnlock()

	if !older && cs != nil {
		if cached, err := cs.ListMessages(ctx, roomID, 100); err == nil && len(cached) > 0 {
			s.mu.Lock()
			if len(s.roomMessages[roomID]) == 0 {
				s.roomMessages[roomID] = cached
				s.rebuildPendingDecisionsLocked()
			}
			s.mu.Unlock()
			s.notify()
		}
	}

	if client == nil {
		s.mu.Lock()
		s.offlineViewingCache = true
		s.mu.Unlock()
		s.notify()
		return errors.New("offline — viewing cached messages")
	}

	page, err := client.ListMessages(ctx, roomID, 50, cursor)
	if err != nil {
		s.mu.Lock()
		if len(s.roomMessages[roomID]) > 0 {
			s.offlineViewingCache = true
		}
		s.mu.Unlock()
		s.notify()
		return err
	}

	// Fetch active run statuses for this room too.
	runs, _ := client.ListRoomRunStatuses(ctx, roomID)

	s.mu.Lock()
	if older {
		existing := s.roomMessages[roomID]
		seen := make(map[string]bool, len(existing))
		for _, m := range existing {
			seen[m.ID] = true
		}
		merged := make([]api.Message, 0, len(page.Items)+len(existing))
		for _, m := range page.Items {
			if !seen[m.ID] {
				merged = append(merged, m)
			}
		}
		merged = append(merged, existing...)
		s.roomMessages[roomID] = merged
	} else {
		s.roomMessages[roomID] = page.Items
	}
	s.roomHasMore[roomID] = page.Page.HasMore
	if page.Page.NextCursor != nil {
		s.roomNextCursor[roomID] = *page.Page.NextCursor
	} else {
		s.roomNextCursor[roomID] = ""
	}
	if len(runs) > 0 {
		s.mergeRoomRunsLocked(roomID, runs)
	}
	s.rebuildPendingDecisionsLocked()
	s.offlineViewingCache = false
	s.transientError = ""
	stream := s.stream
	s.mu.Unlock()

	if stream != nil && page.SnapshotRoomSeq > 0 {
		stream.SetRoomCursor(roomID, page.SnapshotRoomSeq)
	}
	if cs != nil {
		_ = cs.UpsertMessages(ctx, page.Items)
	}
	s.notify()
	return nil
}

// SendMessage posts a new message (with optional reply and attachment uploads) to roomID.
// When offline, queues into the SQLite outbox so it never loses user input.
func (s *AppStore) SendMessage(ctx context.Context, roomID, text string, replyToID *string, uploadIDs []string) (api.Message, error) {
	text = strings.TrimSpace(text)
	if text == "" && len(uploadIDs) == 0 {
		return api.Message{}, errors.New("message cannot be empty")
	}
	ikey := fmt.Sprintf("mob_%d", time.Now().UnixNano())
	req := api.CreateMessageRequest{
		RawMessage:          text,
		ReplyToMessageID:    replyToID,
		AttachmentUploadIDs: uploadIDs,
	}

	client := s.Client()
	if client == nil {
		s.mu.RLock()
		cs := s.cacheStore
		s.mu.RUnlock()
		if cs != nil {
			_ = cs.EnqueueOutbox(ctx, ikey, "message.create", roomID, req)
			s.SetStatusMessage("Offline: message queued in outbox")
			return api.Message{}, nil
		}
		return api.Message{}, errors.New("not connected")
	}

	msg, err := client.CreateMessage(ctx, roomID, req, ikey)
	if err != nil {
		s.SetTransientError(err.Error())
		return api.Message{}, err
	}

	s.mu.Lock()
	s.upsertRoomMessageLocked(roomID, msg)
	delete(s.roomDrafts, roomID)
	s.transientError = ""
	cs := s.cacheStore
	s.mu.Unlock()

	if cs != nil {
		_ = cs.UpsertMessages(ctx, []api.Message{msg})
	}
	s.notify()
	return msg, nil
}

// ToggleRoomPin pins or unpins a room via PUT /v0/rooms/:r/pin.
func (s *AppStore) ToggleRoomPin(ctx context.Context, roomID string, pinned bool) error {
	client := s.Client()
	if client == nil {
		return errors.New("not connected")
	}
	if err := client.UpdateRoomPin(ctx, roomID, pinned); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	s.mu.Lock()
	for i := range s.rooms {
		if s.rooms[i].ID == roomID {
			if pinned {
				now := time.Now().UTC()
				s.rooms[i].PinnedAt = &now
			} else {
				s.rooms[i].PinnedAt = nil
			}
		}
	}
	s.transientError = ""
	s.mu.Unlock()
	s.notify()
	return nil
}

// MarkRoomRead advances read_through_room_seq via PUT /v0/rooms/:r/read-state.
func (s *AppStore) MarkRoomRead(ctx context.Context, roomID string) error {
	client := s.Client()
	if client == nil {
		return errors.New("not connected")
	}
	var seq int64
	s.mu.RLock()
	for _, r := range s.rooms {
		if r.ID == roomID {
			seq = r.LatestRoomSeq
			break
		}
	}
	s.mu.RUnlock()
	if seq <= 0 {
		seq = 1
	}
	if err := client.UpdateRoomReadState(ctx, roomID, seq); err != nil {
		return err
	}
	s.mu.Lock()
	for i := range s.rooms {
		if s.rooms[i].ID == roomID {
			s.rooms[i].ReadThroughRoomSeq = seq
			s.rooms[i].UnreadMessageCount = 0
			s.rooms[i].UnreadMentionCount = 0
		}
	}
	s.mu.Unlock()
	s.notify()
	return nil
}

// MarkAllRoomsRead marks every unread room as caught up.
func (s *AppStore) MarkAllRoomsRead(ctx context.Context) error {
	snap := s.Snapshot()
	for _, r := range snap.Rooms {
		if r.UnreadMessageCount > 0 {
			_ = s.MarkRoomRead(ctx, r.ID)
		}
	}
	s.SetStatusMessage("All rooms marked caught up")
	return nil
}

// SetRoomParticipation switches participation between "joined" and "left" (snooze/mute).
func (s *AppStore) SetRoomParticipation(ctx context.Context, roomID, status string) error {
	client := s.Client()
	if client == nil {
		return errors.New("not connected")
	}
	if _, err := client.SetRoomParticipation(ctx, roomID, status); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	s.mu.Lock()
	for i := range s.rooms {
		if s.rooms[i].ID == roomID {
			st := status
			s.rooms[i].Participation = &st
		}
	}
	s.transientError = ""
	s.mu.Unlock()
	s.notify()
	return nil
}

// CreateRoom creates a new group Room and prepends it to the room list.
func (s *AppStore) CreateRoom(ctx context.Context, name, description string, memberIDs []string) (api.Room, error) {
	client := s.Client()
	tenantID := s.Snapshot().TenantID
	if client == nil || tenantID == "" {
		return api.Room{}, errors.New("not connected")
	}
	rm, err := client.CreateRoom(ctx, tenantID, strings.TrimSpace(name), strings.TrimSpace(description), memberIDs)
	if err != nil {
		s.SetTransientError(err.Error())
		return api.Room{}, err
	}
	_ = s.RefreshActiveHost(ctx)
	return rm, nil
}

// OpenDirectRoom opens or creates a DM with peerActorID.
func (s *AppStore) OpenDirectRoom(ctx context.Context, peerActorID string) (api.Room, error) {
	client := s.Client()
	tenantID := s.Snapshot().TenantID
	if client == nil || tenantID == "" {
		return api.Room{}, errors.New("not connected")
	}
	rm, err := client.OpenDirectRoom(ctx, tenantID, peerActorID)
	if err != nil {
		s.SetTransientError(err.Error())
		return api.Room{}, err
	}
	_ = s.RefreshActiveHost(ctx)
	return rm, nil
}

// DecideCard submits a decision for any of the 12 TeamHub Decision Card kinds
// and updates both Room Chat and Tab 2's Pending Approvals Inbox immediately.
func (s *AppStore) DecideCard(ctx context.Context, roomID, decisionID string, req api.DecisionRequest) (api.Message, error) {
	client := s.Client()
	if client == nil {
		return api.Message{}, errors.New("not connected")
	}
	updated, err := client.DecideDecision(ctx, decisionID, req)
	if err != nil {
		s.SetTransientError(err.Error())
		return api.Message{}, err
	}
	s.mu.Lock()
	targetRoom := updated.RoomID
	if targetRoom == "" {
		targetRoom = roomID
	}
	if targetRoom != "" {
		s.upsertRoomMessageLocked(targetRoom, updated)
	}
	// Also update any matching decision across loaded rooms in case roomID was omitted.
	for rid, msgs := range s.roomMessages {
		for i := range msgs {
			if msgs[i].Card != nil && msgs[i].Card.DecisionID == decisionID && updated.Card != nil {
				msgs[i].Card = updated.Card
			}
		}
		s.roomMessages[rid] = msgs
	}
	s.rebuildPendingDecisionsLocked()
	s.transientError = ""
	s.mu.Unlock()
	s.notify()
	return updated, nil
}

// SyncRunPresentation pulls latest incremental runtime presentation events for runID.
func (s *AppStore) SyncRunPresentation(ctx context.Context, roomID, runID string) error {
	client := s.Client()
	if client == nil {
		return errors.New("not connected")
	}
	s.mu.RLock()
	existing := s.runPresEvents[runID]
	var after int64
	for _, ev := range existing {
		if ord := ev.EffectiveOrdinal(); ord > after {
			after = ord
		}
	}
	s.mu.RUnlock()

	page, err := client.ListRoomRuntimePresentationEvents(ctx, roomID, runID, after)
	if err != nil {
		return err
	}
	for i, raw := range page.Items {
		var ev api.RuntimePresentationEvent
		_ = json.Unmarshal(raw, &ev)
		ev.Raw = raw
		if ev.EffectiveOrdinal() == 0 {
			ev.EventOrdinal = after + int64(i+1)
		}
		s.appendRunPresentationEvent(runID, ev)
	}
	s.notify()
	return nil
}

// CancelRun cancels an active Agent run via POST /v0/rooms/:r/runs/:run/cancel.
func (s *AppStore) CancelRun(ctx context.Context, roomID, runID string) error {
	client := s.Client()
	if client == nil {
		return errors.New("not connected")
	}
	if err := client.CancelRoomRun(ctx, roomID, runID); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	s.mu.Lock()
	for i := range s.activeRuns {
		if s.activeRuns[i].RunID == runID {
			s.activeRuns[i].Status = "aborted"
		}
	}
	s.rebuildWorkingRoomsLocked()
	s.transientError = ""
	s.mu.Unlock()
	s.SetStatusMessage("Run cancellation requested")
	return nil
}

// RedeliverRunInputs retries unconfirmed inputs on a stopped run.
func (s *AppStore) RedeliverRunInputs(ctx context.Context, roomID, runID string) error {
	client := s.Client()
	if client == nil {
		return errors.New("not connected")
	}
	if err := client.RedeliverRoomRunUnconfirmedInputs(ctx, roomID, runID); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	s.SetStatusMessage("Unconfirmed inputs redelivered")
	return nil
}

// ActOnLocalModel invokes pull, cancel_pull, load (with optional unloadFirst), unload, or remove.
func (s *AppStore) ActOnLocalModel(ctx context.Context, computerID, modelID, action string, unloadFirst []string) error {
	client := s.Client()
	tenantID := s.Snapshot().TenantID
	if client == nil || tenantID == "" {
		return errors.New("not connected")
	}
	if err := client.ActOnLocalComputerModelWithUnload(ctx, tenantID, computerID, modelID, action, unloadFirst); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	if lm, err := client.GetLocalComputerModels(ctx, tenantID, computerID); err == nil {
		s.mu.Lock()
		s.localModels = &lm
		s.transientError = ""
		s.mu.Unlock()
	}
	s.notify()
	return nil
}

// RecheckLocalModels triggers hardware & model catalog recheck on Desktop.
func (s *AppStore) RecheckLocalModels(ctx context.Context, computerID string) error {
	client := s.Client()
	tenantID := s.Snapshot().TenantID
	if client == nil || tenantID == "" {
		return errors.New("not connected")
	}
	if err := client.RefreshLocalComputerModels(ctx, tenantID, computerID); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	if lm, err := client.GetLocalComputerModels(ctx, tenantID, computerID); err == nil {
		s.mu.Lock()
		s.localModels = &lm
		s.transientError = ""
		s.mu.Unlock()
	}
	s.SetStatusMessage("Hardware recheck requested")
	return nil
}

// SwitchModelSource switches a Local Computer's model source (local / managed / byok).
func (s *AppStore) SwitchModelSource(ctx context.Context, computerID string, req api.ModelSourceSwitchRequest) (api.ModelSourceView, error) {
	client := s.Client()
	tenantID := s.Snapshot().TenantID
	if client == nil || tenantID == "" {
		return api.ModelSourceView{}, errors.New("not connected")
	}
	view, err := client.SwitchLocalComputerModelSource(ctx, tenantID, computerID, req)
	if err != nil {
		s.SetTransientError(err.Error())
		return api.ModelSourceView{}, err
	}
	s.mu.Lock()
	s.modelSource = &view
	s.transientError = ""
	s.mu.Unlock()
	s.SetStatusMessage("Model source updated to " + req.Mode)
	return view, nil
}

// --- Internal live SSE & projection helpers ---

func (s *AppStore) appendRunPresentationEvent(runID string, ev api.RuntimePresentationEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.runPresEvents[runID]
	ord := ev.EffectiveOrdinal()
	for _, existing := range cur {
		if ord > 0 && existing.EffectiveOrdinal() == ord {
			return
		}
	}
	cur = append(cur, ev)
	sort.Slice(cur, func(i, j int) bool {
		return cur[i].EffectiveOrdinal() < cur[j].EffectiveOrdinal()
	})
	s.runPresEvents[runID] = cur
}

func (s *AppStore) handleLiveRoomEvent(ctx context.Context, ev api.RoomEventEnvelope) {
	switch ev.EventType {
	case "message.created", "card.changed", "message.reactions.changed", "message.thread_summary.updated":
		// Refresh messages for the affected room in background so projection matches server truth.
		go func() {
			_ = s.LoadRoomMessages(ctx, ev.RoomID, false)
		}()
	case "agent_run.status_changed":
		var p struct {
			RunID        string `json:"run_id"`
			Status       string `json:"status"`
			EventOrdinal int64  `json:"event_ordinal"`
			Replied      bool   `json:"replied"`
		}
		if json.Unmarshal(ev.Payload, &p) == nil && p.RunID != "" {
			s.mu.Lock()
			updated := false
			for i := range s.activeRuns {
				if s.activeRuns[i].RunID == p.RunID {
					s.activeRuns[i].Status = p.Status
					s.activeRuns[i].EventOrdinal = p.EventOrdinal
					s.activeRuns[i].Replied = p.Replied
					s.activeRuns[i].UpdatedAt = ev.OccurredAt
					updated = true
					break
				}
			}
			if !updated && p.Status == "active" {
				agentName := "Agent"
				agentID := ""
				if ev.Actor != nil {
					agentName = ev.Actor.DisplayName
					agentID = ev.Actor.ID
				}
				s.activeRuns = append(s.activeRuns, api.RoomRunStatus{
					RunID:        p.RunID,
					RoomID:       ev.RoomID,
					Agent:        api.RoomRunStatusAgentRef{ID: agentID, DisplayName: agentName},
					Status:       p.Status,
					EventOrdinal: p.EventOrdinal,
					Replied:      p.Replied,
					CreatedAt:    ev.OccurredAt,
					UpdatedAt:    ev.OccurredAt,
				})
			}
			s.rebuildWorkingRoomsLocked()
			s.mu.Unlock()
		}
	}
}

func (s *AppStore) upsertRoomMessageLocked(roomID string, msg api.Message) {
	msgs := s.roomMessages[roomID]
	for i := range msgs {
		if msgs[i].ID == msg.ID {
			msgs[i] = msg
			s.roomMessages[roomID] = msgs
			return
		}
	}
	s.roomMessages[roomID] = append(msgs, msg)
}

func (s *AppStore) mergeRoomRunsLocked(roomID string, runs []api.RoomRunStatus) {
	byID := make(map[string]api.RoomRunStatus, len(s.activeRuns)+len(runs))
	for _, r := range s.activeRuns {
		if r.RoomID != roomID {
			byID[r.RunID] = r
		}
	}
	for _, r := range runs {
		byID[r.RunID] = r
	}
	next := make([]api.RoomRunStatus, 0, len(byID))
	for _, r := range byID {
		next = append(next, r)
	}
	sort.Slice(next, func(i, j int) bool {
		return next[i].UpdatedAt.After(next[j].UpdatedAt)
	})
	s.activeRuns = next
	s.rebuildWorkingRoomsLocked()
}

func (s *AppStore) rebuildWorkingRoomsLocked() {
	working := make(map[string]bool)
	for _, run := range s.activeRuns {
		if run.Status == "active" && !run.Replied {
			working[run.RoomID] = true
		}
	}
	s.workingRoomIDs = working
}

func (s *AppStore) rebuildPendingDecisionsLocked() {
	roomNames := make(map[string]string, len(s.rooms))
	for _, rm := range s.rooms {
		roomNames[rm.ID] = rm.Name
	}
	var out []PendingDecisionItem
	seen := map[string]bool{}
	for roomID, msgs := range s.roomMessages {
		for _, m := range msgs {
			if m.Card == nil || !IsDecisionPending(m.Card.Status) {
				continue
			}
			if seen[m.Card.DecisionID] {
				continue
			}
			seen[m.Card.DecisionID] = true
			name := roomNames[roomID]
			if name == "" {
				name = roomID
			}
			out = append(out, PendingDecisionItem{
				RoomID:    roomID,
				RoomName:  name,
				MessageID: m.ID,
				Card:      *m.Card,
				CreatedAt: m.CreatedAt,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	s.pendingDecisions = out
}

// IsDecisionPending reports whether a DecisionRequestedMessageCard still awaits human action.
func IsDecisionPending(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "pending", "open", "waiting", "requested":
		return true
	default:
		return false
	}
}
