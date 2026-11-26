// Package terminals implements Linger Mobile's Pocket Command Center for
// herdr-core (hc) live agents and terminals across local and remote SSH machines.
package terminals

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/herdr"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// Status filter indices for the Pocket Command Center overview.
const (
	FilterAll     = 0
	FilterBlocked = 1
	FilterWorking = 2
	FilterDone    = 3
)

const (
	machineFilterAll   = "__all__"
	machineFilterLocal = "__local__"
)

// Deps supplies host services and callbacks for the Terminals Pocket Command Center.
type Deps struct {
	Store         *state.AppStore
	Client        *herdr.Client
	Computers     []api.LocalComputer
	OnOpenConnect func()
	ShowToast     func(msg string)
	OnNotify      func()
}

// Screen owns state, background sync, attach lifecycle, and rendering for Terminals.
type Screen struct {
	deps Deps

	mu              sync.Mutex
	closed          bool
	pending         []func()
	selectedCompID  string
	loading         bool
	loadedOnce      bool
	unavailable     bool
	computerOffline bool
	syncError       string
	inlineNotice    string
	coreStatus      *herdr.CoreStatus
	terminals       []herdr.Terminal
	machines        []herdr.MachineView
	templates       []herdr.TemplateInfo
	busyAction      map[string]bool

	// Active attach stream state (protected by mu).
	attach       *herdr.AttachClient
	attachAddr   string
	attachMode   herdr.AttachMode
	detailOutput string
	detailRead   *herdr.ReadResult
	detailBusy   bool
	detailError  string

	// UI-thread-only state.
	machineFilter string
	statusFilter  int
	listScroll    ui.ScrollState
	detailScroll  ui.ScrollState
	refreshState  ui.RefreshState
	blockedDrafts map[string]*string

	// Detail view state (UI thread).
	detailAddress    string
	detailPrompt     string
	killConfirmOpen  bool
	rmConfirmOpen    bool
	confirmTargetAdr string
	confirmTargetNm  string

	// Quick Launch sheet state (UI thread).
	launchOpen     bool
	launchMode     int // 0: template, 1: custom command
	launchTemplate string
	launchTask     string
	launchCommand  string
	launchMachine  string // "" = local
	launchCwd      string
	launchName     string
	launchBusy     bool
	launchErr      string
}

// New constructs a Pocket Command Center Screen controller.
func New(deps Deps) *Screen {
	s := &Screen{
		deps:          deps,
		busyAction:    map[string]bool{},
		attachMode:    herdr.AttachModeDisconnected,
		machineFilter: machineFilterAll,
		blockedDrafts: map[string]*string{},
	}
	if deps.Client != nil && deps.Client.ComputerID() != "" {
		s.selectedCompID = deps.Client.ComputerID()
	}
	return s
}

// Close releases active attach streams and stops background activity.
func (s *Screen) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	att := s.attach
	s.attach = nil
	s.attachAddr = ""
	s.attachMode = herdr.AttachModeDisconnected
	s.mu.Unlock()

	if att != nil {
		_ = att.Close()
	}
}

// SelectComputer changes the active Local Computer and triggers a fresh sync.
func (s *Screen) SelectComputer(computerID string) {
	computerID = strings.TrimSpace(computerID)
	s.stopAttach()
	s.mu.Lock()
	if computerID != "" {
		s.selectedCompID = computerID
	}
	s.unavailable = false
	s.computerOffline = false
	s.syncError = ""
	s.mu.Unlock()

	s.enqueueUI(func() {
		s.detailAddress = ""
		s.machineFilter = machineFilterAll
	})
	go s.Refresh(context.Background())
}

// OpenTerminal switches directly into the Detail & Live Control view for address.
func (s *Screen) OpenTerminal(address string) {
	address = strings.TrimSpace(address)
	if address == "" {
		return
	}
	s.enqueueUI(func() {
		s.enterDetail(address)
	})
}

// BlockedCount returns the current number of blocked terminals waiting for approval.
func (s *Screen) BlockedCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.unavailable || s.computerOffline {
		return 0
	}
	n := 0
	for _, term := range s.terminals {
		if term.IsBlocked() {
			n++
		}
	}
	if n == 0 && s.coreStatus != nil && s.coreStatus.Available && len(s.terminals) == 0 {
		return s.coreStatus.BlockedCount
	}
	return n
}

