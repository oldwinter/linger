package library

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/imagepicker"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (s *Screen) viewDocsSegment(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	myTree := s.myTree
	sharedTree := s.sharedTree
	allDocs := append([]api.Document(nil), s.documents...)
	roomDocs := append([]api.Document(nil), s.roomDocs...)
	rooms := append([]api.RoomListItem(nil), s.rooms...)
	if s.docRoomID == "" && len(rooms) > 0 {
		s.docRoomID = rooms[0].ID
	}
	selectedDocRoomID := s.docRoomID
	s.mu.Unlock()

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SegmentDocs]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
			// Tree switcher (My Docs / Shared / Room Docs)
			components.SegmentedControl(c, &s.docTreeTab, "My Docs", "Shared", "Room Docs")

			// Action bar: New Note, Upload File, Upload Photo
			ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
				newBtn := components.PrimaryTouchButton(c, "+ Note", false)
				if newBtn.Clicked() {
					s.newNoteTitle = ""
					s.newNoteErr = ""
					s.newNoteSheetOpen = true
				}
				upFileBtn := components.SecondaryTouchButton(c, "Upload File", s.uploadBusy)
				if upFileBtn.Clicked() {
					s.triggerUploadFile()
				}
				upPhotoBtn := components.SecondaryTouchButton(c, "Upload Photo", s.uploadBusy)
				if upPhotoBtn.Clicked() {
					s.triggerUploadPhoto()
				}
			})

			if s.uploadErr != "" {
				components.StatusBanner(c, components.ToneDanger, s.uploadErr, "Dismiss", func() {
					s.uploadErr = ""
				})
			}

			if s.docTreeTab == 2 && len(rooms) > 0 {
				ui.ScrollHorizontal(c).FillWidth().Children(func() {
					ui.Row(c).Gap(6).Children(func() {
						for _, rm := range rooms {
							rm := rm
							on := selectedDocRoomID == rm.ID
							bg := theme.Extra(t).MutedBg
							fg := t.TextMuted
							if on {
								bg = t.Accent
								fg = t.AccentText
							}
							chip := ui.Row(c.Key(rm.ID)).MinHeight(34).PaddingX(12).Radius(999).Background(bg).
								AlignItems(ui.Center).Shrink(0).Role(ui.RoleTab).Label("Room docs " + rm.Name).Checked(on)
							chip.Children(func() {
								ui.Text(c, rm.Name).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
							})
							if chip.Clicked() {
								s.mu.Lock()
								s.docRoomID = rm.ID
								s.mu.Unlock()
								selectedDocRoomID = rm.ID
								s.fetchRoomDocsAsync(rm.ID)
							}
						}
					})
				})
			}

			if s.docTreeTab < 2 && s.docFolderID != "" {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
					backBtn := components.SecondaryTouchButton(c, "← Up Folder", false)
					if backBtn.Clicked() {
						s.popDocFolder()
					}
					if len(s.docFolderTrail) > 0 {
						ui.Text(c, strings.Join(s.docFolderTrail, " / ")).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
					}
				})
			}

			switch s.docTreeTab {
			case 0:
				s.renderTreeNodes(c, myTree.Items, allDocs)
			case 1:
				s.renderTreeNodes(c, sharedTree.Items, nil)
			case 2:
				s.renderDocumentSlice(c, roomDocs, "No documents in this Room yet.")
			}
		})
	})
}

func (s *Screen) renderTreeNodes(c *ui.Context, nodes []api.DocumentTreeNode, fallbackDocs []api.Document) {
	t := c.Theme()
	var folders []api.DocumentTreeNode
	var docs []api.Document

	for _, n := range nodes {
		parent := ""
		if n.ParentID != nil {
			parent = *n.ParentID
		}
		if parent != s.docFolderID {
			continue
		}
		if n.NodeKind == "folder" {
			folders = append(folders, n)
		} else if n.Document != nil {
			docs = append(docs, *n.Document)
		}
	}

	// Fall back to flat library documents when no folder tree was returned (e.g. offline cache).
	if len(nodes) == 0 && len(fallbackDocs) > 0 && s.docFolderID == "" {
		docs = fallbackDocs
	}

	if len(folders) == 0 && len(docs) == 0 {
		components.EmptyState(c, theme.IconLibrary, "No Documents",
			"Create a note or upload a file to see it here.",
			"Create Note", func() {
				s.newNoteSheetOpen = true
			})
		return
	}

	for _, f := range folders {
		f := f
		row := ui.Row(c.Key("folder:" + f.ID)).FillWidth().MinHeight(52).Padding(10, 12).Gap(10).
			Radius(12).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
			Role(ui.RoleButton).Label("Folder " + f.Name)
		row.Children(func() {
			theme.IconBox(c, 20, t.Accent, theme.IconLibrary)
			ui.Text(c, f.Name).FontSize(14).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
			ui.Text(c, "›").FontSize(18).TextColor(t.TextMuted)
		})
		if row.Clicked() {
			s.docFolderID = f.ID
			s.docFolderTrail = append(s.docFolderTrail, f.Name)
		}
	}

	s.renderDocumentSlice(c, docs, "")
}

