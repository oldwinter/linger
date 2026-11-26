package rooms

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/imagepicker"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/egoist/mygo/ui/netimage"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (ctl *Controller) viewChat(c *ui.Context, snap state.Snapshot, roomID, parentRoomID string, isThread bool) {
	t := c.Theme()
	ex := theme.Extra(t)
	msgs, hasMore := ctl.store.RoomMessages(roomID)
	runs := ctl.store.RoomRunStatuses(roomID)

	myActorID := ""
	if snap.Identity != nil && len(snap.Identity.Actors) > 0 {
		myActorID = snap.Identity.Actors[0].ID
	}

	ui.Column(c).Fill().Children(func() {
		// Slim editorial Room sub-bar: message count + tactile Inspector pill.
		ui.Row(c).FillWidth().Padding(6, 14).Gap(8).Background(t.Background).AlignItems(ui.Center).
			Justify(ui.SpaceBetween).BorderWidth(0, 0, 0.75, 0).BorderColor(ex.Divider).Children(func() {
			if isThread {
				ui.Text(c, i18n.Tf("chat.thread_in", map[string]any{"name": roomTitle(snap, parentRoomID)})).FontSize(12).FontWeight(600).TextColor(t.TextMuted).MaxLines(1).Grow(1).Basis(0)
			} else {
				ui.Text(c, i18n.Tf("chat.reply_count_bar", map[string]any{"count": len(msgs)})).FontSize(12).FontWeight(500).TextColor(ex.TextSubtle).Grow(1).Basis(0)
				inspBtn := components.CompactSecondaryButton(c, i18n.T("chat.inspector"), theme.IconSliders, false)
				inspBtn.MinHeight(32).Label(i18n.T("rooms.title.inspector"))
				if inspBtn.Clicked() {
					ctl.openInspector(roomID, snap)
				}
			}
		})

		// Live Agent Run activity banner inside Room Chat — tapping opens Live Run Watch!
		for _, run := range runs {
			if run.Status != "active" && run.Status != "aborted" {
				continue
			}
			run := run
			tone := components.ToneInfo
			msg := i18n.Tf("chat.working_banner", map[string]any{"actor": run.Agent.DisplayName, "elapsed": formatElapsed(run.CreatedAt)})
			if run.Status == "aborted" {
				tone = components.ToneWarning
				msg = i18n.Tf("chat.stopped_banner", map[string]any{"actor": run.Agent.DisplayName, "status": i18n.StatusLabel(run.Status)})
			}
			ui.Box(c.Key("run_banner_"+run.RunID)).FillWidth().Padding(6, 12, 0, 12).Children(func() {
				components.StatusBanner(c, tone, msg, i18n.T("chat.watch_live"), func() {
					ctl.OpenRunWatch(roomID, run.RunID)
				})
			})
		}

		// Offline / transient error banner (disappears automatically on recovery).
		if snap.OfflineViewingCache {
			ui.Box(c).FillWidth().Padding(6, 12, 0, 12).Children(func() {
				components.StatusBanner(c, components.ToneWarning, i18n.T("chat.offline_cached"), "", nil)
			})
		} else if snap.TransientError != "" {
			ui.Box(c).FillWidth().Padding(6, 12, 0, 12).Children(func() {
				components.StatusBanner(c, components.ToneDanger, snap.TransientError, i18n.T("common.dismiss"), func() {
					ctl.store.ClearTransientError()
				})
			})
		}

		// Scrollable Message Timeline
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 12, 14, 12).Gap(10).Children(func() {
				if hasMore {
					olderBtn := components.SecondaryTouchButton(c, i18n.T("chat.load_older"), false)
					olderBtn.FillWidth()
					if olderBtn.Clicked() {
						go func() { _ = ctl.store.LoadRoomMessages(context.Background(), roomID, true) }()
					}
				}
				if len(msgs) == 0 {
					components.EmptyState(c, theme.IconRooms, i18n.T("chat.empty_title"),
						i18n.T("chat.empty_body"), "", nil)
				}
				for _, m := range msgs {
					m := m
					if m.MessageKind == "agent_runtime" {
						continue
					}
					ctl.viewMessageRow(c, snap, roomID, m, m.Author.ID == myActorID, isThread)
				}
			})
		})

		// Mobile IME-safe Composer docked cleanly above software keyboard.
		ctl.viewComposer(c, snap, roomID)
	})

	// Overlay sheets for Chat actions, Inspector, Zoom, HTML Fragment, and Mail Canvas.
	ctl.viewMentionSheet(c, snap, roomID)
	ctl.viewSkillSheet(c, snap, roomID)
	ctl.viewReactionSheet(c, roomID)
	ctl.viewForwardSheet(c, snap, roomID)
	ctl.viewZoomLightbox(c)
	ctl.viewHTMLPreviewSheet(c)
	ctl.viewMailCanvasSheet(c)
	ctl.viewInspectorSheet(c, snap)
}