// Refresh syncs herdr-core status, live+finished terminals, SSH machines, and templates.
func (s *Screen) Refresh(ctx context.Context) {
	cl, compID, offline := s.activeClient()
	if cl == nil || compID == "" {
		s.mu.Lock()
		s.loading = false
		s.mu.Unlock()
		s.notify()
		return
	}
	if offline {
		s.mu.Lock()
		s.loading = false
		s.loadedOnce = true
		s.unavailable = true
		s.computerOffline = true
		s.syncError = ""
		s.terminals = nil
		s.coreStatus = nil
		s.mu.Unlock()
		s.notify()
		return
	}

	s.mu.Lock()
	s.loading = true
	s.syncError = ""
	s.mu.Unlock()
	s.notify()

	var (
		wg        sync.WaitGroup
		statusRes herdr.CoreStatus
		statusErr error
		listRes   herdr.ListTerminalsResult
		listErr   error
		machRes   []herdr.MachineView
		machErr   error
		tplRes    []herdr.TemplateInfo
		tplErr    error
	)

	wg.Add(4)
	go func() {
		defer wg.Done()
		statusRes, statusErr = cl.Status(ctx)
	}()
	go func() {
		defer wg.Done()
		listRes, listErr = cl.ListTerminals(ctx, herdr.ListTerminalsOptions{All: true})
	}()
	go func() {
		defer wg.Done()
		machRes, machErr = cl.Machines(ctx)
	}()
	go func() {
		defer wg.Done()
		tplRes, tplErr = cl.Templates(ctx)
	}()
	wg.Wait()

	// Classify unavailable / computer-offline cleanly so missing routes or offline daemons never alarm or crash.
	isOffline := errors.Is(statusErr, herdr.ErrComputerOffline) || errors.Is(listErr, herdr.ErrComputerOffline)
	isUnavailable := isOffline ||
		(statusErr != nil && herdr.IsUnavailable(statusErr)) ||
		(listErr != nil && herdr.IsUnavailable(listErr)) ||
		(statusErr == nil && !statusRes.Available && listErr != nil)

	machines := mergeMachines(machRes, listRes.Machines, statusRes.Machines)

	s.mu.Lock()
	s.loading = false
	s.loadedOnce = true
	if isUnavailable {
		s.unavailable = true
		s.computerOffline = isOffline
		s.syncError = ""
		if statusErr == nil {
			cp := statusRes
			s.coreStatus = &cp
		} else {
			s.coreStatus = nil
		}
		s.terminals = nil
		s.machines = nil
		s.templates = nil
	} else {
		s.unavailable = false
		s.computerOffline = false
		if statusErr == nil {
			cp := statusRes
			s.coreStatus = &cp
		}
		if listErr == nil {
			s.terminals = listRes.Terminals
		}
		if len(machines) > 0 || (machErr == nil && listErr == nil) {
			s.machines = machines
		}
		if tplErr == nil {
			s.templates = tplRes
		}
		switch {
		case listErr != nil:
			s.syncError = listErr.Error()
		case statusErr != nil:
			s.syncError = statusErr.Error()
		default:
			s.syncError = ""
		}
	}
	s.mu.Unlock()
	s.notify()
}