func (s *Screen) popDocFolder() {
	s.docFolderID = ""
	if len(s.docFolderTrail) > 0 {
		s.docFolderTrail = s.docFolderTrail[:len(s.docFolderTrail)-1]
	}
	s.mu.Lock()
	items := append([]api.DocumentTreeNode(nil), s.myTree.Items...)
	if s.docTreeTab == 1 {
		items = append([]api.DocumentTreeNode(nil), s.sharedTree.Items...)
	}
	s.mu.Unlock()
	if len(s.docFolderTrail) > 0 {
		wantName := s.docFolderTrail[len(s.docFolderTrail)-1]
		for _, n := range items {
			if n.NodeKind == "folder" && n.Name == wantName {
				s.docFolderID = n.ID
				break
			}
		}
	}
}

func (s *Screen) renderDocumentSlice(c *ui.Context, docs []api.Document, emptyMsg string) {
	t := c.Theme()
	if len(docs) == 0 {
		if emptyMsg != "" {
			components.EmptyState(c, theme.IconLibrary, "No Documents", emptyMsg, "", nil)
		}
		return
	}
	for _, doc := range docs {
		doc := doc
		row := ui.Row(c.Key("doc:" + doc.ID)).FillWidth().MinHeight(56).Padding(10, 12).Gap(10).
			Radius(12).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
			Role(ui.RoleButton).Label("Document " + doc.Title)
		row.Children(func() {
			components.AvatarBadge(c, doc.Title, 34)
			ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
				ui.Text(c, doc.Title).FontSize(14).FontWeight(600).TextColor(t.Text).MaxLines(1)
				ui.Text(c, doc.Format+" · "+doc.UpdatedAt.UTC().Format("Jan 2 15:04")).FontSize(11).TextColor(t.TextMuted).MaxLines(1)
			})
			components.StatusPill(c, doc.RepresentationFormat, components.ToneNeutral)
		})
		if row.Clicked() {
			s.openDocument(doc)
		}
	}
}

func (s *Screen) fetchRoomDocsAsync(roomID string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		if dp, err := client.ListRoomDocuments(context.Background(), roomID, 50, ""); err == nil {
			s.mu.Lock()
			s.roomDocs = dp.Items
			s.mu.Unlock()
			s.notify()
		}
	}()
}

// OpenDocumentForTest opens the Document Reader directly for docID.
func (s *Screen) OpenDocumentForTest(docID string) {
	s.enqueueUI(func() {
		s.openDocumentByID(docID)
	})
}

func (s *Screen) openDocumentByID(docID string) {
	s.mu.Lock()
	var found *api.Document
	for i := range s.documents {
		if s.documents[i].ID == docID {
			cp := s.documents[i]
			found = &cp
			break
		}
	}
	s.mu.Unlock()
	if found != nil {
		s.openDocument(*found)
		return
	}
	s.openDocument(api.Document{ID: docID, Title: "Document"})
}

func (s *Screen) openDocument(doc api.Document) {
	cp := doc
	s.readerDoc = &cp
	s.readerOpen = true
	s.readerBusy = true
	s.commentsSheetOpen = false
	s.versionsSheetOpen = false
	s.linkShareSheetOpen = false
	s.renameSheetOpen = false
	s.deleteConfirmOpen = false
	s.closeHTMLPreview()
	s.readerErr = ""
	s.readerNotice = ""
	s.readerBytes = nil
	s.readerText = ""
	s.readerImgSrc = nil
	s.readerCodeState = nil
	s.readerVersions = nil
	s.readerHistory = nil
	s.readerThreads = nil
	s.readerLinkShare = nil
	s.readerImgZoom.Reset()

	client := s.client()
	if client == nil {
		s.readerBusy = false
		s.readerErr = "Offline: document body cannot be downloaded without a host connection."
		return
	}

	go func() {
		ctx := context.Background()
		latest, gErr := client.GetDocument(ctx, doc.ID)
		data, ct, dErr := client.DownloadLatestDocument(ctx, doc.ID)
		vers, _ := client.ListDocumentVersions(ctx, doc.ID)
		hist, _ := client.ListDocumentHistory(ctx, doc.ID, 20)
		threads, _ := client.ListDocumentCommentThreads(ctx, doc.ID)
		ls, lsErr := client.GetDocumentLinkShare(ctx, doc.ID)

		var imgSrc ui.ImageSource
		var codeSt *editor.State
		var textBody string

		resolvedDoc := doc
		if gErr == nil {
			resolvedDoc = latest
		}
		if dErr == nil {
			if isImageDoc(resolvedDoc, ct) {
				if decoded, decErr := ui.DecodeImage(data); decErr == nil {
					imgSrc = decoded
				}
			} else if isCodeDoc(resolvedDoc, ct) {
				textBody = string(data)
				buf := editor.NewBuffer(textBody)
				if lang := editor.LanguageFor(resolvedDoc.Title); lang != nil {
					buf.SetLanguage(lang)
				}
				codeSt = &editor.State{
					Buffer:     buf,
					ReadOnly:   true,
					FitContent: true,
					SoftWrap:   true,
				}
			} else if utf8.Valid(data) {
				textBody = string(data)
			}
		}

		s.enqueueUI(func() {
			s.readerBusy = false
			if gErr == nil {
				d := latest
				s.readerDoc = &d
			}
			if dErr != nil {
				s.readerErr = dErr.Error()
			} else {
				s.readerErr = ""
				s.readerBytes = data
				s.readerContentType = ct
				s.readerText = textBody
				s.readerImgSrc = imgSrc
				s.readerCodeState = codeSt
			}
			s.readerVersions = vers
			s.readerHistory = hist.Items
			s.readerThreads = threads
			if lsErr == nil {
				lsCopy := ls
				s.readerLinkShare = &lsCopy
			}
		})
	}()
}

