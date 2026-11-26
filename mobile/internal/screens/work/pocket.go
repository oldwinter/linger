package work

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

type pocketOutboxPayload struct {
	TenantID string `json:"tenant_id"`
	Text     string `json:"text"`
	Date     string `json:"date"`
}

type pocketOutboxJob struct {
	IdempotencyKey string
	Payload        pocketOutboxPayload
}

type pocketSaveReq struct {
	seq      uint64
	tenantID string
	text     string
}

func newOutboxKey() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("pn_%d", time.Now().UnixNano())
	}
	return "pn_" + hex.EncodeToString(b[:])
}

func (s *Screen) viewPocketSegment(c *ui.Context) {
	t := c.Theme()
	m := layout.Of(c)

	s.mu.Lock()
	state := s.pocketState
	lastErr := s.pocketLastErr
	outboxCount := s.outboxPending + len(s.memOutbox)
	notes := append([]api.PocketNoteRecord(nil), s.pocketNotes...)
	todayDate := s.pocketToday
	s.mu.Unlock()
	if todayDate == "" {
		todayDate = time.Now().Format("2006-01-02")
		if len(notes) > 0 && notes[0].Date != "" {
			todayDate = notes[0].Date
		}
	}

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SegmentPocket]).Children(func() {
		layout.ReadableWrap(c, m.ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				if s.pocketActionErr != "" {
					components.StatusBanner(c, components.ToneDanger, s.pocketActionErr, i18n.T("common.dismiss"), func() {
						s.pocketActionErr = ""
					})
				}

				renderTodayCard := func() {
					// Today's Note card with explicit Save status indicator & offline sync retry
					components.SectionCard(c, i18n.T("work.pocket.today_title"), todayDate, func() {
						s.viewPocketStatusPill(c, state)
					}, func() {
						if state == PocketStateError && lastErr != "" {
							components.StatusBanner(c, components.ToneDanger,
								i18n.Tf("work.pocket.couldnt_save", map[string]any{"err": lastErr}),
								i18n.T("work.pocket.retry_sync"), func() {
									go func() { _ = s.SyncPocketOutbox(context.Background()) }()
								})
						} else if state == PocketStateSavedOffline {
							components.StatusBanner(c, components.ToneWarning,
								i18n.Tf("work.pocket.offline_pending", map[string]any{"count": maxInt(outboxCount, 1)}),
								i18n.T("work.pocket.retry_sync"), func() {
									go func() { _ = s.SyncPocketOutbox(context.Background()) }()
								})
						}

						noteMinH := float32(140)
						if m.GridColumns >= 2 {
							noteMinH = 190
						}
						ta := ui.TextArea(c, &s.pocketDraft).FillWidth().MinHeight(noteMinH).
							Placeholder(i18n.T("work.pocket.placeholder")).
							Label(i18n.T("work.pocket.note_input_a11y"))
						if ta.Changed() {
							s.pocketDirty = true
							s.queuePocketSave(s.pocketDraft)
						}

						ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
							saveBtn := components.PrimaryTouchButton(c, i18n.T("work.pocket.save_now"), state == PocketStateSaving)
							saveBtn.Grow(1).Basis(0)
							if saveBtn.Clicked() {
								s.pocketDirty = true
								s.queuePocketSave(s.pocketDraft)
							}

							retryBtn := components.SecondaryTouchButton(c, i18n.T("work.pocket.retry_sync"), state == PocketStateSaving)
							if retryBtn.Clicked() {
								go func() { _ = s.SyncPocketOutbox(context.Background()) }()
							}

							sendLabel := i18n.T("work.pocket.send_another_me")
							if s.pocketSendBusy {
								sendLabel = i18n.T("work.pocket.sending")
							}
							sendBtn := components.SecondaryTouchButton(c, sendLabel, s.pocketSendBusy || strings.TrimSpace(s.pocketDraft) == "")
							sendBtn.FillWidth()
							if sendBtn.Clicked() {
								s.sendPocketToAnotherMe(s.pocketDraft)
							}
						})
					})
				}

				renderPastDaysCard := func() {
					// Past Days History
					var past []api.PocketNoteRecord
					for _, n := range notes {
						if n.Date != todayDate {
							past = append(past, n)
						}
					}
					components.SectionCard(c, i18n.Tf("work.pocket.past_days_title", map[string]any{"count": len(past)}), i18n.T("work.pocket.past_days_sub"), nil, func() {
						if len(past) == 0 {
							ui.Text(c, i18n.T("work.pocket.past_days_empty")).FontSize(13).TextColor(t.TextMuted)
							return
						}
						ui.Column(c).FillWidth().Gap(8).Children(func() {
							for _, n := range past {
								n := n
								expanded := s.pocketExpandedDate == n.Date
								card := ui.Column(c.Key(n.Date)).FillWidth().Padding(11, 12).Gap(6).
									Radius(12).Background(theme.Extra(t).MutedBg).Border(0.75, theme.Extra(t).SubtleBorder)
								card.Children(func() {
									ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
										hdr := ui.Row(c).Grow(1).Basis(0).MinHeight(36).AlignItems(ui.Center).
											Role(ui.RoleButton).Label(i18n.Tf("work.pocket.note_a11y", map[string]any{"date": n.Date}))
										hdr.Children(func() {
											ui.Text(c, n.Date).FontSize(13).FontWeight(600).TextColor(t.Text)
										})
										if hdr.Clicked() {
											if expanded {
												s.pocketExpandedDate = ""
											} else {
												s.pocketExpandedDate = n.Date
											}
										}
										delBtn := ui.Row(c).MinHeight(32).PaddingX(10).Radius(8).Background(t.Surface).
											AlignItems(ui.Center).Role(ui.RoleButton).Label(i18n.Tf("work.pocket.delete_a11y", map[string]any{"date": n.Date}))
										delBtn.Children(func() {
											ui.Text(c, i18n.T("common.delete")).FontSize(11).FontWeight(600).TextColor(t.Danger)
										})
										if delBtn.Clicked() {
											s.pocketDeleteDate = n.Date
											s.pocketDeleteSheet = true
										}
									})
									txt := ui.Text(c, n.Text).FontSize(13).TextColor(t.TextMuted)
									if !expanded {
										txt.MaxLines(2)
									}
								})
							}
						})
					})
				}

				layout.TwoPaneRow(c, m.GridColumns >= 2, 12, renderTodayCard, renderPastDaysCard)
			})
		})
	})
}

