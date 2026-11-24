package library

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

type graphNodePos struct {
	Node api.WikiGraphNode
	X, Y float32
	R    float32
}

func (s *Screen) viewWikiSegment(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	wiki := s.personalWiki
	graph := s.wikiGraph
	wikiDocs := append([]api.Document(nil), s.wikiDocs...)
	preview := s.wikiPreview
	s.mu.Unlock()

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SegmentWiki]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
			if s.wikiErr != "" {
				components.StatusBanner(c, components.ToneDanger, s.wikiErr, "Dismiss", func() {
					s.wikiErr = ""
				})
			}

			// Wiki Status & Refresh Card
			stateStr := "uninitialized"
			gen := int64(0)
			if wiki != nil {
				stateStr = wiki.State
				gen = wiki.PublishedGeneration
			}
			components.SectionCard(c, "Personal Knowledge Wiki",
				fmt.Sprintf("Published generation #%d", gen), func() {
					tone := components.ToneInfo
					if stateStr == "ready" {
						tone = components.ToneSuccess
					} else if stateStr == "failed" {
						tone = components.ToneDanger
					}
					components.StatusPill(c, stateStr, tone)
				}, func() {
					ui.Row(c).FillWidth().Gap(8).Children(func() {
						refLbl := "Refresh Wiki"
						if s.wikiRefreshing {
							refLbl = "Refreshing..."
						}
						btn := components.PrimaryTouchButton(c, refLbl, s.wikiRefreshing)
						btn.Grow(1).Basis(0)
						if btn.Clicked() {
							s.refreshWikiAsync()
						}
					})
					if len(preview) > 0 {
						ui.Text(c, fmt.Sprintf("Preview ready: %d updated pages", len(preview))).
							FontSize(12).TextColor(t.TextMuted)
					}
				})

			components.SegmentedControl(c, &s.wikiViewMode, "Knowledge Graph", "Wiki Pages")

			if s.wikiViewMode == 0 {
				s.viewKnowledgeGraph(c, graph, wikiDocs)
			} else {
				s.renderDocumentSlice(c, wikiDocs, "No Personal Wiki pages published yet. Tap Refresh Wiki to build your knowledge base.")
			}
		})
	})
}