func (s *Screen) viewDocumentReaderSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.readerOpen, mobile.SheetOptions{
		Detents: []float32{0.88, 0.98},
		Label:   "Document Reader",
	}, func() {
		doc := s.readerDoc
		if doc == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, doc.Title).FontSize(18).Bold().TextColor(t.Text)
						ui.Text(c, doc.Format+" · "+doc.RepresentationFormat).FontSize(12).TextColor(t.TextMuted)
					})
					components.StatusPill(c, doc.Status, components.ToneInfo)
				})

				if s.readerErr != "" {
					components.StatusBanner(c, components.ToneDanger, s.readerErr, "Retry", func() {
						s.openDocument(*doc)
					})
				}
				if s.readerNotice != "" {
					components.StatusBanner(c, components.ToneSuccess, s.readerNotice, "OK", func() {
						s.readerNotice = ""
					})
				}

				// Reader toolbar
				ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
					vBtn := components.SecondaryTouchButton(c, fmt.Sprintf("Versions (%d)", len(s.readerVersions)+len(s.readerHistory)), false)
					if vBtn.Clicked() {
						s.versionsSheetOpen = true
					}
					cBtn := components.SecondaryTouchButton(c, fmt.Sprintf("Comments (%d)", len(s.readerThreads)), false)
					if cBtn.Clicked() {
						s.commentsSheetOpen = true
					}
					sBtn := components.SecondaryTouchButton(c, "Share Link", false)
					if sBtn.Clicked() {
						s.linkShareSheetOpen = true
					}
					dlBtn := components.SecondaryTouchButton(c, "Save Copy", len(s.readerBytes) == 0)
					if dlBtn.Clicked() {
						s.saveReaderCopy(*doc)
					}
					renBtn := components.SecondaryTouchButton(c, "Rename", false)
					if renBtn.Clicked() {
						s.renameDraft = doc.Title
						s.renameSheetOpen = true
					}
					if isHTMLDoc(*doc, s.readerContentType) && len(s.readerVersions) > 0 {
						htmlBtn := components.PrimaryTouchButton(c, "Open HTML Preview", false)
						if htmlBtn.Clicked() {
							s.openHTMLPreview(s.readerVersions[0].ID)
						}
					}
					delBtn := components.DangerTouchButton(c, "Delete", false)
					if delBtn.Clicked() {
						s.deleteConfirmOpen = true
					}
				})

				ui.Divider(c)

				if s.readerBusy {
					components.LoadingSkeleton(c, 3)
					return
				}

				// Native content dispatch
				switch {
				case s.readerImgSrc != nil:
					mobile.Zoomable(c, &s.readerImgZoom, mobile.ZoomOptions{Min: 1, Max: 4, DoubleTap: 2}, func() {
						ui.Image(c, s.readerImgSrc).FillWidth().Height(260)
					}).FillWidth().Height(260)
				case s.readerCodeState != nil:
					editor.View(c, s.readerCodeState).FillWidth().MinHeight(200)
				case s.readerText != "":
					markdown.View(c, s.readerText, &s.mdOpts).FillWidth()
				case len(s.readerBytes) > 0:
					ui.Text(c, fmt.Sprintf("Binary file (%d bytes). Use Save Copy to export.", len(s.readerBytes))).
						FontSize(13).TextColor(t.TextMuted)
				}
			})
		})
	})
}

func canonicalOriginTuple(u *url.URL) (string, string, bool) {
	if u == nil || u.Scheme == "" || u.Host == "" {
		return "", "", false
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return "", "", false
	}
	port := u.Port()
	if port == "" {
		switch scheme {
		case "https":
			port = "443"
		case "http":
			port = "80"
		}
	}
	return scheme, host + ":" + port, true
}