func (s *Screen) viewPocketStatusPill(c *ui.Context, st PocketSaveState) {
	switch st {
	case PocketStateSaving:
		components.StatusDotPill(c, i18n.T("work.pocket.status.saving"), components.ToneBrand)
	case PocketStateSavedOffline:
		components.StatusDotPill(c, i18n.T("work.pocket.status.saved_offline"), components.ToneWarning)
	case PocketStateError:
		components.StatusDotPill(c, i18n.T("work.pocket.status.error"), components.ToneDanger)
	default:
		components.StatusDotPill(c, i18n.T("work.pocket.status.saved"), components.ToneSuccess)
	}
}

// SavePocketNoteDraft updates the draft text and submits it through the serialized
// save queue (exposed for direct deterministic testing as well as UI edits).
func (s *Screen) SavePocketNoteDraft(text string) {
	s.enqueueUI(func() {
		s.pocketDraft = text
		s.pocketDirty = true
	})
	s.queuePocketSave(text)
}

// CurrentPocketState returns the current durability state and draft text (for tests).
func (s *Screen) CurrentPocketState() (PocketSaveState, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pocketState, s.outboxPending + len(s.memOutbox)
}

func (s *Screen) queuePocketSave(text string) {
	tenantID := s.tenantID()
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.pocketSaveSeq++
	seq := s.pocketSaveSeq
	s.pocketPending = &pocketSaveReq{seq: seq, tenantID: tenantID, text: text}
	s.pocketState = PocketStateSaving
	s.pocketLastErr = ""
	wake := s.pocketWake
	s.mu.Unlock()

	select {
	case wake <- struct{}{}:
	default:
	}
}