// View renders the Pocket Command Center overview, terminal detail view, and launch sheets.
func (s *Screen) View(c *ui.Context) {
	s.drainPending()
	t := c.Theme()

	s.mu.Lock()
	machines := append([]herdr.MachineView(nil), s.machines...)
	s.mu.Unlock()

	if s.detailAddress != "" {
		s.viewDetail(c)
		s.viewKillConfirmSheet(c)
		s.viewRemoveConfirmSheet(c)
		s.viewLaunchSheet(c, machines)
		return
	}

	computers := s.computers()
	cl, activeCompID, _ := s.activeClient()

	s.mu.Lock()
	loading := s.loading
	loadedOnce := s.loadedOnce
	unavailable := s.unavailable
	compOffline := s.computerOffline
	syncErr := s.syncError
	notice := s.inlineNotice
	coreStatus := s.coreStatus
	allTerms := append([]herdr.Terminal(nil), s.terminals...)
	s.mu.Unlock()

	ui.Column(c).Fill().Background(t.Background).Children(func() {
		// Unpaired / disconnected empty state.
		if cl == nil && len(computers) == 0 {
			components.EmptyState(c, theme.IconTerminal,
				i18n.T("terminals.empty.connect_title"),
				i18n.T("terminals.empty.connect_body"),
				i18n.T("rooms.open_hub"), func() {
					if s.deps.OnOpenConnect != nil {
						s.deps.OnOpenConnect()
					}
				})
			return
		}
		if activeCompID == "" && len(computers) == 0 {
			components.EmptyState(c, theme.IconHost,
				i18n.T("terminals.empty.no_computers_title"),
				i18n.T("terminals.empty.no_computers_body"),
				i18n.T("common.refresh"), func() {
					go s.Refresh(context.Background())
				})
			return
		}

		// Top control strip: computer picker + Launch & Sync actions + core health summary.
		ui.Column(c).FillWidth().Padding(8, 14, 6, 14).Gap(8).Shrink(0).Children(func() {
			s.viewTopActionRow(c, computers, activeCompID, loading, unavailable)

			if coreStatus != nil && coreStatus.Available && !unavailable {
				s.viewCoreSummaryStrip(c, *coreStatus, allTerms)
			}

			if notice != "" {
				components.StatusBanner(c, components.ToneSuccess, notice, i18n.T("common.ok"), func() {
					s.mu.Lock()
					s.inlineNotice = ""
					s.mu.Unlock()
				})
			}
			if syncErr != "" {
				components.ErrorInline(c, syncErr, func() {
					go s.Refresh(context.Background())
				})
			}

			if !unavailable {
				s.viewMachineChips(c, machines, allTerms)
				components.SegmentedControl(c, &s.statusFilter,
					i18n.T("terminals.filter.all"),
					i18n.T("terminals.filter.blocked"),
					i18n.T("terminals.filter.working"),
					i18n.T("terminals.filter.done"))
			}
		})

		scroll := ui.Scroll(c.Key("terminals_overview")).FillWidth().Grow(1).Basis(0).TrackScroll(&s.listScroll)
		if scroll.PullToRefresh(&s.refreshState) {
			go func() {
				s.Refresh(context.Background())
				s.enqueueUI(func() {
					s.refreshState.Refreshing = false
				})
			}()
		}
		scroll.Children(func() {
			ui.Column(c).FillWidth().Padding(6, 14, 24, 14).Gap(12).Children(func() {
				if loading && !loadedOnce {
					components.LoadingSkeleton(c, 3)
					return
				}
				if unavailable {
					body := i18n.T("terminals.empty.unavailable_body")
					if compOffline {
						body = i18n.T("terminals.empty.offline_body")
					}
					components.EmptyState(c, theme.IconTerminal,
						i18n.T("terminals.empty.unavailable_title"),
						body,
						i18n.T("common.retry"), func() {
							go s.Refresh(context.Background())
						})
					return
				}

				// Priority Blocked Banner & Inbox at top (filtered by selected machine).
				blockedTerms := filterBlockedByMachine(allTerms, s.machineFilter)
				if len(blockedTerms) > 0 && (s.statusFilter == FilterAll || s.statusFilter == FilterBlocked) {
					s.viewBlockedInbox(c, blockedTerms)
				}

				filtered := filterTerminals(allTerms, s.machineFilter, s.statusFilter)
				if len(allTerms) == 0 {
					components.EmptyState(c, theme.IconTerminal,
						i18n.T("terminals.empty.none_title"),
						i18n.T("terminals.empty.none_body"),
						i18n.T("terminals.launch_btn"), func() {
							s.openLaunchSheet()
						})
					return
				}
				if len(filtered) == 0 {
					components.EmptyState(c, theme.IconTerminal,
						i18n.T("terminals.empty.filtered_title"),
						i18n.T("terminals.empty.filtered_body"),
						i18n.T("terminals.empty.show_all"), func() {
							s.machineFilter = machineFilterAll
							s.statusFilter = FilterAll
						})
					return
				}

				ordered := orderTerminalsHierarchically(filtered)
				components.SectionEyebrow(c, i18n.Tf("terminals.list.section_title", map[string]any{"count": len(ordered)}), nil)
				for _, entry := range ordered {
					s.viewTerminalCard(c, entry.term, entry.isChild)
				}
			})
		})
	})

	s.viewLaunchSheet(c, machines)
}