// validateDocPreviewURL ensures a signed document preview URL uses an allowed
// scheme and matches the connected Linger host origin (blocking file://,
// javascript:, data:, linger://, and arbitrary external origins).
func validateDocPreviewURL(previewURL, hostBaseURL string, allowPlainHTTP bool) error {
	raw := strings.TrimSpace(previewURL)
	if raw == "" {
		return errors.New("preview URL is empty")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid preview URL: %w", err)
	}
	scheme := strings.ToLower(u.Scheme)
	switch scheme {
	case "https":
	case "http":
		if !allowPlainHTTP {
			return errors.New("plain HTTP document preview is disallowed")
		}
	default:
		return fmt.Errorf("disallowed preview URL scheme %q", u.Scheme)
	}
	s1, h1, ok1 := canonicalOriginTuple(u)
	if !ok1 {
		return errors.New("preview URL is missing a valid host")
	}
	if strings.TrimSpace(hostBaseURL) != "" {
		base, bErr := url.Parse(strings.TrimSpace(hostBaseURL))
		if bErr != nil {
			return errors.New("connected host origin is invalid")
		}
		s2, h2, ok2 := canonicalOriginTuple(base)
		if !ok2 || s1 != s2 || h1 != h2 {
			return errors.New("preview URL origin does not match connected host")
		}
	}
	return nil
}

func allowDocPreviewNavigation(navURL, initialURL, hostBaseURL string, allowPlainHTTP bool) bool {
	u := strings.TrimSpace(navURL)
	if strings.EqualFold(u, "about:blank") {
		return true
	}
	if err := validateDocPreviewURL(u, hostBaseURL, allowPlainHTTP); err != nil {
		return false
	}
	if initialURL != "" {
		initParsed, err1 := url.Parse(initialURL)
		navParsed, err2 := url.Parse(u)
		if err1 != nil || err2 != nil {
			return false
		}
		s1, h1, ok1 := canonicalOriginTuple(initParsed)
		s2, h2, ok2 := canonicalOriginTuple(navParsed)
		return ok1 && ok2 && s1 == s2 && h1 == h2
	}
	return true
}

func (s *Screen) closeHTMLPreview() {
	s.htmlPreviewOpen = false
	s.mu.Lock()
	s.htmlPreviewGen++
	s.mu.Unlock()
	s.destroyPreviewWebView()
}

func (s *Screen) openHTMLPreview(versionID string) {
	client := s.client()
	if client == nil {
		return
	}
	hostBase := client.BaseURL()
	allowPlain := client.AllowPlainHTTP()
	s.htmlPreviewOpen = true
	s.htmlPreviewURL = ""
	s.htmlPreviewErr = ""
	s.mu.Lock()
	s.htmlPreviewGen++
	gen := s.htmlPreviewGen
	s.mu.Unlock()
	go func() {
		sess, err := client.CreateDocumentPreviewSession(context.Background(), versionID)
		s.enqueueUI(func() {
			s.mu.Lock()
			stale := s.closed || s.htmlPreviewGen != gen
			win := s.deps.Window
			createWV := s.previewWebViewFactory
			s.mu.Unlock()
			if !s.htmlPreviewOpen || stale {
				return
			}
			if err != nil {
				s.htmlPreviewErr = err.Error()
				return
			}
			resolvedURL := client.ResolveEndpointURL(sess.PreviewURL)
			if vErr := validateDocPreviewURL(resolvedURL, hostBase, allowPlain); vErr != nil {
				s.htmlPreviewErr = "Blocked unsafe preview URL: " + vErr.Error()
				return
			}
			s.htmlPreviewURL = resolvedURL
			if createWV == nil && win != nil {
				createWV = win.NewWebView
			}
			if createWV != nil {
				s.destroyPreviewWebView()
				if wv, wErr := createWV(mygo.WebViewOptions{
					URL: resolvedURL,
					Page: mygo.PageOptions{
						Untrusted: true,
					},
				}); wErr == nil {
					if wv != nil {
						wv.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
							if !allowDocPreviewNavigation(e.URL, resolvedURL, hostBase, allowPlain) {
								e.PreventDefault()
							}
						})
					}
					s.htmlWebView = wv
				} else {
					s.htmlPreviewErr = wErr.Error()
				}
			}
		})
	}()
}

func (s *Screen) destroyPreviewWebView() {
	if s.htmlWebView != nil {
		s.htmlWebView.Destroy()
		s.htmlWebView = nil
	}
}

func (s *Screen) viewHTMLPreviewSheet(c *ui.Context) {
	t := c.Theme()
	wasOpen := s.htmlPreviewOpen
	mobile.Sheet(c, &s.htmlPreviewOpen, mobile.SheetOptions{
		Detents: []float32{0.92, 0.98},
		Label:   "HTML Preview",
	}, func() {
		ui.Column(c).Fill().Padding(12, 16, 20, 16).Gap(10).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
				ui.Text(c, "Sandboxed HTML Preview").FontSize(16).Bold().TextColor(t.Text)
				closeBtn := components.SecondaryTouchButton(c, "Close", false)
				if closeBtn.Clicked() {
					s.closeHTMLPreview()
				}
			})
			if s.htmlPreviewErr != "" {
				components.StatusBanner(c, components.ToneDanger, s.htmlPreviewErr, "", nil)
			}
			if s.htmlPreviewURL != "" {
				ui.Text(c, "Signed preview URL: "+s.htmlPreviewURL).FontSize(11).TextColor(t.TextMuted).MaxLines(2)
			}
			if s.htmlWebView != nil {
				ui.WebView(c, s.htmlWebView).FillWidth().Grow(1).Basis(0)
			} else if s.htmlPreviewURL != "" && s.htmlPreviewErr == "" {
				components.StatusBanner(c, components.ToneInfo,
					"WebView preview requires a native window; signed preview URL is ready above.", "", nil)
			}
		})
	})
	if wasOpen && !s.htmlPreviewOpen {
		s.closeHTMLPreview()
	}
}