func (s *Screen) viewKnowledgeGraph(c *ui.Context, graph *api.WikiGraphData, fallbackDocs []api.Document) {
	t := c.Theme()
	var nodes []api.WikiGraphNode
	var edges []api.WikiGraphEdge
	if graph != nil && len(graph.Nodes) > 0 {
		nodes = graph.Nodes
		edges = graph.Edges
	} else if len(fallbackDocs) > 0 {
		for _, d := range fallbackDocs {
			nodes = append(nodes, api.WikiGraphNode{
				ID:       d.ID,
				Title:    d.Title,
				Category: "Project",
				Body:     d.Format,
			})
		}
	}

	if len(nodes) == 0 {
		components.EmptyState(c, theme.IconRadar, "No Graph Nodes Yet",
			"Refresh your Personal Wiki to build entity nodes and cross-links.",
			"Refresh Wiki", s.refreshWikiAsync)
		return
	}

	// Category filter pills
	cats := collectWikiCategories(nodes)
	ui.ScrollHorizontal(c).FillWidth().Children(func() {
		ui.Row(c).Gap(6).Children(func() {
			allOn := s.wikiCategory == ""
			allChip := ui.Row(c.Key("all")).MinHeight(34).PaddingX(12).Radius(999).
				Background(func() ui.Color {
					if allOn {
						return t.Accent
					}
					return theme.Extra(t).MutedBg
				}()).AlignItems(ui.Center).Shrink(0).Role(ui.RoleTab).Label("All Categories").Checked(allOn)
			allChip.Children(func() {
				fg := t.TextMuted
				if allOn {
					fg = t.AccentText
				}
				ui.Text(c, "All").FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
			})
			if allChip.Clicked() {
				s.wikiCategory = ""
			}

			for _, cat := range cats {
				cat := cat
				on := s.wikiCategory == cat
				chip := ui.Row(c.Key(cat)).MinHeight(34).PaddingX(12).Radius(999).
					Background(func() ui.Color {
						if on {
							return t.Accent
						}
						return theme.Extra(t).MutedBg
					}()).AlignItems(ui.Center).Shrink(0).Role(ui.RoleTab).Label("Category " + cat).Checked(on)
				chip.Children(func() {
					fg := t.TextMuted
					if on {
						fg = t.AccentText
					}
					ui.Text(c, cat).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
				})
				if chip.Clicked() {
					s.wikiCategory = cat
				}
			}
		})
	})

	var visibleNodes []api.WikiGraphNode
	visibleSet := map[string]bool{}
	for _, n := range nodes {
		cat := n.Category
		if cat == "" {
			cat = "Other"
		}
		if s.wikiCategory == "" || cat == s.wikiCategory {
			visibleNodes = append(visibleNodes, n)
			visibleSet[n.ID] = true
		}
	}
	var visibleEdges []api.WikiGraphEdge
	for _, e := range edges {
		if visibleSet[e.Source] && visibleSet[e.Target] {
			visibleEdges = append(visibleEdges, e)
		}
	}

	ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
		ui.Text(c, fmt.Sprintf("%s · %s",
			components.PluralInt(len(visibleNodes), "node", "nodes"),
			components.PluralInt(len(visibleEdges), "link", "links"))).
			FontSize(12).TextColor(t.TextMuted)
		resetBtn := components.SecondaryTouchButton(c, "Reset Zoom", false)
		resetBtn.MinHeight(32).Padding(4, 10)
		if resetBtn.Clicked() {
			s.graphZoom.Reset()
		}
	})

	// Zoomable native ui.Painter canvas
	const canvasH = float32(280)
	zoomBox := mobile.Zoomable(c, &s.graphZoom, mobile.ZoomOptions{
		Min:       0.5,
		Max:       4.0,
		DoubleTap: 2.0,
	}, func() {
		canvas := ui.Box(c).FillWidth().Height(canvasH).Background(t.Surface).
			Radius(12).Border(1, t.Border).
			Role(ui.RoleImage).Label("Personal Knowledge Graph")
		canvas.Draw(func(p *ui.Painter, r ui.Rect) {
			if r.W <= 1 || r.H <= 1 {
				return
			}
			s.graphBoxRect = r
			positions := computeGraphLayout(visibleNodes, visibleEdges, r.W, r.H)
			s.graphLayoutCache = positions
			paintKnowledgeGraph(p, r, t, positions, visibleEdges, s.wikiSelectedNode)
		})
		if canvas.Clicked() {
			if px, py, ok := canvas.PointerPosition(); ok {
				if hit := hitTestGraphNode(s.graphLayoutCache, px, py); hit != nil {
					cp := *hit
					s.wikiSelectedNode = &cp
					s.wikiPageSheet = true
				}
			}
		}
	})
	zoomBox.FillWidth().Height(canvasH).Radius(12).Border(1, t.Border)

	// Accessible node buttons below canvas for reliable tapping & screen-reader navigation
	ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
		for _, n := range visibleNodes {
			n := n
			col := wikiCategoryColor(n.Category)
			chip := ui.Row(c.Key("node:" + n.ID)).MinHeight(36).Padding(6, 10).Radius(10).
				Background(t.Surface).Border(1, col.Alpha(0.55)).AlignItems(ui.Center).Gap(6).
				Role(ui.RoleButton).Label("Open wiki node " + n.Title)
			chip.Children(func() {
				ui.Box(c).Size(8, 8).Radius(4).Background(col).Shrink(0)
				ui.Text(c, n.Title).FontSize(12).FontWeight(600).TextColor(t.Text).MaxLines(1)
			})
			if chip.Clicked() {
				cp := n
				s.wikiSelectedNode = &cp
				s.wikiPageSheet = true
			}
		}
	})
}

func (s *Screen) viewWikiPageDetailSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.wikiPageSheet, mobile.SheetOptions{
		Detents: []float32{0.72, 0.94},
		Label:   "Wiki Page Detail",
	}, func() {
		node := s.wikiSelectedNode
		if node == nil {
			return
		}
		s.mu.Lock()
		var allNodes []api.WikiGraphNode
		if s.wikiGraph != nil {
			allNodes = s.wikiGraph.Nodes
		}
		s.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, node.Title).FontSize(18).Bold().TextColor(t.Text).Grow(1).Basis(0)
					components.StatusPill(c, firstWikiStr(node.Category, "Page"), components.ToneInfo)
				})
				if node.Description != "" {
					ui.Text(c, node.Description).FontSize(13).TextColor(t.TextMuted)
				}
				if len(node.Tags) > 0 {
					ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
						for _, tg := range node.Tags {
							components.StatusPill(c, "#"+tg, components.ToneNeutral)
						}
					})
				}

				linkedIDs := append([]string(nil), node.Links...)
				linkedIDs = append(linkedIDs, node.Backlinks...)
				if len(linkedIDs) > 0 {
					ui.Text(c, "Connected Pages").FontSize(13).FontWeight(600).TextColor(t.Text)
					ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
						for _, id := range linkedIDs {
							id := id
							target := findGraphNode(allNodes, id)
							lbl := id
							if target != nil {
								lbl = target.Title
							}
							btn := components.SecondaryTouchButton(c, lbl, target == nil)
							btn.MinHeight(34).Padding(4, 10).Label("Jump to " + lbl)
							if btn.Clicked() && target != nil {
								cp := *target
								s.wikiSelectedNode = &cp
							}
						}
					})
				}

				ui.Divider(c)
				if strings.TrimSpace(node.Body) != "" {
					markdown.View(c, node.Body, &s.mdOpts).FillWidth()
				} else {
					ui.Text(c, "No body content captured for this node yet.").FontSize(13).TextColor(t.TextMuted)
				}
			})
		})
	})
}