func (s *Screen) viewTopActionRow(c *ui.Context, computers []api.LocalComputer, activeCompID string, loading, unavailable bool) {
	t := c.Theme()
	ex := theme.Extra(t)

	ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
		// Computer selector chips (scrollable so narrow 320px viewports never clip).
		ui.ScrollHorizontal(c).Grow(1).Basis(0).Children(func() {
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				if len(computers) == 0 && activeCompID != "" {
					components.StatusDotPill(c, activeCompID, components.ToneInfo)
					return
				}
				for _, comp := range computers {
					comp := comp
					active := comp.ComputerID == activeCompID
					online := strings.EqualFold(comp.Status, "online")
					bg := t.Surface
					fg := t.TextMuted
					borderCol := ex.SubtleBorder
					if active {
						bg = t.Accent
						fg = t.AccentText
						borderCol = t.Accent
					}
					dotCol := t.Success
					if !online {
						dotCol = t.Warning
					}
					chip := ui.Row(c.Key("comp_"+comp.ComputerID)).MinHeight(34).Padding(5, 10).Radius(999).
						Background(bg).Border(0.75, borderCol).AlignItems(ui.Center).Gap(6).Shrink(0).
						Role(ui.RoleButton).Label(i18n.Tf("terminals.list.computer_a11y", map[string]any{"name": comp.DisplayName})).Checked(active)
					chip.Children(func() {
						ui.Box(c).Size(6, 6).Radius(3).Background(dotCol).Shrink(0)
						ui.Text(c, comp.DisplayName).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
					})
					if chip.Clicked() && !active {
						mygo.Haptics.Light()
						s.SelectComputer(comp.ComputerID)
					}
				}
			})
		})

		launchBtn := components.CompactPrimaryButton(c, i18n.T("terminals.launch_short"), nil, unavailable)
		launchBtn.MinHeight(34)
		if launchBtn.Clicked() {
			mygo.Haptics.Light()
			s.openLaunchSheet()
		}

		syncLbl := i18n.T("common.sync")
		if loading {
			syncLbl = i18n.T("common.syncing")
		}
		refBtn := components.CompactSecondaryButton(c, syncLbl, theme.IconRefresh, loading)
		refBtn.MinHeight(34)
		if refBtn.Clicked() {
			go s.Refresh(context.Background())
		}
	})
}

func (s *Screen) viewCoreSummaryStrip(c *ui.Context, st herdr.CoreStatus, terms []herdr.Terminal) {
	t := c.Theme()
	ex := theme.Extra(t)
	liveCount := st.LiveCount
	blockedCount := st.BlockedCount
	workingCount := st.WorkingCount
	if len(terms) > 0 {
		liveCount, blockedCount, workingCount = 0, 0, 0
		for _, term := range terms {
			if !term.IsFinished() {
				liveCount++
			}
			if term.IsBlocked() {
				blockedCount++
			}
			if term.IsWorking() {
				workingCount++
			}
		}
	}
	var summary string
	if strings.TrimSpace(st.Version) != "" {
		summary = i18n.Tf("terminals.core_summary", map[string]any{
			"version": st.Version,
			"live":    liveCount,
			"blocked": blockedCount,
			"working": workingCount,
		})
	} else {
		summary = i18n.Tf("terminals.core_summary_no_ver", map[string]any{
			"live":    liveCount,
			"blocked": blockedCount,
			"working": workingCount,
		})
	}
	ui.Row(c).FillWidth().Padding(6, 10).Radius(10).Background(ex.MutedBg).Border(0.75, ex.SubtleBorder).
		AlignItems(ui.Center).Gap(7).Children(func() {
		dotCol := t.Success
		if blockedCount > 0 {
			dotCol = ex.Brand
		}
		ui.Box(c).Size(7, 7).Radius(3.5).Background(dotCol).Shrink(0)
		ui.Text(c, summary).FontSize(11.5).FontWeight(500).TextColor(t.TextMuted).Grow(1).Basis(0).MaxLines(1)
	})
}

func (s *Screen) viewMachineChips(c *ui.Context, machines []herdr.MachineView, terms []herdr.Terminal) {
	t := c.Theme()
	ex := theme.Extra(t)

	type machineOption struct {
		id    string
		label string
		state string
	}
	opts := []machineOption{
		{id: machineFilterAll, label: i18n.T("terminals.machine.all"), state: "connected"},
		{id: machineFilterLocal, label: i18n.T("terminals.machine.local"), state: "connected"},
	}
	seen := map[string]bool{}
	for _, m := range machines {
		name := strings.TrimSpace(m.Name)
		if name == "" || strings.EqualFold(name, "local") || seen[name] {
			continue
		}
		seen[name] = true
		opts = append(opts, machineOption{id: name, label: name, state: m.State})
	}
	for _, term := range terms {
		m := term.EffectiveMachine()
		if m != "" && !seen[m] {
			seen[m] = true
			opts = append(opts, machineOption{id: m, label: m, state: "connected"})
		}
	}

	ui.ScrollHorizontal(c).FillWidth().Shrink(0).Children(func() {
		ui.Row(c).Gap(6).Padding(1, 1).Children(func() {
			for _, opt := range opts {
				opt := opt
				active := s.machineFilter == opt.id
				bg := t.Surface
				fg := t.TextMuted
				borderCol := ex.SubtleBorder
				if active {
					bg = t.Accent
					fg = t.AccentText
					borderCol = t.Accent
				}
				chip := ui.Row(c.Key("mach_"+opt.id)).MinHeight(32).Padding(4, 10).Radius(999).
					Background(bg).Border(0.75, borderCol).AlignItems(ui.Center).Gap(5).Shrink(0).
					Role(ui.RoleButton).Label(i18n.Tf("terminals.list.machine_a11y", map[string]any{"name": opt.label})).Checked(active)
				chip.Children(func() {
					if opt.id != machineFilterAll && opt.id != machineFilterLocal {
						dot := t.Success
						if opt.state != "" && !strings.EqualFold(opt.state, "connected") {
							dot = t.Warning
						}
						ui.Box(c).Size(6, 6).Radius(3).Background(dot).Shrink(0)
					}
					ui.Text(c, opt.label).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
				})
				if chip.Clicked() && !active {
					s.machineFilter = opt.id
				}
			}
		})
	})
}