func (s *Screen) viewVersionsSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.versionsSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.68, 0.90},
		Label:   "Document Versions and History",
	}, func() {
		doc := s.readerDoc
		if doc == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, "Versions & History").FontSize(18).Bold().TextColor(t.Text)
				for _, v := range s.readerVersions {
					v := v
					ui.Row(c.Key(v.ID)).FillWidth().Padding(10, 10).Radius(10).Background(t.Surface).Border(1, t.Border).
						AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, fmt.Sprintf("v%d · %s", v.VersionNumber, v.Filename)).FontSize(13).FontWeight(600).TextColor(t.Text)
							ui.Text(c, fmt.Sprintf("%s · %d bytes", v.Source, v.SizeBytes)).FontSize(11).TextColor(t.TextMuted)
						})
						dl := components.SecondaryTouchButton(c, "Load", false)
						if dl.Clicked() {
							s.loadVersionContent(v.ID, v.Filename, v.MediaType)
						}
					})
				}
				if len(s.readerHistory) > 0 {
					ui.Text(c, "Edit History").FontSize(14).FontWeight(600).TextColor(t.Text)
					for _, h := range s.readerHistory {
						h := h
						ui.Row(c.Key(h.ID)).FillWidth().Padding(10, 10).Radius(10).Background(t.Surface).Border(1, t.Border).
							AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
							ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
								ui.Text(c, fmt.Sprintf("Seq #%d · %s", h.PersistedSeq, h.Trigger)).FontSize(13).FontWeight(600).TextColor(t.Text)
								ui.Text(c, h.CreatedBy.DisplayName).FontSize(11).TextColor(t.TextMuted)
							})
							rst := components.SecondaryTouchButton(c, "Restore", false)
							if rst.Clicked() {
								s.restoreHistoryAsync(doc.ID, h.ID)
							}
						})
					}
				}
			})
		})
	})
}

func (s *Screen) loadVersionContent(verID, filename, mediaType string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		data, ct, err := client.DownloadDocumentVersion(context.Background(), verID)
		s.enqueueUI(func() {
			if err != nil {
				s.readerErr = err.Error()
				return
			}
			s.readerBytes = data
			s.readerContentType = ct
			if utf8.Valid(data) {
				s.readerText = string(data)
			}
			s.versionsSheetOpen = false
			s.readerNotice = "Loaded " + filename
			_ = mediaType
		})
	}()
}

func (s *Screen) restoreHistoryAsync(docID, historyID string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		err := client.RestoreDocumentHistoryEntry(context.Background(), docID, historyID)
		s.enqueueUI(func() {
			if err != nil {
				s.readerErr = err.Error()
				return
			}
			s.versionsSheetOpen = false
			if s.readerDoc != nil {
				s.openDocument(*s.readerDoc)
			}
			s.readerNotice = "Restored history checkpoint"
		})
	}()
}

func (s *Screen) viewDocCommentsSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.commentsSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.75, 0.94},
		Label:   "Document Comments",
	}, func() {
		doc := s.readerDoc
		if doc == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, "Comment Threads").FontSize(18).Bold().TextColor(t.Text)

				for _, th := range s.readerThreads {
					th := th
					ui.Column(c.Key(th.ID)).FillWidth().Padding(10, 10).Radius(10).Background(theme.Extra(t).MutedBg).Gap(6).Children(func() {
						ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
							status := "Open"
							tone := components.ToneInfo
							if th.Resolved {
								status = "Resolved"
								tone = components.ToneSuccess
							}
							components.StatusPill(c, status, tone)
							btnLbl := "Resolve"
							if th.Resolved {
								btnLbl = "Reopen"
							}
							resBtn := components.SecondaryTouchButton(c, btnLbl, false)
							resBtn.MinHeight(32).Padding(4, 10)
							if resBtn.Clicked() {
								s.resolveDocThreadAsync(th.ID, !th.Resolved)
							}
						})
						for _, cm := range th.Comments {
							ui.Text(c, cm.Author.DisplayName+": "+cm.Body).FontSize(13).TextColor(t.Text)
						}
						if s.replyThreadID == th.ID {
							ui.TextArea(c, &s.replyInput).FillWidth().MinHeight(56).Placeholder("Reply...").Label("Reply to Thread")
							ui.Row(c).FillWidth().Gap(6).Children(func() {
								sendR := components.PrimaryTouchButton(c, "Reply", strings.TrimSpace(s.replyInput) == "")
								sendR.Grow(1).Basis(0)
								if sendR.Clicked() {
									s.replyDocThreadAsync(th.ID, s.replyInput)
								}
								cancR := components.SecondaryTouchButton(c, "Cancel", false)
								if cancR.Clicked() {
									s.replyThreadID = ""
								}
							})
						} else {
							rb := components.SecondaryTouchButton(c, "Reply", false)
							rb.MinHeight(32)
							if rb.Clicked() {
								s.replyThreadID = th.ID
								s.replyInput = ""
							}
						}
					})
				}

				ta := ui.TextArea(c, &s.commentInput).FillWidth().MinHeight(68).
					Placeholder("Start a new comment thread...").Label("New Document Comment")
				ta.OnTextKey(func(k ui.TextKey) bool {
					if k.Key != ui.KeyEnter || k.Mods != 0 {
						return false
					}
					txt := strings.TrimSpace(k.Text())
					if txt == "" {
						return true
					}
					k.SetText("")
					s.commentInput = ""
					s.createDocThreadAsync(doc.ID, txt)
					return true
				})
				addBtn := components.PrimaryTouchButton(c, "Post Comment", strings.TrimSpace(s.commentInput) == "")
				addBtn.FillWidth()
				if addBtn.Clicked() {
					s.createDocThreadAsync(doc.ID, s.commentInput)
				}
			})
		})
	})
}

