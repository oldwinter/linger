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
		// Compact Room sub-bar: Inspector button (for rooms) + Active Run Watch live banner.
		ui.Row(c).FillWidth().Padding(6, 12).Gap(8).Background(ex.SidebarBg).AlignItems(ui.Center).
			Justify(ui.SpaceBetween).Border(0.5, t.Border).Children(func() {
			if isThread {
				ui.Text(c, "Thread in "+roomTitle(snap, parentRoomID)).FontSize(12).FontWeight(600).TextColor(t.TextMuted).MaxLines(1).Grow(1).Basis(0)
			} else {
				ui.Text(c, components.PluralInt(len(msgs), "message", "messages")).FontSize(12).TextColor(t.TextMuted).Grow(1).Basis(0)
				inspBtn := ui.Row(c).MinHeight(36).PaddingX(10).Radius(8).Background(t.Surface).
					Border(1, t.Border).AlignItems(ui.Center).Role(ui.RoleButton).Label("Room Inspector")
				inspBtn.Children(func() {
					ui.Text(c, "Inspector").FontSize(12).FontWeight(600).TextColor(t.Accent).NoWrap()
				})
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
			msg := fmt.Sprintf("%s is working (%s)", run.Agent.DisplayName, formatElapsed(run.CreatedAt))
			if run.Status == "aborted" {
				tone = components.ToneWarning
				msg = fmt.Sprintf("%s stopped (%s)", run.Agent.DisplayName, run.Status)
			}
			ui.Box(c.Key("run_banner_"+run.RunID)).FillWidth().Padding(6, 12, 0, 12).Children(func() {
				components.StatusBanner(c, tone, msg, "Watch Live", func() {
					ctl.OpenRunWatch(roomID, run.RunID)
				})
			})
		}

		// Offline / transient error banner (disappears automatically on recovery).
		if snap.OfflineViewingCache {
			ui.Box(c).FillWidth().Padding(6, 12, 0, 12).Children(func() {
				components.StatusBanner(c, components.ToneWarning, "Offline — viewing cached messages", "", nil)
			})
		} else if snap.TransientError != "" {
			ui.Box(c).FillWidth().Padding(6, 12, 0, 12).Children(func() {
				components.StatusBanner(c, components.ToneDanger, snap.TransientError, "Dismiss", func() {
					ctl.store.ClearTransientError()
				})
			})
		}

		// Scrollable Message Timeline
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 12, 14, 12).Gap(10).Children(func() {
				if hasMore {
					olderBtn := components.SecondaryTouchButton(c, "Load Older Messages", false)
					olderBtn.FillWidth()
					if olderBtn.Clicked() {
						go func() { _ = ctl.store.LoadRoomMessages(context.Background(), roomID, true) }()
					}
				}
				if len(msgs) == 0 {
					components.EmptyState(c, theme.IconRooms, "No messages yet",
						"Send a message below or mention an Agent with @.", "", nil)
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

	// Town Light/Dark semantic chat bubble surfaces.
	bubbleBg := t.Surface
	bubbleBorder := t.Border
	if isOwn {
		bubbleBg = ex.InfoTint
		bubbleBorder = t.Accent.Alpha(0.28)
	}

	align := ui.Start
	if isOwn {
		align = ui.End
	}

	ui.Column(c.Key(m.ID)).FillWidth().AlignItems(align).Gap(4).Children(func() {
		// Author + timestamp line
		ui.Row(c).AlignItems(ui.Center).Gap(6).Children(func() {
			if !isOwn {
				components.AvatarBadge(c, m.Author.DisplayName, 22)
			}
			ui.Text(c, m.Author.DisplayName).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
			if m.RoutineName != nil && *m.RoutineName != "" {
				components.StatusPill(c, "Routine: "+*m.RoutineName, components.ToneInfo)
			}
			ui.Text(c, formatRelativeTime(m.CreatedAt)).FontSize(11).TextColor(t.TextMuted)
		})

		// Bubble body
		ui.Column(c).FillWidth().Background(bubbleBg).Radius(12).Border(1, bubbleBorder).Padding(10, 12).Gap(8).Children(func() {
			if m.CardTitle != nil && *m.CardTitle != "" {
				ui.Text(c, *m.CardTitle).FontSize(14).Bold().TextColor(t.Text)
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
						title = "Interactive HTML Widget"
					}
					ui.Row(c.Key(si)).FillWidth().Padding(8, 10).Radius(8).Background(ex.MutedBg).
						Border(1, t.Border).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, title).FontSize(13).FontWeight(600).TextColor(t.Text)
							ui.Text(c, "Sandboxed HTML fragment — tap to preview").FontSize(11).TextColor(t.TextMuted)
						})
						prevBtn := components.SecondaryTouchButton(c, "Preview", false)
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

			// Inline Decision Card (all 12 real TeamHub kinds!)
			if m.Card != nil {
				card := *m.Card
				components.DecisionCardView(c, roomID, roomTitle(snap, roomID), card, ctl.decisionStateFor(card.DecisionID), ctl.decisionCallbacks())
			}

			// Reactions bar + quick actions (React, Pin, Forward, Thread)
			currentActorID := ""
			if snap.Identity != nil {
				for _, act := range snap.Identity.Actors {
					if snap.TenantID == "" || act.TenantID == snap.TenantID {
						currentActorID = act.ID
						break
					}
				}
			}
			ui.Row(c).FillWidth().Wrap().AlignItems(ui.Center).Gap(6).Children(func() {
				for _, rx := range m.Reactions {
					rx := rx
					reacted := rx.ReactedBy(currentActorID)
					pill := ui.Row(c.Key("rx_"+rx.ReactionID)).MinHeight(32).Padding(4, 8).Radius(999).
						Background(ex.MutedBg).Border(1, t.Border).AlignItems(ui.Center).
						Role(ui.RoleButton).Label("Toggle reaction " + rx.ReactionID)
					pill.Children(func() {
						ui.Text(c, fmt.Sprintf("%s %d", rx.DisplayEmoji(), rx.Count())).FontSize(12).TextColor(t.Text).NoWrap()
					})
					if pill.Clicked() {
						ctl.toggleReactionAsync(roomID, m.ID, rx.ReactionID, reacted)
					}
				}
				if !isThread && m.Thread != nil && m.Thread.ReplyCount > 0 {
					thBtn := ui.Row(c).MinHeight(32).Padding(4, 8).Radius(999).Background(ex.InfoTint).
						AlignItems(ui.Center).Role(ui.RoleButton).Label("Open thread")
					thBtn.Children(func() {
						ui.Text(c, components.Plural(m.Thread.ReplyCount, "reply", "replies")+" ›").FontSize(12).FontWeight(600).TextColor(t.Accent).NoWrap()
					})
					if thBtn.Clicked() {
						ctl.store.Routers[state.TabRooms].Push("/rooms/" + roomID + "/thread/" + m.Thread.ThreadRoomID)
					}
				}
				miniActionButton(c, "+ React", func() {
					ctl.mu.Lock()
					mCopy := m
					ctl.reactTargetMsg = &mCopy
					ctl.reactSheetOpen = true
					ctl.mu.Unlock()
				})
				miniActionButton(c, "Pin", func() {
					go func() {
						if cl := ctl.store.Client(); cl != nil {
							_ = cl.PutMessagePin(context.Background(), roomID, m.ID)
							ctl.store.SetStatusMessage("Message pinned")
						}
					}()
				})
				miniActionButton(c, "Forward", func() {
					ctl.mu.Lock()
					mCopy := m
					ctl.forwardTargetMsg = &mCopy
					ctl.forwardSheetOpen = true
					ctl.mu.Unlock()
				})
				if !isThread {
					miniActionButton(c, "Thread", func() {
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
			Role(ui.RoleButton).Label("Zoom image " + att.Filename)
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
			ui.Text(c, fmt.Sprintf("%s · %d KB", att.MediaType, max(1, att.SizeBytes/1024))).FontSize(11).TextColor(t.TextMuted)
		})
		if strings.Contains(strings.ToLower(att.MediaType), "mail") || strings.HasSuffix(strings.ToLower(att.Filename), ".mail.md") {
			mailBtn := components.SecondaryTouchButton(c, "Open Mail", false)
			if mailBtn.Clicked() {
				ctl.openMailCanvas(att.DocumentID)
			}
		} else {
			shareBtn := components.SecondaryTouchButton(c, "Share", false)
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

	ui.Column(c).FillWidth().Background(t.Surface).Border(0.5, t.Border).Padding(8, 10, 8, 10).Gap(6).Children(func() {
		if replyMsg != nil {
			ui.Row(c).FillWidth().Padding(4, 8).Radius(8).Background(ex.MutedBg).AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
				ui.Text(c, "Replying to "+replyMsg.Author.DisplayName).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
				miniActionButton(c, "Cancel", func() {
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
					components.StatusPill(c, "Uploading...", components.ToneInfo)
				}
				for _, up := range uploads {
					up := up
					ui.Row(c.Key(up.ID)).MinHeight(32).Padding(4, 8).Radius(999).Background(ex.InfoTint).Gap(6).AlignItems(ui.Center).Children(func() {
						ui.Text(c, up.Filename).FontSize(11).TextColor(t.Text).MaxLines(1)
						rmBtn := ui.Row(c).Size(24, 24).AlignItems(ui.Center).Justify(ui.Center).Role(ui.RoleButton).Label("Remove " + up.Filename)
						rmBtn.Children(func() { ui.Text(c, "×").FontSize(14).TextColor(t.Danger) })
						if rmBtn.Clicked() {
							ctl.removeUploadAsync(roomID, up.ID)
						}
					})
				}
			})
		}

		// Toolbar row: Attach Photo / Attach File / @Mention / /Skill
		ui.Row(c).FillWidth().Wrap().Gap(6).AlignItems(ui.Center).Children(func() {
			miniActionButton(c, "Photo", func() { ctl.pickPhotoAndUpload(roomID) })
			miniActionButton(c, "File", func() { ctl.pickFileAndUpload(roomID) })
			miniActionButton(c, "@Mention", func() {
				ctl.mu.Lock()
				ctl.mentionSheetOpen = true
				ctl.mu.Unlock()
			})
			miniActionButton(c, "/Skill", func() {
				ctl.mu.Lock()
				ctl.skillSheetOpen = true
				ctl.mu.Unlock()
			})
		})

		// Multiline IME-safe TextArea + >=44x44 Send button
		ui.Row(c).FillWidth().AlignItems(ui.End).Gap(8).Children(func() {
			var area ui.Element
			area = ui.TextArea(c.Key("draft_"+roomID), &draft).Grow(1).Basis(0).MinHeight(44).MaxHeight(120).
				Placeholder("Message room... (@ to mention)").Label("Message composer").Multiline(true)
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
			sendBtn := components.PrimaryTouchButton(c, func() string {
				if sending {
					return "..."
				}
				return "Send"
			}(), !canSend)
			sendBtn.MinWidth(64)
			if sendBtn.Clicked() {
				sendNow(draft)
			}
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
		Label:   "Image Viewer",
	}, func() {
		ctl.mu.Lock()
		u := ctl.zoomURL
		title := ctl.zoomTitle
		ctl.mu.Unlock()
		ui.Column(c).Fill().Padding(8, 12, 16, 12).Gap(8).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
				ui.Text(c, title).FontSize(15).FontWeight(600).TextColor(t.Text).MaxLines(1).Grow(1).Basis(0)
				if components.SecondaryTouchButton(c, "Close", false).Clicked() {
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
		Label:   "HTML Fragment Preview",
	}, func() {
		ctl.mu.Lock()
		title := ctl.htmlTitle
		html := ctl.htmlContent
		wv := ctl.htmlWebView
		ctl.mu.Unlock()
		ui.Column(c).Fill().Padding(10, 14, 16, 14).Gap(8).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
				ui.Text(c, title).FontSize(16).Bold().TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
				if components.SecondaryTouchButton(c, "Close", false).Clicked() {
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
			ctl.mailError = "Not connected"
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
		Label:   "Mail Canvas",
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
	mobile.Sheet(c, &ctl.mentionSheetOpen, mobile.SheetOptions{Detents: []float32{0.5}, Label: "Mention Member or Agent"}, func() {
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 20, 16).Gap(8).Children(func() {
				ui.Text(c, "Insert @Mention").FontSize(16).Bold().TextColor(t.Text)
				for _, act := range snap.Actors {
					act := act
					row := ui.Row(c.Key("m_"+act.ID)).FillWidth().MinHeight(44).Padding(8, 10).Gap(8).
						Radius(10).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
						Role(ui.RoleButton).Label("Mention " + act.DisplayName)
					row.Children(func() {
						components.AvatarBadge(c, act.DisplayName, 28)
						ui.Text(c, "@"+act.DisplayName).FontSize(14).TextColor(t.Text).Grow(1).Basis(0)
						components.StatusPill(c, act.Kind, components.ToneNeutral)
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
	mobile.Sheet(c, &ctl.skillSheetOpen, mobile.SheetOptions{Detents: []float32{0.5}, Label: "Insert Skill"}, func() {
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 20, 16).Gap(8).Children(func() {
				ui.Text(c, "Insert /Skill").FontSize(16).Bold().TextColor(t.Text)
				if len(snap.SkillManifests) == 0 {
					ui.Text(c, "No skill manifests available.").FontSize(13).TextColor(t.TextMuted)
				}
				for _, sk := range snap.SkillManifests {
					sk := sk
					row := ui.Row(c.Key("sk_"+sk.SkillID)).FillWidth().MinHeight(48).Padding(8, 10).Gap(6).
						Radius(10).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
						Role(ui.RoleButton).Label("Insert skill " + sk.Name)
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
			Label: q.label + " " + q.id,
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
	mobile.ActionSheet(c, &ctl.reactSheetOpen, mobile.ActionSheetOptions{Title: "Add Reaction", Cancel: "Cancel"}, actions...)
}

func (ctl *Controller) viewForwardSheet(c *ui.Context, snap state.Snapshot, fromRoomID string) {
	actions := make([]mobile.Action, 0, len(snap.Rooms))
	for _, rm := range snap.Rooms {
		if rm.ID == fromRoomID || rm.Kind == "thread" {
			continue
		}
		rm := rm
		actions = append(actions, mobile.Action{
			Label: "Forward to " + rm.Name,
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
						ctl.store.SetStatusMessage("Forwarded to " + rm.Name)
					}
				}()
			},
		})
	}
	mobile.ActionSheet(c, &ctl.forwardSheetOpen, mobile.ActionSheetOptions{Title: "Forward Message", Cancel: "Cancel"}, actions...)
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
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Title: "Attach file"})
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
		ctl.store.SetTransientError("Cannot read attachment: " + err.Error())
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
		ctl.store.SetTransientError("Attachment upload failed: " + err.Error())
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
			ctl.store.SetTransientError("Download failed: " + err.Error())
			return
		}
		tmpPath := filepath.Join(os.TempDir(), filepath.Base(att.Filename))
		if writeErr := os.WriteFile(tmpPath, data, 0o600); writeErr == nil {
			_ = mygo.Share(mygo.ShareOptions{Files: []string{tmpPath}})
		}
	}()
}

func miniActionButton(c *ui.Context, label string, onTap func()) {
	t := c.Theme()
	btn := ui.Row(c).MinHeight(34).Padding(4, 9).Radius(8).Background(theme.Extra(t).MutedBg).
		AlignItems(ui.Center).Justify(ui.Center).Role(ui.RoleButton).Label(label)
	btn.Children(func() {
		ui.Text(c, label).FontSize(12).FontWeight(500).TextColor(t.TextMuted).NoWrap()
	})
	if btn.Clicked() && onTap != nil {
		onTap()
	}
}

func formatElapsed(start time.Time) string {
	if start.IsZero() {
		return "0s"
	}
	d := time.Since(start)
	if d < 0 {
		d = 0
	}
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	return fmt.Sprintf("%dm %ds", int(d.Minutes()), int(d.Seconds())%60)
}