func (s *Screen) viewBlockedInbox(c *ui.Context, blocked []herdr.Terminal) {
	t := c.Theme()
	ex := theme.Extra(t)

	bannerText := i18n.Tf("terminals.blocked.banner", map[string]any{"count": len(blocked)})
	components.StatusBanner(c, components.ToneBrand, bannerText, "", nil)

	components.SectionEyebrow(c, i18n.Tf("terminals.blocked.section_title", map[string]any{"count": len(blocked)}), nil)
	ui.Text(c, i18n.T("terminals.blocked.section_sub")).FontSize(12).TextColor(t.TextMuted).Padding(0, 4)

	for _, term := range blocked {
		term := term
		st := term.EffectiveStatus()
		msg := strings.TrimSpace(st.Msg)
		if msg == "" {
			msg = i18n.T("terminals.blocked.prompt_fallback")
		}
		draft := s.blockedDraftFor(term.Address)
		busy := s.isBusy(term.Address)

		card := ui.Column(c.Key("blocked_"+term.Address)).FillWidth().Background(t.Surface).Radius(16).Clip().
			Padding(14, 14, 14, 17).Gap(10)
		components.ApplyCardElevation(card, t)
		card.DrawOver(func(p *ui.Painter, r ui.Rect) {
			p.Fill(ui.Rect{X: r.X, Y: r.Y + 10, W: 3.5, H: r.H - 20}, ex.Brand, 2)
		})
		card.Children(func() {
			// Identity header: name/address + app + machine + Inspect button.
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
						ui.Text(c, term.DisplayName()).FontSize(15).FontWeight(700).TextColor(t.Text).MaxLines(1)
						components.StatusDotPill(c, i18n.StatusLabel("blocked"), components.ToneBrand)
					})
					meta := term.EffectiveApp() + " · " + s.machineLabel(term.EffectiveMachine())
					if term.Name != "" && term.Name != term.Address {
						meta = term.Address + " · " + meta
					}
					ui.Text(c, meta).FontSize(11.5).TextColor(t.TextMuted).MaxLines(1)
				})
				inspBtn := components.CompactSecondaryButton(c, i18n.T("terminals.blocked.inspect_btn"), nil, false)
				inspBtn.MinHeight(34)
				if inspBtn.Clicked() {
					s.enterDetail(term.Address)
				}
			})

			// OSC 7501 approval message & cwd.
			ui.Column(c).FillWidth().Padding(10, 12).Radius(11).Background(ex.BrandTint).Border(0.75, ex.Brand.Alpha(0.28)).Gap(4).Children(func() {
				ui.Text(c, msg).FontSize(13.5).FontWeight(600).LineHeight(1.35).TextColor(t.Text)
				if cwd := term.EffectiveCwd(); cwd != "" {
					ui.Text(c, cwd).Font("monospace").FontSize(11).TextColor(t.TextMuted).MaxLines(1)
				}
			})

			// Quick approval key buttons (Enter, Esc, Up, Down, y, n).
			quickKeys := []struct {
				label string
				key   string
			}{
				{"Enter", "enter"},
				{"Esc", "esc"},
				{"\u2191", "up"},
				{"\u2193", "down"},
				{"y", "y"},
				{"n", "n"},
			}
			ui.ScrollHorizontal(c).FillWidth().Children(func() {
				ui.Row(c).Gap(6).Children(func() {
					for _, qk := range quickKeys {
						qk := qk
						var btn ui.Element
						if qk.key == "enter" || qk.key == "y" {
							btn = components.CompactPrimaryButton(c.Key("qk_"+term.Address+"_"+qk.key), qk.label, nil, busy)
						} else {
							btn = components.CompactSecondaryButton(c.Key("qk_"+term.Address+"_"+qk.key), qk.label, nil, busy)
						}
						btn.MinHeight(34).MinWidth(42)
						if btn.Clicked() {
							s.sendKeysAsync(term.Address, term.DisplayName(), []string{qk.key}, qk.label)
						}
					}
				})
			})

			// One-line custom reply bar using CAS guard if="blocked", force=true.
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
				inp := ui.TextInput(c.Key("reply_in_"+term.Address), draft).Grow(1).Basis(0).MinHeight(40).
					Placeholder(i18n.T("terminals.blocked.reply_placeholder")).
					Label(i18n.Tf("terminals.blocked.reply_a11y", map[string]any{"name": term.DisplayName()})).
					Disabled(busy)
				_ = inp
				sendBtn := components.CompactPrimaryButton(c.Key("reply_send_"+term.Address), i18n.T("terminals.blocked.send_btn"), nil, busy || strings.TrimSpace(*draft) == "")
				sendBtn.MinHeight(40)
				if sendBtn.Clicked() {
					reply := strings.TrimSpace(*draft)
					if reply != "" {
						s.sendBlockedReplyAsync(term.Address, term.DisplayName(), reply)
					}
				}
			})
		})
	}
}