func (s *Screen) createDocThreadAsync(docID, body string) {
	client := s.client()
	body = strings.TrimSpace(body)
	if client == nil || body == "" {
		return
	}
	go func() {
		th, err := client.CreateDocumentCommentThread(context.Background(), docID, body)
		s.enqueueUI(func() {
			if err != nil {
				s.readerErr = err.Error()
				return
			}
			s.commentInput = ""
			s.readerThreads = append(s.readerThreads, th)
		})
	}()
}

func (s *Screen) replyDocThreadAsync(threadID, body string) {
	client := s.client()
	body = strings.TrimSpace(body)
	if client == nil || body == "" {
		return
	}
	go func() {
		cm, err := client.ReplyDocumentCommentThread(context.Background(), threadID, body)
		s.enqueueUI(func() {
			if err != nil {
				s.readerErr = err.Error()
				return
			}
			s.replyThreadID = ""
			s.replyInput = ""
			for i := range s.readerThreads {
				if s.readerThreads[i].ID == threadID {
					s.readerThreads[i].Comments = append(s.readerThreads[i].Comments, cm)
				}
			}
		})
	}()
}

func (s *Screen) resolveDocThreadAsync(threadID string, resolved bool) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		updated, err := client.SetDocumentCommentThreadResolved(context.Background(), threadID, resolved)
		s.enqueueUI(func() {
			if err != nil {
				s.readerErr = err.Error()
				return
			}
			for i := range s.readerThreads {
				if s.readerThreads[i].ID == updated.ID {
					s.readerThreads[i] = updated
				}
			}
		})
	}()
}

func (s *Screen) viewLinkShareSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.linkShareSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.58, 0.82},
		Label:   "Link Share",
	}, func() {
		doc := s.readerDoc
		if doc == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, "Link Sharing").FontSize(18).Bold().TextColor(t.Text)
				ls := s.readerLinkShare
				var ver int64 = 1
				status := "inactive"
				role := "viewer"
				shareURL := ""
				if ls != nil {
					ver = ls.Version
					status = ls.Status
					role = ls.Role
					if ls.URL != nil {
						shareURL = *ls.URL
					}
				}
				ui.Row(c).Gap(6).Children(func() {
					components.StatusPill(c, "Status: "+status, components.ToneInfo)
					components.StatusPill(c, "Role: "+role, components.ToneNeutral)
				})
				if shareURL != "" {
					ui.Text(c, shareURL).FontSize(12).TextColor(t.TextMuted)
				}
				ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
					viewBtn := components.PrimaryTouchButton(c, "Enable Viewer Link", false)
					if viewBtn.Clicked() {
						s.updateLinkShareAsync(doc.ID, "viewer", ver, true)
					}
					editBtn := components.SecondaryTouchButton(c, "Enable Editor Link", false)
					if editBtn.Clicked() {
						s.updateLinkShareAsync(doc.ID, "editor", ver, true)
					}
					if shareURL != "" {
						shBtn := components.SecondaryTouchButton(c, "Share URL", false)
						if shBtn.Clicked() {
							go func() {
								err := s.share(mygo.ShareOptions{Text: doc.Title, URL: shareURL})
								if err != nil && !errors.Is(err, errors.ErrUnsupported) {
									s.enqueueUI(func() { s.readerErr = err.Error() })
								}
							}()
						}
					}
					if status == "active" {
						revBtn := components.DangerTouchButton(c, "Revoke", false)
						if revBtn.Clicked() {
							s.revokeLinkShareAsync(doc.ID, ver)
						}
					}
				})
			})
		})
	})
}

func (s *Screen) updateLinkShareAsync(docID, role string, ver int64, reset bool) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		ls, err := client.SetDocumentLinkShare(context.Background(), docID, role, ver, reset)
		s.enqueueUI(func() {
			if err != nil {
				s.readerErr = err.Error()
				return
			}
			cp := ls
			s.readerLinkShare = &cp
			s.readerNotice = "Link share updated"
		})
	}()
}