func (s *Screen) runPocketWorker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.pocketWake:
			for {
				if ctx.Err() != nil {
					return
				}
				s.mu.Lock()
				req := s.pocketPending
				s.pocketPending = nil
				s.mu.Unlock()
				if req == nil {
					break
				}
				s.pocketMu.Lock()
				s.persistPocketSave(ctx, *req)
				s.pocketMu.Unlock()
			}
		}
	}
}

func (s *Screen) persistPocketSave(ctx context.Context, req pocketSaveReq) {
	today := s.todayDate()
	// Always persist immediately into local pocket_notes cache so drafts survive tab/app switch.
	note := api.PocketNoteRecord{
		Date:      today,
		Text:      req.text,
		UpdatedAt: time.Now().UTC(),
	}
	s.upsertLocalPocketNote(req.tenantID, note)

	client := s.client()
	if !s.isOnline() || client == nil || req.tenantID == "" {
		s.enqueuePocketOutbox(ctx, req.tenantID, today, req.text)
		s.mu.Lock()
		if s.pocketSaveSeq == req.seq {
			s.pocketState = PocketStateSavedOffline
			s.pocketLastErr = ""
		}
		s.mu.Unlock()
		s.notify()
		return
	}

	saved, err := client.PutTodayPocketNoteC2(ctx, req.tenantID, req.text)
	if err != nil {
		s.enqueuePocketOutbox(ctx, req.tenantID, today, req.text)
		s.mu.Lock()
		if s.pocketSaveSeq == req.seq {
			if !s.isOnline() {
				s.pocketState = PocketStateSavedOffline
				s.pocketLastErr = ""
			} else {
				s.pocketState = PocketStateError
				s.pocketLastErr = err.Error()
			}
		}
		s.mu.Unlock()
		s.notify()
		return
	}

	s.upsertLocalPocketNote(req.tenantID, saved)
	s.clearPocketOutbox(ctx)
	s.mu.Lock()
	s.pocketSavedSeq = req.seq
	isLatest := s.pocketSaveSeq == req.seq && s.pocketPending == nil
	if isLatest {
		s.pocketState = PocketStateSaved
		s.pocketLastErr = ""
		s.pocketServerTxt = saved.Text
	}
	s.mu.Unlock()
	if isLatest {
		s.enqueueUI(func() {
			s.mu.Lock()
			stillLatest := s.pocketSaveSeq == req.seq && s.pocketPending == nil
			s.mu.Unlock()
			if stillLatest {
				s.pocketDirty = false
			}
		})
	}
	s.notify()
}