func (s *Screen) viewTerminalCard(c *ui.Context, term herdr.Terminal, isChild bool) {
	t := c.Theme()
	ex := theme.Extra(t)
	st := term.EffectiveStatus()
	tone := statusTone(st.State)

	outer := ui.Row(c.Key("term_" + term.Address)).FillWidth().AlignItems(ui.Stretch)
	if isChild {
		outer.Padding(0, 0, 0, 14).Gap(8)
	}
	outer.Children(func() {
		if isChild {
			ui.Box(c).Width(2).Background(ex.SubtleBorder).Radius(1).Shrink(0)
		}
		card := ui.Column(c).Grow(1).Basis(0).Background(t.Surface).Radius(15).Padding(13, 14).Gap(8).
			Role(ui.RoleButton).Label(i18n.Tf("terminals.list.row_a11y", map[string]any{
			"name":   term.DisplayName(),
			"status": i18n.StatusLabel(st.State),
		}))
		components.ApplyCardElevation(card, t)
		if card.Pressed() {
			card.Background(t.SurfacePressed)
		}
		card.Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
					ui.Text(c, term.DisplayName()).FontSize(14.5).FontWeight(600).LetterSpacing(-0.15).TextColor(t.Text).MaxLines(1)
					sub := term.EffectiveApp() + " · " + s.machineLabel(term.EffectiveMachine())
					if term.Name != "" && term.Name != term.Address {
						sub = term.Address + " · " + sub
					}
					ui.Text(c, sub).FontSize(11.5).TextColor(t.TextMuted).MaxLines(1)
				})
				components.StatusDotPill(c, i18n.StatusLabel(st.State), tone)
			})

			// Parent badge, Room/WorkItem labels, and Keep badge.
			hasBadges := strings.TrimSpace(term.Parent) != "" || term.RoomLabel() != "" || term.WorkItemLabel() != "" || term.Keep
			if hasBadges {
				ui.Row(c).FillWidth().Wrap().Gap(5).Children(func() {
					if p := strings.TrimSpace(term.Parent); p != "" {
						components.StatusPill(c, "\u21b3 "+i18n.Tf("terminals.list.subagent_of", map[string]any{"parent": p}), components.ToneNeutral)
					}
					if rm := term.RoomLabel(); rm != "" {
						components.StatusPill(c, i18n.Tf("terminals.list.room_badge", map[string]any{"room": rm}), components.ToneInfo)
					}
					if wi := term.WorkItemLabel(); wi != "" {
						components.StatusPill(c, i18n.Tf("terminals.list.work_item_badge", map[string]any{"item": wi}), components.ToneBrand)
					}
					if term.Keep {
						components.StatusPill(c, i18n.T("terminals.list.keep_badge"), components.ToneSuccess)
					}
				})
			}

			// Preview line: OSC 7501 msg or title/where + cwd.
			preview := strings.TrimSpace(st.Msg)
			if preview == "" {
				preview = strings.TrimSpace(term.Title)
			}
			if preview == "" {
				preview = strings.TrimSpace(term.Where)
			}
			if preview != "" {
				ui.Text(c, preview).FontSize(12.5).LineHeight(1.3).TextColor(t.Text).MaxLines(2)
			}
			if cwd := term.EffectiveCwd(); cwd != "" {
				ui.Text(c, cwd).Font("monospace").FontSize(11).TextColor(ex.TextSubtle).MaxLines(1)
			}
		})
		if card.Clicked() {
			s.enterDetail(term.Address)
		}
	})
}