func (ctl *Controller) viewMessageRow(c *ui.Context, snap state.Snapshot, roomID string, m api.Message, isOwn, isThread bool) {
	t := c.Theme()
	ex := theme.Extra(t)

	align := ui.Start
	if isOwn {
		align = ui.End
	}

	hasHTML := false
	for _, seg := range m.Segments {
		if seg.Type == "html_fragment" && strings.TrimSpace(seg.HTML) != "" {
			hasHTML = true
			break
		}
	}
	hasBubbleContent := (m.CardTitle != nil && *m.CardTitle != "") ||
		strings.TrimSpace(m.RawMessage) != "" ||
		hasHTML ||
		len(m.Attachments) > 0

	ui.Column(c.Key(m.ID)).FillWidth().AlignItems(align).Gap(5).Children(func() {
		// Author + timestamp line
		ui.Row(c).AlignItems(ui.Center).Gap(6).Children(func() {
			if !isOwn {
				components.AvatarBadge(c, m.Author.DisplayName, 24)
			}
			ui.Text(c, m.Author.DisplayName).FontSize(12.5).FontWeight(600).TextColor(t.TextMuted)
			if m.RoutineName != nil && *m.RoutineName != "" {
				components.StatusPill(c, i18n.Tf("chat.routine_label", map[string]any{"id": *m.RoutineName}), components.ToneInfo)
			}
			ui.Text(c, i18n.FormatRoomTime(m.CreatedAt)).FontSize(11).TextColor(ex.TextSubtle)
		})

		// Editorial asymmetrical chat bubble (obsidian/ivory for own, elevated surface for peers).
		if hasBubbleContent {
			renderBody := func(titleColor ui.Color) {
				if m.CardTitle != nil && *m.CardTitle != "" {
					ui.Text(c, *m.CardTitle).FontSize(14.5).FontWeight(600).TextColor(titleColor)
				}
				if strings.TrimSpace(m.RawMessage) != "" {
					markdown.View(c, m.RawMessage, &markdown.Options{WrapCode: true})
				}
				// Inline html_fragment segments rendered safely as summary + opt-in WebView preview sheet.
				for si, seg := range m.Segments {
					if seg.Type == "html_fragment" && strings.TrimSpace(seg.HTML) != "" {
						seg := seg
						title := seg.Content
						if title == "" {
							title = i18n.T("chat.html_widget_title")
						}
						ui.Row(c.Key(si)).FillWidth().Padding(10, 12).Radius(12).Background(ex.MutedBg).
							Border(0.75, ex.SubtleBorder).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(10).Children(func() {
							ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
								ui.Text(c, title).FontSize(13).FontWeight(600).TextColor(t.Text)
								ui.Text(c, i18n.T("chat.html_widget_subtitle")).FontSize(11.5).TextColor(t.TextMuted)
							})
							prevBtn := components.CompactSecondaryButton(c, i18n.T("chat.preview_btn"), nil, false)
							if prevBtn.Clicked() {
								ctl.openHTMLPreview(title, seg.HTML)
							}
						})
					}
				}
				// Image & File attachments (authenticated netimage + tap-to-zoom / share)
				for ai, att := range m.Attachments {
					att := att
					ctl.viewAttachment(c, ai, att)
				}
			}

			if isOwn {
				ownTheme := *t
				ownTheme.Dark = !t.Dark
				ownTheme.Text = ex.OwnBubbleText
				ownTheme.TextMuted = ex.OwnBubbleText.Alpha(0.76)
				ownTheme.Background = ex.OwnBubbleBg
				ownTheme.Surface = ex.OwnBubbleBg
				ownTheme.Border = ex.OwnBubbleText.Alpha(0.18)
				ownTheme.Accent = ex.Brand
				ui.Box(c).FillWidth().Padding(0, 0, 0, 40).Children(func() {
					bubble := ui.Themed(c, &ownTheme).FillWidth().Background(ex.OwnBubbleBg).
						Radius(18, 18, 5, 18).Padding(11, 14).Gap(8)
					if !t.Dark {
						bubble.Shadow(0, 2, 8, 0, ui.RGBA(20, 20, 16, 0.14))
					}
					bubble.Children(func() {
						renderBody(ex.OwnBubbleText)
					})
				})
			} else {
				ui.Box(c).FillWidth().Padding(0, 18, 0, 0).Children(func() {
					bubble := ui.Column(c).FillWidth().Background(ex.PeerBubbleBg).
						Radius(5, 18, 18, 18).Padding(11, 14).Gap(8)
					components.ApplyCardElevation(bubble, t)
					bubble.Children(func() {
						renderBody(t.Text)
					})
				})
			}
		}

		// Inline Decision Card sits directly outside the bubble as a first-class elevated surface.
		if m.Card != nil {
			card := *m.Card
			components.DecisionCardView(c, roomID, roomTitle(snap, roomID), card, ctl.decisionStateFor(card.DecisionID), ctl.decisionCallbacks())
		}

		// Reactions bar + whisper-quiet ghost micro-actions outside the bubble.
		currentActorID := ""
		if snap.Identity != nil {
			for _, act := range snap.Identity.Actors {
				if snap.TenantID == "" || act.TenantID == snap.TenantID {
					currentActorID = act.ID
					break
				}
			}
		}
		actionJustify := ui.Start
		if isOwn {
			actionJustify = ui.End
		}
		ui.Row(c).FillWidth().Wrap().AlignItems(ui.Center).Justify(actionJustify).Gap(4).Padding(0, 2).Children(func() {
			for _, rx := range m.Reactions {
				rx := rx
				reacted := rx.ReactedBy(currentActorID)
				rxBg := t.Surface
				rxBorder := ex.SubtleBorder
				if reacted {
					rxBg = ex.BrandTint
					rxBorder = ex.Brand.Alpha(0.32)
				}
				pill := ui.Row(c.Key("rx_"+rx.ReactionID)).MinHeight(28).Padding(3, 8).Radius(999).
					Background(rxBg).Border(0.75, rxBorder).AlignItems(ui.Center).
					Role(ui.RoleButton).Label(i18n.Tf("chat.react_a11y", map[string]any{"emoji": rx.ReactionID}))
				pill.Children(func() {
					ui.Text(c, fmt.Sprintf("%s %d", rx.DisplayEmoji(), rx.Count())).FontSize(11.5).FontWeight(500).TextColor(t.Text).NoWrap()
				})
				if pill.Clicked() {
					ctl.toggleReactionAsync(roomID, m.ID, rx.ReactionID, reacted)
				}
			}
			if !isThread && m.Thread != nil && m.Thread.ReplyCount > 0 {
				thBtn := ui.Row(c).MinHeight(28).Padding(3, 9).Radius(999).Background(ex.BrandTint).
					Border(0.75, ex.Brand.Alpha(0.28)).AlignItems(ui.Center).Role(ui.RoleButton).Label(i18n.T("chat.thread_btn"))
				thBtn.Children(func() {
					ui.Text(c, i18n.Tf("chat.thread_replies", map[string]any{"count": m.Thread.ReplyCount})+" ›").FontSize(11.5).FontWeight(600).TextColor(ex.BrandText).NoWrap()
				})
				if thBtn.Clicked() {
					ctl.store.Routers[state.TabRooms].Push("/rooms/" + roomID + "/thread/" + m.Thread.ThreadRoomID)
				}
			}
			ghostActionButton(c, i18n.T("chat.add_react"), func() {
				ctl.mu.Lock()
				mCopy := m
				ctl.reactTargetMsg = &mCopy
				ctl.reactSheetOpen = true
				ctl.mu.Unlock()
			})
			ghostActionButton(c, i18n.T("chat.pin"), func() {
				go func() {
					if cl := ctl.store.Client(); cl != nil {
						_ = cl.PutMessagePin(context.Background(), roomID, m.ID)
						ctl.store.SetStatusMessage(i18n.T("chat.toast.pinned"))
					}
				}()
			})
			ghostActionButton(c, i18n.T("chat.forward"), func() {
				ctl.mu.Lock()
				mCopy := m
				ctl.forwardTargetMsg = &mCopy
				ctl.forwardSheetOpen = true
				ctl.mu.Unlock()
			})
			if !isThread {
				ghostActionButton(c, i18n.T("chat.thread_btn"), func() {
					go func() {
						if cl := ctl.store.Client(); cl != nil {
							if th, err := cl.CreateOrGetMessageThread(context.Background(), roomID, m.ID); err == nil {
								ctl.ensureRoomLoaded(th.ID)
								ctl.store.EnqueueUI(func() {
									ctl.store.Routers[state.TabRooms].Push("/rooms/" + roomID + "/thread/" + th.ID)
								})
							}
						}
					}()
				})
			}
		})
	})
}