// SyncPocketOutbox drains all queued offline Pocket Note mutations to TeamHub
// without touching other outbox kinds (such as message.create).
func (s *Screen) SyncPocketOutbox(ctx context.Context) error {
	s.pocketMu.Lock()
	defer s.pocketMu.Unlock()

	client := s.client()
	if client == nil || !s.isOnline() {
		return nil
	}

	s.mu.Lock()
	s.pocketState = PocketStateSaving
	s.mu.Unlock()
	s.notify()

	if cs := s.cacheStore(); cs != nil {
		_, err := cs.DrainOutboxByKind(ctx, "pocket_note.put", func(dCtx context.Context, item cache.OutboxItem) error {
			var pl pocketOutboxPayload
			if uErr := json.Unmarshal([]byte(item.PayloadJSON), &pl); uErr != nil {
				return uErr
			}
			tid := pl.TenantID
			if tid == "" {
				tid = s.tenantID()
			}
			saved, putErr := client.PutTodayPocketNoteC2(dCtx, tid, pl.Text)
			if putErr != nil {
				return putErr
			}
			s.upsertLocalPocketNote(tid, saved)
			return nil
		})
		s.refreshOutboxCount(ctx)
		if err != nil {
			s.mu.Lock()
			s.pocketState = PocketStateError
			s.pocketLastErr = err.Error()
			s.mu.Unlock()
			s.notify()
			return err
		}
	}

	// Drain in-memory outbox fallback if Cache was nil, removing ONLY acked entries.
	s.mu.Lock()
	mem := append([]pocketOutboxJob(nil), s.memOutbox...)
	s.mu.Unlock()
	for _, job := range mem {
		tid := job.Payload.TenantID
		if tid == "" {
			tid = s.tenantID()
		}
		saved, err := client.PutTodayPocketNoteC2(ctx, tid, job.Payload.Text)
		if err != nil {
			s.mu.Lock()
			s.pocketState = PocketStateError
			s.pocketLastErr = err.Error()
			s.mu.Unlock()
			s.notify()
			return err
		}
		s.upsertLocalPocketNote(tid, saved)
		s.mu.Lock()
		filtered := s.memOutbox[:0]
		for _, cur := range s.memOutbox {
			if cur.IdempotencyKey != job.IdempotencyKey {
				filtered = append(filtered, cur)
			}
		}
		s.memOutbox = filtered
		s.mu.Unlock()
	}

	s.mu.Lock()
	noMorePending := s.pocketPending == nil && s.outboxPending == 0 && len(s.memOutbox) == 0
	if noMorePending {
		s.pocketState = PocketStateSaved
		s.pocketLastErr = ""
	}
	s.mu.Unlock()
	if noMorePending {
		s.enqueueUI(func() {
			s.mu.Lock()
			stillClean := s.pocketPending == nil && s.outboxPending == 0 && len(s.memOutbox) == 0
			s.mu.Unlock()
			if stillClean {
				s.pocketDirty = false
			}
		})
	}
	s.notify()
	return nil
}

func (s *Screen) enqueuePocketOutbox(ctx context.Context, tenantID, noteDate, text string) {
	pl := pocketOutboxPayload{TenantID: tenantID, Date: noteDate, Text: text}
	if cs := s.cacheStore(); cs != nil {
		// Replace older queued pocket_note.put entries for this tenant so only latest note text drains.
		if existing, err := cs.ListOutboxByKind(ctx, "pocket_note.put"); err == nil {
			for _, it := range existing {
				if it.TargetID == tenantID {
					_ = cs.AckOutbox(ctx, it.ID)
				}
			}
		}
		_ = cs.EnqueueOutbox(ctx, newOutboxKey(), "pocket_note.put", tenantID, pl)
		s.refreshOutboxCount(ctx)
		return
	}
	s.mu.Lock()
	s.memOutbox = []pocketOutboxJob{{IdempotencyKey: newOutboxKey(), Payload: pl}}
	s.mu.Unlock()
}

func (s *Screen) clearPocketOutbox(ctx context.Context) {
	if cs := s.cacheStore(); cs != nil {
		if existing, err := cs.ListOutboxByKind(ctx, "pocket_note.put"); err == nil {
			for _, it := range existing {
				_ = cs.AckOutbox(ctx, it.ID)
			}
		}
		s.refreshOutboxCount(ctx)
	}
	s.mu.Lock()
	s.memOutbox = nil
	s.mu.Unlock()
}

func (s *Screen) refreshOutboxCount(ctx context.Context) {
	cs := s.cacheStore()
	if cs == nil {
		return
	}
	items, err := cs.ListOutboxByKind(ctx, "pocket_note.put")
	if err != nil {
		return
	}
	s.mu.Lock()
	s.outboxPending = len(items)
	s.mu.Unlock()
}