func (s *Screen) refreshWikiAsync() {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || s.wikiRefreshing {
		return
	}
	s.wikiRefreshing = true
	s.wikiErr = ""
	go func() {
		ctx := context.Background()
		_, err := client.RefreshPersonalWiki(ctx, tenantID)
		if err != nil {
			s.enqueueUI(func() {
				s.wikiRefreshing = false
				s.wikiErr = err.Error()
			})
			return
		}
		wiki, wErr := client.GetPersonalWiki(ctx, tenantID)
		var preview map[string]string
		if wErr == nil && wiki.LatestRefreshID != nil {
			preview, _ = client.GetPersonalWikiPreview(ctx, tenantID, *wiki.LatestRefreshID)
		}
		graph, gErr := client.GetPersonalWikiGraphData(ctx, tenantID)
		docs, _ := client.ListPersonalWikiDocuments(ctx, tenantID)

		s.enqueueUI(func() {
			s.wikiRefreshing = false
			s.mu.Lock()
			if wErr == nil {
				s.personalWiki = &wiki
			}
			if len(preview) > 0 {
				s.wikiPreview = preview
			}
			if gErr == nil {
				s.wikiGraph = &graph
			}
			if len(docs.Items) > 0 {
				s.wikiDocs = docs.Items
			}
			s.mu.Unlock()
			s.toast("Wiki refresh requested")
		})
	}()
}

// computeGraphLayout deterministically arranges nodes within [0, w] x [0, h] with
// zero NaN/Inf and finite clamping even for degenerate inputs or zero-size bounds.
func computeGraphLayout(nodes []api.WikiGraphNode, edges []api.WikiGraphEdge, w, h float32) []graphNodePos {
	if len(nodes) == 0 || w <= 1 || h <= 1 || math.IsNaN(float64(w)) || math.IsNaN(float64(h)) {
		return nil
	}
	pos := make([]graphNodePos, len(nodes))
	idxByID := make(map[string]int, len(nodes))
	cx, cy := float64(w)/2.0, float64(h)/2.0
	radX := math.Max(20.0, float64(w)*0.34)
	radY := math.Max(20.0, float64(h)*0.34)

	for i, n := range nodes {
		idxByID[n.ID] = i
		angle := float64(i) * 2.399963229728653 // golden angle
		scale := math.Sqrt(float64(i+1) / float64(len(nodes)+1))
		x := cx + math.Cos(angle)*radX*scale
		y := cy + math.Sin(angle)*radY*scale
		r := float32(12)
		if n.Size > 0 {
			r = float32(math.Min(18, math.Max(9, 8+math.Sqrt(float64(n.Size))/10)))
		}
		pos[i] = graphNodePos{Node: n, X: float32(x), Y: float32(y), R: r}
	}

	// Bounded force-directed relaxation
	const iters = 28
	const minDist = 8.0
	for range iters {
		dispX := make([]float64, len(pos))
		dispY := make([]float64, len(pos))
		for i := range pos {
			for j := i + 1; j < len(pos); j++ {
				dx := float64(pos[i].X - pos[j].X)
				dy := float64(pos[i].Y - pos[j].Y)
				dist := math.Hypot(dx, dy)
				if dist < minDist {
					dist = minDist
					dx = float64(i - j + 1)
					dy = 1.0
					d2 := math.Hypot(dx, dy)
					dx /= d2
					dy /= d2
				} else {
					dx /= dist
					dy /= dist
				}
				rep := 2400.0 / (dist * dist)
				if rep > 24 {
					rep = 24
				}
				dispX[i] += dx * rep
				dispY[i] += dy * rep
				dispX[j] -= dx * rep
				dispY[j] -= dy * rep
			}
		}
		for _, e := range edges {
			si, okS := idxByID[e.Source]
			ti, okT := idxByID[e.Target]
			if !okS || !okT || si == ti {
				continue
			}
			dx := float64(pos[ti].X - pos[si].X)
			dy := float64(pos[ti].Y - pos[si].Y)
			dist := math.Hypot(dx, dy)
			if dist < 1 {
				continue
			}
			pull := (dist - 102.0) * 0.06
			ux, uy := dx/dist, dy/dist
			dispX[si] += ux * pull
			dispY[si] += uy * pull
			dispX[ti] -= ux * pull
			dispY[ti] -= uy * pull
		}

		const padX = 52.0
		const padY = 34.0
		maxX := math.Max(padX+1, float64(w)-padX)
		maxY := math.Max(padY+1, float64(h)-padY-14)
		for i := range pos {
			// Gentle centering pull
			dispX[i] += (cx - float64(pos[i].X)) * 0.025
			dispY[i] += (cy - float64(pos[i].Y)) * 0.025
			nx := float64(pos[i].X) + math.Max(-18, math.Min(18, dispX[i]))
			ny := float64(pos[i].Y) + math.Max(-18, math.Min(18, dispY[i]))
			if math.IsNaN(nx) || math.IsInf(nx, 0) {
				nx = cx
			}
			if math.IsNaN(ny) || math.IsInf(ny, 0) {
				ny = cy
			}
			pos[i].X = float32(math.Max(padX, math.Min(maxX, nx)))
			pos[i].Y = float32(math.Max(padY, math.Min(maxY, ny)))
		}
	}
	return pos
}