func (ctl *Controller) viewAttachment(c *ui.Context, idx int, att api.MessageAttachment) {
	t := c.Theme()
	ex := theme.Extra(t)
	cl := ctl.store.Client()
	contentPath := fmt.Sprintf("/v0/document-versions/%s/content", att.DocumentVersionID)
	resolvedURL := contentPath
	if cl != nil {
		resolvedURL = cl.ResolveEndpointURL(contentPath)
	}

	if strings.HasPrefix(strings.ToLower(att.MediaType), "image/") {
		imgBox := ui.Box(c.Key(idx)).FillWidth().Height(150).Radius(8).Clip().Border(1, t.Border).
			Role(ui.RoleButton).Label(i18n.Tf("chat.zoom_image_a11y", map[string]any{"name": att.Filename}))
		imgBox.Children(func() {
			netimage.Image(c, resolvedURL, netimage.Options{Fit: ui.Cover, MaxSide: 900, NoFade: true}).Fill()
		})
		if imgBox.Clicked() {
			ctl.openZoom(resolvedURL, att.Filename)
		}
		return
	}

	// Mail Canvas or generic file card
	ui.Row(c.Key(idx)).FillWidth().Padding(8, 10).Radius(8).Background(ex.MutedBg).
		Border(1, t.Border).AlignItems(ui.Center).Gap(8).Children(func() {
		ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
			ui.Text(c, att.Filename).FontSize(13).FontWeight(600).TextColor(t.Text).MaxLines(1)
			ui.Text(c, att.MediaType+" · "+i18n.FormatKB(int64(att.SizeBytes))).FontSize(11).TextColor(t.TextMuted)
		})
		if strings.Contains(strings.ToLower(att.MediaType), "mail") || strings.HasSuffix(strings.ToLower(att.Filename), ".mail.md") {
			mailBtn := components.SecondaryTouchButton(c, i18n.T("chat.open_mail"), false)
			if mailBtn.Clicked() {
				ctl.openMailCanvas(att.DocumentID)
			}
		} else {
			shareBtn := components.SecondaryTouchButton(c, i18n.T("chat.share"), false)
			if shareBtn.Clicked() {
				ctl.downloadAndShareAttachment(att)
			}
		}
	})
}