func (s *Screen) sendBlockedReplyAsync(address, displayName, text string) {
	cl, _, _ := s.activeClient()
	if cl == nil {
		return
	}
	if !s.trySetBusy(address) {
		return
	}
	mygo.Haptics.Light()
	go func() {
		_, err := cl.Send(context.Background(), herdr.SendRequest{
			Address: address,
			Text:    text,
			If:      "blocked",
			Force:   true,
		})
		s.clearBusy(address)
		if err != nil {
			if errors.Is(err, herdr.ErrPreconditionFailed) {
				s.toast(i18n.Tf("terminals.toast.cas_stale", map[string]any{"name": displayName}))
				s.Refresh(context.Background())
				return
			}
			s.mu.Lock()
			s.syncError = err.Error()
			s.mu.Unlock()
			s.notify()
			return
		}
		mygo.Haptics.Success()
		s.enqueueUI(func() {
			if d := s.blockedDrafts[address]; d != nil {
				*d = ""
			}
		})
		s.toast(i18n.Tf("terminals.toast.sent", map[string]any{"name": displayName}))
		s.Refresh(context.Background())
	}()
}

func (s *Screen) sendKeysAsync(address, displayName string, keys []string, keyLabel string) {
	cl, _, _ := s.activeClient()
	if cl == nil {
		return
	}
	if !s.trySetBusy(address) {
		return
	}
	mygo.Haptics.Light()
	go func() {
		_, err := cl.Keys(context.Background(), herdr.KeysRequest{
			Address: address,
			Keys:    keys,
		})
		s.clearBusy(address)
		if err != nil {
			s.mu.Lock()
			s.syncError = err.Error()
			s.detailError = err.Error()
			s.mu.Unlock()
			s.notify()
			return
		}
		mygo.Haptics.Success()
		s.toast(i18n.Tf("terminals.toast.keys_sent", map[string]any{"key": keyLabel, "name": displayName}))
		if s.currentDetailAddress() == address {
			s.refreshDetailSnapshot(context.Background(), address)
		}
		s.Refresh(context.Background())
	}()
}

func (s *Screen) activeClient() (*herdr.Client, string, bool) {
	computers := s.computers()

	s.mu.Lock()
	compID := s.selectedCompID
	s.mu.Unlock()

	if compID == "" && len(computers) > 0 {
		for _, comp := range computers {
			if strings.EqualFold(comp.Status, "online") {
				compID = comp.ComputerID
				break
			}
		}
		if compID == "" {
			compID = computers[0].ComputerID
		}
		s.mu.Lock()
		if s.selectedCompID == "" {
			s.selectedCompID = compID
		} else {
			compID = s.selectedCompID
		}
		s.mu.Unlock()
	}

	offline := false
	for _, comp := range computers {
		if comp.ComputerID == compID {
			if comp.Status != "" && !strings.EqualFold(comp.Status, "online") {
				offline = true
			}
			break
		}
	}

	if s.deps.Client != nil {
		if compID != "" && s.deps.Client.ComputerID() != compID {
			return s.deps.Client.WithComputer(compID), compID, offline
		}
		cid := compID
		if cid == "" {
			cid = s.deps.Client.ComputerID()
		}
		return s.deps.Client, cid, offline
	}
	if s.deps.Store != nil {
		if ac := s.deps.Store.Client(); ac != nil {
			if compID == "" {
				snap := s.deps.Store.Snapshot()
				if snap.CompanionStatus != nil && strings.TrimSpace(snap.CompanionStatus.ComputerID) != "" {
					compID = strings.TrimSpace(snap.CompanionStatus.ComputerID)
				}
			}
			return herdr.NewClientFromAPI(ac, compID), compID, offline
		}
	}
	return nil, compID, offline
}

func (s *Screen) computers() []api.LocalComputer {
	if len(s.deps.Computers) > 0 {
		return s.deps.Computers
	}
	if s.deps.Store != nil {
		return s.deps.Store.Snapshot().Computers
	}
	return nil
}

func (s *Screen) machineLabel(machine string) string {
	if strings.TrimSpace(machine) == "" {
		return i18n.T("terminals.machine.local")
	}
	return machine
}

func (s *Screen) blockedDraftFor(address string) *string {
	if p, ok := s.blockedDrafts[address]; ok {
		return p
	}
	v := ""
	s.blockedDrafts[address] = &v
	return &v
}

func (s *Screen) trySetBusy(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.busyAction[key] {
		return false
	}
	s.busyAction[key] = true
	return true
}

func (s *Screen) clearBusy(key string) {
	s.mu.Lock()
	delete(s.busyAction, key)
	s.mu.Unlock()
	s.notify()
}

func (s *Screen) isBusy(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.busyAction[key]
}

func (s *Screen) enqueueUI(fn func()) {
	if fn == nil {
		return
	}
	s.mu.Lock()
	s.pending = append(s.pending, fn)
	s.mu.Unlock()
	s.notify()
}