func paintKnowledgeGraph(p *ui.Painter, r ui.Rect, t *ui.Theme, positions []graphNodePos, edges []api.WikiGraphEdge, selected *api.WikiGraphNode) {
	p.Clip(r, 12, func() {
		byID := make(map[string]graphNodePos, len(positions))
		for _, np := range positions {
			byID[np.Node.ID] = np
		}

		// Edges
		edgeCol := t.Border
		inferredCol := t.TextMuted.Alpha(0.35)
		for _, e := range edges {
			a, okA := byID[e.Source]
			b, okB := byID[e.Target]
			if !okA || !okB {
				continue
			}
			c := edgeCol
			width := float32(1.6)
			if e.Kind == "mention" {
				c = inferredCol
				width = 1.1
			}
			p.Line(r.X+a.X, r.Y+a.Y, r.X+b.X, r.Y+b.Y, width, c)
		}

		// Nodes + labels
		for _, np := range positions {
			col := wikiCategoryColor(np.Node.Category)
			cx, cy := r.X+np.X, r.Y+np.Y
			if selected != nil && selected.ID == np.Node.ID {
				p.Stroke(ui.Rect{X: cx - np.R - 3, Y: cy - np.R - 3, W: (np.R + 3) * 2, H: (np.R + 3) * 2},
					t.Accent, np.R+3, 2.2)
			}
			p.Fill(ui.Rect{X: cx - np.R, Y: cy - np.R, W: np.R * 2, H: np.R * 2}, col, np.R)
			p.Stroke(ui.Rect{X: cx - np.R, Y: cy - np.R, W: np.R * 2, H: np.R * 2}, t.Surface, np.R, 1.5)

			lbl := np.Node.Title
			if len(lbl) > 18 {
				lbl = lbl[:17] + "..."
			}
			lblX := cx - float32(len(lbl))*2.7
			if lblX < r.X+6 {
				lblX = r.X + 6
			}
			p.Text(lblX, cy+np.R+4, lbl, 10, t.Text)
		}
	})
}

func hitTestGraphNode(positions []graphNodePos, px, py float32) *api.WikiGraphNode {
	var best *api.WikiGraphNode
	bestDist := float32(28.0)
	for i := range positions {
		np := positions[i]
		dx := px - np.X
		dy := py - np.Y
		d := float32(math.Hypot(float64(dx), float64(dy)))
		if d <= np.R+14 && d < bestDist {
			bestDist = d
			best = &positions[i].Node
		}
	}
	return best
}

func wikiCategoryColor(cat string) ui.Color {
	switch strings.ToLower(cat) {
	case "session":
		return theme.Nature.Bluebell
	case "client":
		return theme.Nature.Acorn
	case "contact":
		return theme.Nature.Bubblegum
	case "project":
		return theme.Nature.Lake
	case "topic":
		return theme.Nature.Lavender
	default:
		return theme.Nature.Rain
	}
}

func collectWikiCategories(nodes []api.WikiGraphNode) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, n := range nodes {
		cat := n.Category
		if cat == "" {
			cat = "Other"
		}
		if _, ok := seen[cat]; !ok {
			seen[cat] = struct{}{}
			out = append(out, cat)
		}
	}
	sort.Strings(out)
	return out
}

func findGraphNode(nodes []api.WikiGraphNode, id string) *api.WikiGraphNode {
	for i := range nodes {
		if nodes[i].ID == id {
			return &nodes[i]
		}
	}
	return nil
}

func firstWikiStr(v, fallback string) string {
	if strings.TrimSpace(v) != "" {
		return v
	}
	return fallback
}