func (ctl *Controller) viewComposer(c *ui.Context, snap state.Snapshot, roomID string) {
	t := c.Theme()
	ex := theme.Extra(t)
	draft := ctl.store.GetDraft(roomID)

	ctl.mu.Lock()
	uploads := append([]api.MessageAttachmentUpload(nil), ctl.pendingUploads[roomID]...)
	replyMsg := ctl.replyTarget[roomID]
	uploading := ctl.uploadingRoom == roomID
	sending := ctl.sendingRoom == roomID
	ctl.mu.Unlock()

	sendNow := func(text string) {
		text = strings.TrimSpace(text)
		ctl.mu.Lock()
		curUploads := append([]api.MessageAttachmentUpload(nil), ctl.pendingUploads[roomID]...)
		curReply := ctl.replyTarget[roomID]
		ctl.mu.Unlock()
		if text == "" && len(curUploads) == 0 {
			return
		}
		uploadIDs := make([]string, 0, len(curUploads))
		for _, up := range curUploads {
			uploadIDs = append(uploadIDs, up.ID)
		}
		var replyID *string
		if curReply != nil {
			id := curReply.ID
			replyID = &id
		}
		ctl.mu.Lock()
		ctl.sendingRoom = roomID
		ctl.mu.Unlock()
		ctl.store.SetDraft(roomID, "")
		mygo.Haptics.Light()
		go func() {
			_, err := ctl.store.SendMessage(context.Background(), roomID, text, replyID, uploadIDs)
			ctl.mu.Lock()
			ctl.sendingRoom = ""
			if err == nil {
				delete(ctl.pendingUploads, roomID)
				delete(ctl.replyTarget, roomID)
			}
			ctl.mu.Unlock()
		}()
	}

	// Unified floating elevated composer card above keyboard/bottom edge.
	ui.Box(c).FillWidth().Padding(6, 12, 10, 12).Background(t.Background).Children(func() {
		composer := ui.Column(c).FillWidth().Background(t.Surface).Radius(20).Padding(10, 12, 8, 12).Gap(8)
		components.ApplyCardElevation(composer, t)
		composer.Children(func() {
			if replyMsg != nil {
				ui.Row(c).FillWidth().Padding(5, 10).Radius(10).Background(ex.MutedBg).AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
					ui.Text(c, i18n.Tf("chat.replying_to", map[string]any{"text": replyMsg.Author.DisplayName})).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
					ghostActionButton(c, i18n.T("common.cancel"), func() {
						ctl.mu.Lock()
						delete(ctl.replyTarget, roomID)
						ctl.mu.Unlock()
					})
				})
			}

			// Attachment upload chips with remove button
			if len(uploads) > 0 || uploading {
				ui.Row(c).FillWidth().Wrap().Gap(6).AlignItems(ui.Center).Children(func() {
					if uploading {
						components.StatusDotPill(c, i18n.T("chat.uploading"), components.ToneInfo)
					}
					for _, up := range uploads {
						up := up
						ui.Row(c.Key(up.ID)).MinHeight(30).Padding(4, 9).Radius(999).Background(ex.MutedBg).
							Border(0.75, ex.SubtleBorder).Gap(6).AlignItems(ui.Center).Children(func() {
							ui.Text(c, up.Filename).FontSize(11.5).FontWeight(500).TextColor(t.Text).MaxLines(1)
							rmBtn := ui.Row(c).Size(22, 22).AlignItems(ui.Center).Justify(ui.Center).Role(ui.RoleButton).Label(i18n.Tf("chat.remove_att_a11y", map[string]any{"name": up.Filename}))
							rmBtn.Children(func() { ui.Text(c, "×").FontSize(14).TextColor(t.Danger) })
							if rmBtn.Clicked() {
								ctl.removeUploadAsync(roomID, up.ID)
							}
						})
					}
				})
			}

			// Multiline IME-safe TextArea + sleek pill Send button
			ui.Row(c).FillWidth().AlignItems(ui.End).Gap(8).Children(func() {
				var area ui.Element
				area = ui.TextArea(c.Key("draft_"+roomID), &draft).Grow(1).Basis(0).MinHeight(42).MaxHeight(120).
					Placeholder(i18n.T("chat.composer_placeholder")).Label(i18n.T("chat.composer_a11y")).Multiline(true)
				area.OnTextKey(func(k ui.TextKey) bool {
					if k.Key != ui.KeyEnter {
						return false
					}
					// Never submit during IME composition; Cmd/Ctrl+Enter always sends;
					// bare Enter sends only when ComposerReturnSends is enabled.
					if area.Composing() {
						return false
					}
					isCmdOrCtrl := k.Mods&(ui.Super|ui.Ctrl) != 0
					if isCmdOrCtrl || (k.Mods == 0 && snap.ComposerReturnSends) {
						txt := k.Text()
						if strings.TrimSpace(txt) != "" {
							k.SetText("")
							sendNow(txt)
						}
						return true
					}
					return false
				})
				if area.Changed() {
					ctl.store.SetDraft(roomID, draft)
				}

				canSend := !sending && (strings.TrimSpace(draft) != "" || len(uploads) > 0)
				sendBtn := components.CompactPrimaryButton(c, func() string {
					if sending {
						return i18n.T("common.syncing")
					}
					return i18n.T("chat.send")
				}(), theme.IconSend, !canSend)
				sendBtn.MinHeight(40)
				if sendBtn.Clicked() {
					sendNow(draft)
				}
			})

			// Quiet inline tool strip tucked inside the unified composer card.
			ui.Row(c).FillWidth().Wrap().Gap(4).AlignItems(ui.Center).BorderWidth(0.75, 0, 0, 0).BorderColor(ex.Divider).Padding(6, 0, 0, 0).Children(func() {
				composerToolChip(c, i18n.T("chat.photo"), func() { ctl.pickPhotoAndUpload(roomID) })
				composerToolChip(c, i18n.T("chat.file"), func() { ctl.pickFileAndUpload(roomID) })
				composerToolChip(c, i18n.T("chat.mention_btn"), func() {
					ctl.mu.Lock()
					ctl.mentionSheetOpen = true
					ctl.mu.Unlock()
				})
				composerToolChip(c, i18n.T("chat.skill_btn"), func() {
					ctl.mu.Lock()
					ctl.skillSheetOpen = true
					ctl.mu.Unlock()
				})
			})
		})
	})
}