func (s *Screen) revokeLinkShareAsync(docID string, ver int64) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		if err := client.RevokeDocumentLinkShare(context.Background(), docID, ver); err != nil {
			s.enqueueUI(func() { s.readerErr = err.Error() })
			return
		}
		s.enqueueUI(func() {
			if s.readerLinkShare != nil {
				s.readerLinkShare.Status = "revoked"
				s.readerLinkShare.URL = nil
				s.readerLinkShare.Version++
			}
			s.readerNotice = "Link share revoked"
		})
	}()
}

func (s *Screen) saveReaderCopy(doc api.Document) {
	data := s.readerBytes
	if len(data) == 0 {
		return
	}
	go func() {
		tmpDir, err := os.MkdirTemp("", "linger-doc-*")
		if err != nil {
			s.enqueueUI(func() { s.readerErr = err.Error() })
			return
		}
		defer os.RemoveAll(tmpDir)
		name := filepath.Base(doc.Title)
		if name == "" || name == "." {
			name = doc.ID + ".txt"
		}
		tmpFile := filepath.Join(tmpDir, name)
		if err := os.WriteFile(tmpFile, data, 0o600); err != nil {
			s.enqueueUI(func() { s.readerErr = err.Error() })
			return
		}
		outPath, err := s.saveCopy(tmpFile, name)
		s.enqueueUI(func() {
			if err != nil {
				if errors.Is(err, errors.ErrUnsupported) {
					s.readerNotice = "Save Copy is unavailable in headless preview."
				} else if !errors.Is(err, mygo.ErrCanceled) {
					s.readerErr = err.Error()
				}
				return
			}
			s.readerNotice = "Saved copy to " + outPath
		})
	}()
}

func (s *Screen) viewRenameDocSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.renameSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.45},
		Label:   "Rename Document",
	}, func() {
		doc := s.readerDoc
		if doc == nil {
			return
		}
		ui.Column(c).FillWidth().Padding(14, 16, 24, 16).Gap(12).Children(func() {
			ui.Text(c, "Rename Document").FontSize(17).Bold().TextColor(t.Text)
			components.FormField(c, "Title", "Document title", &s.renameDraft, false)
			saveBtn := components.PrimaryTouchButton(c, "Save Title", strings.TrimSpace(s.renameDraft) == "")
			saveBtn.FillWidth()
			if saveBtn.Clicked() {
				s.renameDocAsync(doc.ID, s.renameDraft)
			}
		})
	})
}

func (s *Screen) renameDocAsync(docID, title string) {
	client := s.client()
	title = strings.TrimSpace(title)
	if client == nil || title == "" {
		return
	}
	go func() {
		updated, err := client.UpdateDocumentMetadata(context.Background(), docID, title)
		s.enqueueUI(func() {
			if err != nil {
				s.readerErr = err.Error()
				return
			}
			cp := updated
			s.readerDoc = &cp
			s.renameSheetOpen = false
			s.replaceDocInList(updated)
			s.readerNotice = "Document renamed"
		})
	}()
}

func (s *Screen) viewDeleteDocConfirm(c *ui.Context) {
	doc := s.readerDoc
	if doc == nil {
		s.deleteConfirmOpen = false
		return
	}
	mobile.ActionSheet(c, &s.deleteConfirmOpen, mobile.ActionSheetOptions{
		Title:   "Move Document to Trash?",
		Message: doc.Title,
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Delete Document",
		Destructive: true,
		OnTap: func() {
			s.deleteDocAsync(doc.ID)
		},
	})
}

func (s *Screen) deleteDocAsync(docID string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		if err := client.DeleteDocument(context.Background(), docID); err != nil {
			s.enqueueUI(func() { s.readerErr = err.Error() })
			return
		}
		s.enqueueUI(func() {
			s.mu.Lock()
			var filtered []api.Document
			for _, d := range s.documents {
				if d.ID != docID {
					filtered = append(filtered, d)
				}
			}
			s.documents = filtered
			s.mu.Unlock()
			s.readerOpen = false
			s.toast("Document deleted")
		})
	}()
}

func (s *Screen) viewNewNoteSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.newNoteSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.48},
		Label:   "New Markdown Note",
	}, func() {
		ui.Column(c).FillWidth().Padding(14, 16, 24, 16).Gap(12).Children(func() {
			ui.Text(c, "Create Note").FontSize(18).Bold().TextColor(t.Text)
			if s.newNoteErr != "" {
				components.StatusBanner(c, components.ToneDanger, s.newNoteErr, "Dismiss", func() {
					s.newNoteErr = ""
				})
			}
			components.FormField(c, "Title", "Project Spec.md", &s.newNoteTitle, false)
			lbl := "Create Note"
			if s.newNoteBusy {
				lbl = "Creating..."
			}
			btn := components.PrimaryTouchButton(c, lbl, s.newNoteBusy)
			btn.FillWidth()
			if btn.Clicked() {
				s.submitNewNote()
			}
		})
	})
}