func (s *Screen) drainPending() {
	s.mu.Lock()
	if len(s.pending) == 0 {
		s.mu.Unlock()
		return
	}
	jobs := s.pending
	s.pending = nil
	s.mu.Unlock()
	for _, fn := range jobs {
		fn()
	}
}

func (s *Screen) notify() {
	if s.deps.OnNotify != nil {
		s.deps.OnNotify()
	}
}

func (s *Screen) toast(msg string) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	if s.deps.ShowToast != nil {
		s.deps.ShowToast(msg)
		return
	}
	s.mu.Lock()
	s.inlineNotice = msg
	s.mu.Unlock()
	s.notify()
}

func statusTone(st string) components.Tone {
	switch strings.ToLower(strings.TrimSpace(st)) {
	case "blocked":
		return components.ToneBrand
	case "working", "running", "busy":
		return components.ToneInfo
	case "idle", "ready", "live":
		return components.ToneSuccess
	case "error", "failed":
		return components.ToneDanger
	default:
		return components.ToneNeutral
	}
}

func filterBlockedByMachine(terms []herdr.Terminal, machineFilter string) []herdr.Terminal {
	var out []herdr.Terminal
	for _, term := range terms {
		if !term.IsBlocked() {
			continue
		}
		if !matchesMachineFilter(term, machineFilter) {
			continue
		}
		out = append(out, term)
	}
	return out
}

func filterTerminals(terms []herdr.Terminal, machineFilter string, statusFilter int) []herdr.Terminal {
	var out []herdr.Terminal
	for _, term := range terms {
		if !matchesMachineFilter(term, machineFilter) {
			continue
		}
		switch statusFilter {
		case FilterBlocked:
			if !term.IsBlocked() {
				continue
			}
		case FilterWorking:
			if !term.IsWorking() {
				continue
			}
		case FilterDone:
			if !term.IsFinished() {
				continue
			}
		}
		out = append(out, term)
	}
	return out
}

func matchesMachineFilter(term herdr.Terminal, filter string) bool {
	switch filter {
	case "", machineFilterAll:
		return true
	case machineFilterLocal:
		return term.EffectiveMachine() == ""
	default:
		return strings.EqualFold(term.EffectiveMachine(), filter)
	}
}

type orderedTerminal struct {
	term    herdr.Terminal
	isChild bool
}

func orderTerminalsHierarchically(terms []herdr.Terminal) []orderedTerminal {
	sorted := append([]herdr.Terminal(nil), terms...)
	sort.SliceStable(sorted, func(i, j int) bool {
		pi := terminalSortRank(sorted[i])
		pj := terminalSortRank(sorted[j])
		if pi != pj {
			return pi < pj
		}
		return sorted[i].Address < sorted[j].Address
	})

	byAddr := make(map[string]herdr.Terminal, len(sorted))
	childrenOf := make(map[string][]herdr.Terminal)
	for _, term := range sorted {
		byAddr[term.Address] = term
	}

	var roots []herdr.Terminal
	for _, term := range sorted {
		p := strings.TrimSpace(term.Parent)
		if p != "" && p != term.Address {
			if _, hasParent := byAddr[p]; hasParent {
				childrenOf[p] = append(childrenOf[p], term)
				continue
			}
		}
		roots = append(roots, term)
	}

	out := make([]orderedTerminal, 0, len(sorted))
	emitted := make(map[string]bool, len(sorted))
	var appendTree func(term herdr.Terminal, child bool)
	appendTree = func(term herdr.Terminal, child bool) {
		if emitted[term.Address] {
			return
		}
		emitted[term.Address] = true
		out = append(out, orderedTerminal{term: term, isChild: child || strings.TrimSpace(term.Parent) != ""})
		for _, ch := range childrenOf[term.Address] {
			appendTree(ch, true)
		}
	}
	for _, r := range roots {
		appendTree(r, false)
	}
	for _, term := range sorted {
		appendTree(term, strings.TrimSpace(term.Parent) != "")
	}
	return out
}

func terminalSortRank(term herdr.Terminal) int {
	switch {
	case term.IsBlocked():
		return 0
	case term.IsWorking():
		return 1
	case !term.IsFinished():
		return 2
	default:
		return 3
	}
}

func mergeMachines(groups ...[]herdr.MachineView) []herdr.MachineView {
	seen := map[string]int{}
	var out []herdr.MachineView
	for _, g := range groups {
		for _, m := range g {
			name := strings.TrimSpace(m.Name)
			if name == "" {
				continue
			}
			if idx, ok := seen[name]; ok {
				if out[idx].Version == "" {
					out[idx].Version = m.Version
				}
				if out[idx].State == "" {
					out[idx].State = m.State
				}
				continue
			}
			seen[name] = len(out)
			out = append(out, m)
		}
	}
	return out
}