func (ctl *Controller) decisionCallbacks() components.DecisionCardCallbacks {
	return components.DecisionCardCallbacks{
		ResolveURL: func(path string) string {
			if cl := ctl.store.Client(); cl != nil {
				return cl.ResolveEndpointURL(path)
			}
			return path
		},
		OnDecide: func(roomID, decisionID string, req api.DecisionRequest) {
			st := ctl.decisionStateFor(decisionID)
			go func() {
				_, _ = ctl.store.DecideCard(context.Background(), roomID, decisionID, req)
				st.SetBusy("")
			}()
		},
		OnOpenSettingsKey: ctl.nav.OnOpenSettingsKey,
		OnOpenCompute:     ctl.nav.OnOpenCompute,
		OnZoomImage:       ctl.openZoom,
	}
}

func (ctl *Controller) openZoom(url, title string) {
	ctl.mu.Lock()
	ctl.zoomURL = url
	ctl.zoomTitle = title
	ctl.zoomState.Reset()
	ctl.zoomOpen = true
	ctl.mu.Unlock()
}

func (ctl *Controller) viewZoomLightbox(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.zoomOpen, mobile.SheetOptions{
		Detents: []float32{0.88},
		Label:   i18n.T("chat.image_viewer_title"),
	}, func() {
		ctl.mu.Lock()
		u := ctl.zoomURL
		title := ctl.zoomTitle
		ctl.mu.Unlock()
		ui.Column(c).Fill().Padding(8, 12, 16, 12).Gap(8).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
				ui.Text(c, title).FontSize(15).FontWeight(600).TextColor(t.Text).MaxLines(1).Grow(1).Basis(0)
				if components.SecondaryTouchButton(c, i18n.T("common.close"), false).Clicked() {
					ctl.zoomOpen = false
				}
			})
			mobile.Zoomable(c, &ctl.zoomState, mobile.ZoomOptions{Min: 1, Max: 4, DoubleTap: 2}, func() {
				netimage.Image(c, u, netimage.Options{Fit: ui.Contain, MaxSide: 2048, NoFade: true}).Fill()
			}).FillWidth().Grow(1).Basis(0)
		})
	})
}

// allowHTMLFragmentNavigation enforces that untrusted inline HTML fragment
// WebViews can only load about:blank and never navigate to file://, linger://,
// javascript:, or external origins.
func allowHTMLFragmentNavigation(rawURL string) bool {
	u := strings.TrimSpace(rawURL)
	return u == "" || strings.EqualFold(u, "about:blank")
}

func (ctl *Controller) destroyHTMLWebView() {
	ctl.mu.Lock()
	wv := ctl.htmlWebView
	ctl.htmlWebView = nil
	ctl.mu.Unlock()
	if wv != nil {
		wv.Destroy()
	}
}