func (s *Screen) upsertLocalPocketNote(tenantID string, rec api.PocketNoteRecord) {
	if cs := s.cacheStore(); cs != nil && tenantID != "" {
		_ = cs.UpsertPocketNotes(context.Background(), tenantID, []api.PocketNote{rec.ToPocketNote()})
	}
	s.mu.Lock()
	replaced := false
	for i := range s.pocketNotes {
		if s.pocketNotes[i].Date == rec.Date {
			s.pocketNotes[i] = rec
			replaced = true
			break
		}
	}
	if !replaced {
		s.pocketNotes = append([]api.PocketNoteRecord{rec}, s.pocketNotes...)
	}
	s.mu.Unlock()
}

func (s *Screen) sendPocketToAnotherMe(text string) {
	text = strings.TrimSpace(text)
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || text == "" {
		return
	}
	s.pocketSendBusy = true
	s.pocketActionErr = ""
	go func() {
		ctx := context.Background()
		am, err := client.GetAnotherMe(ctx, tenantID)
		if err != nil {
			s.enqueueUI(func() {
				s.pocketSendBusy = false
				s.pocketActionErr = err.Error()
			})
			return
		}
		if am.RoomID == nil || strings.TrimSpace(*am.RoomID) == "" {
			s.enqueueUI(func() {
				s.pocketSendBusy = false
				s.pocketActionErr = i18n.T("work.pocket.another_me_unavailable")
			})
			return
		}
		targetRoomID := strings.TrimSpace(*am.RoomID)
		_, msgErr := client.CreateMessage(ctx, targetRoomID, api.CreateMessageRequest{
			RawMessage: text,
			Segments:   []api.MessageSegment{{Type: "text", Content: text}},
		}, newOutboxKey())
		s.enqueueUI(func() {
			s.pocketSendBusy = false
			if msgErr != nil {
				s.pocketActionErr = msgErr.Error()
				return
			}
			s.toast(i18n.T("work.pocket.toast.sent_another_me"))
			if s.deps.OnOpenRoom != nil {
				s.deps.OnOpenRoom(targetRoomID)
			}
		})
	}()
}

func (s *Screen) viewPocketDeleteActionSheet(c *ui.Context) {
	if s.pocketDeleteDate == "" {
		s.pocketDeleteSheet = false
		return
	}
	dateStr := s.pocketDeleteDate
	mobile.ActionSheet(c, &s.pocketDeleteSheet, mobile.ActionSheetOptions{
		Title:   i18n.T("work.pocket.delete_title"),
		Message: i18n.Tf("work.pocket.delete_body", map[string]any{"date": dateStr}),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("work.pocket.delete_btn"),
		Destructive: true,
		OnTap: func() {
			s.deletePocketNote(dateStr)
		},
	})
}

func (s *Screen) deletePocketNote(noteDate string) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" {
		return
	}
	go func() {
		if err := client.DeletePocketNote(context.Background(), tenantID, noteDate); err != nil {
			s.enqueueUI(func() { s.pocketActionErr = err.Error() })
			return
		}
		s.enqueueUI(func() {
			s.mu.Lock()
			var filtered []api.PocketNoteRecord
			for _, n := range s.pocketNotes {
				if n.Date != noteDate {
					filtered = append(filtered, n)
				}
			}
			s.pocketNotes = filtered
			s.mu.Unlock()
			s.pocketDeleteDate = ""
			s.toast(i18n.Tf("work.pocket.toast.deleted", map[string]any{"date": noteDate}))
		})
	}()
}

func (s *Screen) todayDate() string {
	s.mu.Lock()
	td := s.pocketToday
	s.mu.Unlock()
	if td != "" {
		return td
	}
	return time.Now().Format("2006-01-02")
}

func (s *Screen) todayPocketTextFromList(items []api.PocketNoteRecord, today string) string {
	for _, it := range items {
		if it.Date == today {
			return it.Text
		}
	}
	return ""
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