func (s *Screen) submitNewNote() {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || s.newNoteBusy {
		return
	}
	title := strings.TrimSpace(s.newNoteTitle)
	s.newNoteBusy = true
	s.newNoteErr = ""
	go func() {
		doc, err := client.CreateDocument(context.Background(), tenantID, nil, "markdown")
		if err == nil && title != "" {
			if renamed, rErr := client.UpdateDocumentMetadata(context.Background(), doc.ID, title); rErr == nil {
				doc = renamed
			}
		}
		s.enqueueUI(func() {
			s.newNoteBusy = false
			if err != nil {
				s.newNoteErr = err.Error()
				return
			}
			s.newNoteSheetOpen = false
			s.newNoteTitle = ""
			s.replaceDocInList(doc)
			s.openDocument(doc)
		})
	}()
}

func (s *Screen) triggerUploadFile() {
	if s.uploadBusy {
		return
	}
	s.uploadBusy = true
	s.uploadErr = ""
	go func() {
		paths, err := s.openFile(mygo.OpenDialogOptions{Title: "Upload Document"})
		if err != nil {
			s.enqueueUI(func() {
				s.uploadBusy = false
				if !errors.Is(err, mygo.ErrCanceled) && !errors.Is(err, errors.ErrUnsupported) {
					s.uploadErr = err.Error()
				}
			})
			return
		}
		s.uploadLocalPaths(paths)
	}()
}

func (s *Screen) triggerUploadPhoto() {
	if s.uploadBusy {
		return
	}
	s.uploadBusy = true
	s.uploadErr = ""
	go func() {
		paths, err := s.pickImage(context.Background(), imagepicker.Options{Kind: imagepicker.Images})
		if err != nil {
			s.enqueueUI(func() {
				s.uploadBusy = false
				if errors.Is(err, errors.ErrUnsupported) {
					s.uploadErr = "Photo picker requires iOS or Android; use Upload File on desktop."
				} else if !errors.Is(err, mygo.ErrCanceled) {
					s.uploadErr = err.Error()
				}
			})
			return
		}
		s.uploadLocalPaths(paths)
	}()
}

func (s *Screen) uploadLocalPaths(paths []string) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || len(paths) == 0 {
		s.enqueueUI(func() { s.uploadBusy = false })
		return
	}
	p := paths[0]
	data, err := os.ReadFile(p)
	if err != nil {
		s.enqueueUI(func() {
			s.uploadBusy = false
			s.uploadErr = err.Error()
		})
		return
	}
	name := filepath.Base(p)
	ct := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	if ct == "" {
		ct = "application/octet-stream"
	}
	doc, err := client.UploadTenantDocument(context.Background(), tenantID, name, "file", ct, nil, data, "")
	s.enqueueUI(func() {
		s.uploadBusy = false
		if err != nil {
			s.uploadErr = err.Error()
			return
		}
		s.replaceDocInList(doc)
		s.toast("Uploaded " + doc.Title)
	})
}

func (s *Screen) replaceDocInList(doc api.Document) {
	s.mu.Lock()
	found := false
	for i := range s.documents {
		if s.documents[i].ID == doc.ID {
			s.documents[i] = doc
			found = true
			break
		}
	}
	if !found {
		s.documents = append([]api.Document{doc}, s.documents...)
	}
	nodeFound := false
	docCopy := doc
	for i := range s.myTree.Items {
		if s.myTree.Items[i].DocumentID == doc.ID || (s.myTree.Items[i].Document != nil && s.myTree.Items[i].Document.ID == doc.ID) {
			s.myTree.Items[i].Document = &docCopy
			nodeFound = true
			break
		}
	}
	if !nodeFound {
		var parentPtr *string
		if s.docFolderID != "" {
			p := s.docFolderID
			parentPtr = &p
		}
		node := api.DocumentTreeNode{
			ID:         "node_" + doc.ID,
			NodeKind:   "document",
			ParentID:   parentPtr,
			DocumentID: doc.ID,
			Document:   &docCopy,
			CreatedAt:  doc.CreatedAt,
			UpdatedAt:  doc.UpdatedAt,
		}
		s.myTree.Items = append([]api.DocumentTreeNode{node}, s.myTree.Items...)
	}
	s.mu.Unlock()
	if cs := s.cacheStore(); cs != nil {
		_ = cs.UpsertDocuments(context.Background(), []api.Document{doc})
	}
}

func isImageDoc(doc api.Document, ct string) bool {
	if strings.HasPrefix(strings.ToLower(ct), "image/") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(doc.Title))
	return ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" || ext == ".webp"
}

func isHTMLDoc(doc api.Document, ct string) bool {
	if strings.Contains(strings.ToLower(ct), "text/html") || strings.EqualFold(doc.Format, "html") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(doc.Title))
	return ext == ".html" || ext == ".htm"
}

func isCodeDoc(doc api.Document, _ string) bool {
	if strings.EqualFold(doc.Format, "code") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(doc.Title))
	switch ext {
	case ".go", ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".json", ".yaml", ".yml", ".sql", ".sh", ".css", ".toml":
		return true
	default:
		return false
	}
}