func (ctl *Controller) openHTMLPreview(title, html string) {
	ctl.destroyHTMLWebView()
	ctl.mu.Lock()
	ctl.htmlTitle = title
	ctl.htmlContent = html
	ctl.htmlOpen = true
	win := ctl.win
	var wv *mygo.WebView
	if win != nil {
		if created, err := win.NewWebView(mygo.WebViewOptions{
			Page: mygo.PageOptions{
				Untrusted: true,
			},
		}); err == nil {
			created.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
				if !allowHTMLFragmentNavigation(e.URL) {
					e.PreventDefault()
				}
			})
			ctl.htmlWebView = created
			wv = created
		}
	}
	ctl.mu.Unlock()
	if wv != nil {
		wv.Page().LoadHTML(html, "")
	}
}

func (ctl *Controller) viewHTMLPreviewSheet(c *ui.Context) {
	t := c.Theme()
	wasOpen := ctl.htmlOpen
	mobile.Sheet(c, &ctl.htmlOpen, mobile.SheetOptions{
		Detents: []float32{0.75, 0.92},
		Label:   i18n.T("chat.html_preview_title"),
	}, func() {
		ctl.mu.Lock()
		title := ctl.htmlTitle
		html := ctl.htmlContent
		wv := ctl.htmlWebView
		ctl.mu.Unlock()
		ui.Column(c).Fill().Padding(10, 14, 16, 14).Gap(8).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
				ui.Text(c, title).FontSize(16).Bold().TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
				if components.SecondaryTouchButton(c, i18n.T("common.close"), false).Clicked() {
					ctl.htmlOpen = false
					ctl.destroyHTMLWebView()
				}
			})
			if wv != nil {
				ui.WebView(c, wv).FillWidth().Grow(1).Basis(0)
			} else {
				ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
					ui.Text(c, html).FontSize(12).TextColor(t.TextMuted)
				})
			}
		})
	})
	if wasOpen && !ctl.htmlOpen {
		ctl.destroyHTMLWebView()
	}
}

// OpenMailCanvas fetches and opens the Mail Canvas sheet for documentID.
func (ctl *Controller) openMailCanvas(docID string) {
	ctl.mu.Lock()
	ctl.mailDocID = docID
	ctl.mailState = nil
	ctl.mailError = ""
	ctl.mailBusy = true
	ctl.mailOpen = true
	ctl.mu.Unlock()
	go func() {
		cl := ctl.store.Client()
		if cl == nil {
			ctl.mu.Lock()
			ctl.mailBusy = false
			ctl.mailError = i18n.T("state.err.not_connected")
			ctl.mu.Unlock()
			return
		}
		st, err := cl.GetMailCanvas(context.Background(), docID)
		ctl.mu.Lock()
		ctl.mailBusy = false
		if err != nil {
			ctl.mailError = err.Error()
		} else {
			ctl.mailState = &st
		}
		ctl.mu.Unlock()
	}()
}

func (ctl *Controller) viewMailCanvasSheet(c *ui.Context) {
	mobile.Sheet(c, &ctl.mailOpen, mobile.SheetOptions{
		Detents: []float32{0.68, 0.90},
		Label:   i18n.T("chat.mail_canvas_title"),
	}, func() {
		ctl.mu.Lock()
		docID := ctl.mailDocID
		ms := ctl.mailState
		busy := ctl.mailBusy
		mErr := ctl.mailError
		ctl.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
				if mErr != "" {
					components.ErrorInline(c, mErr, func() { ctl.openMailCanvas(docID) })
				}
				if ms == nil {
					if busy {
						components.LoadingSkeleton(c, 2)
					}
					return
				}
				components.MailCanvasCard(c, docID, *ms, busy, components.MailCanvasCallbacks{
					OnSend: func(id string, st api.MailCanvasState) {
						ctl.mu.Lock()
						ctl.mailBusy = true
						ctl.mailError = ""
						ctl.mu.Unlock()
						go func() {
							cl := ctl.store.Client()
							if cl == nil {
								return
							}
							updated, err := cl.SendMailCanvas(context.Background(), id, api.SendMailCanvasRequest{
								RequestID:    fmt.Sprintf("mail_%d", time.Now().UnixNano()),
								SourceDigest: st.SourceDigest,
							})
							ctl.mu.Lock()
							ctl.mailBusy = false
							if err != nil {
								ctl.mailError = err.Error()
							} else {
								ctl.mailState = &updated
							}
							ctl.mu.Unlock()
						}()
					},
					OnDecline: func(id string, _ api.MailCanvasState) {
						ctl.mu.Lock()
						ctl.mailBusy = true
						ctl.mu.Unlock()
						go func() {
							cl := ctl.store.Client()
							if cl == nil {
								return
							}
							updated, err := cl.DeclineMailCanvas(context.Background(), id)
							ctl.mu.Lock()
							ctl.mailBusy = false
							if err != nil {
								ctl.mailError = err.Error()
							} else {
								ctl.mailState = &updated
							}
							ctl.mu.Unlock()
						}()
					},
				})
			})
		})
	})
}

func (ctl *Controller) viewMentionSheet(c *ui.Context, snap state.Snapshot, roomID string) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.mentionSheetOpen, mobile.SheetOptions{Detents: []float32{0.5}, Label: i18n.T("chat.mention_sheet_a11y")}, func() {
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 20, 16).Gap(8).Children(func() {
				ui.Text(c, i18n.T("chat.mention_sheet_title")).FontSize(16).Bold().TextColor(t.Text)
				for _, act := range snap.Actors {
					act := act
					row := ui.Row(c.Key("m_"+act.ID)).FillWidth().MinHeight(44).Padding(8, 10).Gap(8).
						Radius(10).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
						Role(ui.RoleButton).Label(i18n.Tf("chat.mention_a11y", map[string]any{"name": act.DisplayName}))
					row.Children(func() {
						components.AvatarBadge(c, act.DisplayName, 28)
						ui.Text(c, "@"+act.DisplayName).FontSize(14).TextColor(t.Text).Grow(1).Basis(0)
						components.StatusPill(c, i18n.ActorRoleLabel(act.Kind), components.ToneNeutral)
					})
					if row.Clicked() {
						cur := ctl.store.GetDraft(roomID)
						sep := ""
						if cur != "" && !strings.HasSuffix(cur, " ") {
							sep = " "
						}
						ctl.store.SetDraft(roomID, cur+sep+"@"+act.DisplayName+" ")
						ctl.mentionSheetOpen = false
					}
				}
			})
		})
	})
}

func (ctl *Controller) viewSkillSheet(c *ui.Context, snap state.Snapshot, roomID string) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.skillSheetOpen, mobile.SheetOptions{Detents: []float32{0.5}, Label: i18n.T("chat.skill_sheet_a11y")}, func() {
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 20, 16).Gap(8).Children(func() {
				ui.Text(c, i18n.T("chat.skill_sheet_title")).FontSize(16).Bold().TextColor(t.Text)
				if len(snap.SkillManifests) == 0 {
					ui.Text(c, i18n.T("chat.skill_empty")).FontSize(13).TextColor(t.TextMuted)
				}
				for _, sk := range snap.SkillManifests {
					sk := sk
					row := ui.Row(c.Key("sk_"+sk.SkillID)).FillWidth().MinHeight(48).Padding(8, 10).Gap(6).
						Radius(10).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
						Role(ui.RoleButton).Label(i18n.Tf("chat.skill_a11y", map[string]any{"id": sk.Name}))
					row.Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, "/"+sk.Name).FontSize(14).FontWeight(600).TextColor(t.Accent)
							ui.Text(c, sk.Description).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
						})
					})
					if row.Clicked() {
						cur := ctl.store.GetDraft(roomID)
						sep := ""
						if cur != "" && !strings.HasSuffix(cur, " ") {
							sep = " "
						}
						ctl.store.SetDraft(roomID, cur+sep+"/"+sk.Name+" ")
						ctl.skillSheetOpen = false
					}
				}
			})
		})
	})
}

func (ctl *Controller) viewReactionSheet(c *ui.Context, roomID string) {
	quick := []struct{ id, label string }{
		{"thumbs_up", "👍"},
		{"heart", "❤️"},
		{"eyes", "👀"},
		{"tada", "🎉"},
		{"check", "✅"},
	}
	actions := make([]mobile.Action, 0, len(quick))
	for _, q := range quick {
		q := q
		actions = append(actions, mobile.Action{
			Label: q.label + " " + i18n.ReactionLabel(q.id),
			OnTap: func() {
				ctl.mu.Lock()
				target := ctl.reactTargetMsg
				ctl.mu.Unlock()
				if target != nil {
					ctl.toggleReactionAsync(roomID, target.ID, q.id, false)
				}
			},
		})
	}
	mobile.ActionSheet(c, &ctl.reactSheetOpen, mobile.ActionSheetOptions{Title: i18n.T("chat.react_sheet_title"), Cancel: i18n.T("common.cancel")}, actions...)
}

func (ctl *Controller) viewForwardSheet(c *ui.Context, snap state.Snapshot, fromRoomID string) {
	actions := make([]mobile.Action, 0, len(snap.Rooms))
	for _, rm := range snap.Rooms {
		if rm.ID == fromRoomID || rm.Kind == "thread" {
			continue
		}
		rm := rm
		actions = append(actions, mobile.Action{
			Label: i18n.Tf("chat.forward_to", map[string]any{"name": rm.Name}),
			OnTap: func() {
				ctl.mu.Lock()
				target := ctl.forwardTargetMsg
				ctl.mu.Unlock()
				if target == nil {
					return
				}
				go func() {
					if cl := ctl.store.Client(); cl != nil {
						_, _ = cl.ForwardRoomMessage(context.Background(), fromRoomID, target.ID, rm.ID, fmt.Sprintf("fwd_%d", time.Now().UnixNano()))
						ctl.store.SetStatusMessage(i18n.Tf("chat.toast.forwarded", map[string]any{"name": rm.Name}))
					}
				}()
			},
		})
	}
	mobile.ActionSheet(c, &ctl.forwardSheetOpen, mobile.ActionSheetOptions{Title: i18n.T("chat.forward_sheet_title"), Cancel: i18n.T("common.cancel")}, actions...)
}

func (ctl *Controller) toggleReactionAsync(roomID, msgID, reactionID string, remove bool) {
	go func() {
		cl := ctl.store.Client()
		if cl == nil {
			return
		}
		if remove {
			_ = cl.DeleteMessageReaction(context.Background(), roomID, msgID, reactionID)
		} else {
			_ = cl.PutMessageReaction(context.Background(), roomID, msgID, reactionID)
		}
		_ = ctl.store.LoadRoomMessages(context.Background(), roomID, false)
	}()
}

func (ctl *Controller) pickPhotoAndUpload(roomID string) {
	go func() {
		paths, err := imagepicker.Pick(context.Background(), imagepicker.Options{Limit: 1})
		if err != nil {
			if errors.Is(err, errors.ErrUnsupported) {
				ctl.pickFileAndUpload(roomID)
			}
			return
		}
		if len(paths) > 0 {
			ctl.uploadFilePath(roomID, paths[0], "image/jpeg")
		}
	}()
}

func (ctl *Controller) pickFileAndUpload(roomID string) {
	go func() {
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Title: i18n.T("chat.pick_attach")})
		if err != nil || len(paths) == 0 {
			return
		}
		ctl.uploadFilePath(roomID, paths[0], "application/octet-stream")
	}()
}

func (ctl *Controller) uploadFilePath(roomID, path, mediaType string) {
	cl := ctl.store.Client()
	if cl == nil {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		ctl.store.SetTransientError(i18n.Tf("chat.err_read_attach", map[string]any{"err": err.Error()}))
		return
	}
	ctl.mu.Lock()
	ctl.uploadingRoom = roomID
	ctl.mu.Unlock()
	up, err := cl.UploadMessageAttachment(context.Background(), roomID, filepath.Base(path), mediaType, data, fmt.Sprintf("up_%d", time.Now().UnixNano()))
	ctl.mu.Lock()
	ctl.uploadingRoom = ""
	if err == nil {
		ctl.pendingUploads[roomID] = append(ctl.pendingUploads[roomID], up)
	}
	ctl.mu.Unlock()
	if err != nil {
		ctl.store.SetTransientError(i18n.Tf("chat.err_upload_attach", map[string]any{"err": err.Error()}))
	}
}

func (ctl *Controller) removeUploadAsync(roomID, uploadID string) {
	ctl.mu.Lock()
	cur := ctl.pendingUploads[roomID]
	next := cur[:0]
	for _, up := range cur {
		if up.ID != uploadID {
			next = append(next, up)
		}
	}
	ctl.pendingUploads[roomID] = next
	ctl.mu.Unlock()
	go func() {
		if cl := ctl.store.Client(); cl != nil {
			_ = cl.CancelMessageAttachmentUpload(context.Background(), roomID, uploadID)
		}
	}()
}

func (ctl *Controller) downloadAndShareAttachment(att api.MessageAttachment) {
	go func() {
		cl := ctl.store.Client()
		if cl == nil {
			return
		}
		data, _, err := cl.DownloadDocumentVersion(context.Background(), att.DocumentVersionID)
		if err != nil {
			ctl.store.SetTransientError(i18n.Tf("chat.err_download", map[string]any{"err": err.Error()}))
			return
		}
		tmpPath := filepath.Join(os.TempDir(), filepath.Base(att.Filename))
		if writeErr := os.WriteFile(tmpPath, data, 0o600); writeErr == nil {
			_ = mygo.Share(mygo.ShareOptions{Files: []string{tmpPath}})
		}
	}()
}

func ghostActionButton(c *ui.Context, label string, onTap func()) {
	t := c.Theme()
	ex := theme.Extra(t)
	btn := ui.Row(c).MinHeight(28).Padding(4, 7).Radius(8).Background(ui.Transparent).
		AlignItems(ui.Center).Justify(ui.Center).Role(ui.RoleButton).Label(label)
	if btn.Pressed() {
		btn.Background(ex.MutedBg)
	}
	btn.Children(func() {
		ui.Text(c, label).FontSize(11.5).FontWeight(500).TextColor(ex.TextSubtle).NoWrap()
	})
	if btn.Clicked() && onTap != nil {
		onTap()
	}
}

func composerToolChip(c *ui.Context, label string, onTap func()) {
	t := c.Theme()
	ex := theme.Extra(t)
	btn := ui.Row(c).MinHeight(30).Padding(4, 9).Radius(999).Background(ex.MutedBg).
		AlignItems(ui.Center).Justify(ui.Center).Role(ui.RoleButton).Label(label)
	if btn.Pressed() {
		btn.Background(t.SurfacePressed)
	}
	btn.Children(func() {
		ui.Text(c, label).FontSize(12).FontWeight(500).TextColor(t.TextMuted).NoWrap()
	})
	if btn.Clicked() && onTap != nil {
		onTap()
	}
}

func formatElapsed(start time.Time) string {
	if start.IsZero() {
		return i18n.FormatElapsed(0)
	}
	return i18n.FormatElapsed(int64(time.Since(start).Seconds()))
}
