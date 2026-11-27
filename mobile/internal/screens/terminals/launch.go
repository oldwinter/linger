package terminals

import (
	"context"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/herdr"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (s *Screen) openLaunchSheet() {
	s.mu.Lock()
	tpls := append([]herdr.TemplateInfo(nil), s.templates...)
	s.mu.Unlock()

	s.launchErr = ""
	s.launchBusy = false
	if len(tpls) > 0 {
		s.launchMode = 0
		if s.launchTemplate == "" {
			s.launchTemplate = tpls[0].Name
		}
	} else {
		s.launchMode = 1
	}
	if s.machineFilter != machineFilterAll && s.machineFilter != machineFilterLocal {
		s.launchMachine = s.machineFilter
	} else {
		s.launchMachine = ""
	}
	s.launchOpen = true
}

func (s *Screen) viewLaunchSheet(c *ui.Context, machines []herdr.MachineView) {
	t := c.Theme()
	ex := theme.Extra(t)
	m := layout.Of(c)

	mobile.Sheet(c, &s.launchOpen, mobile.SheetOptions{
		Detents: []float32{0.80, 0.94},
		Label:   i18n.T("terminals.launch.sheet_a11y"),
	}, func() {
		s.mu.Lock()
		tpls := append([]herdr.TemplateInfo(nil), s.templates...)
		s.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			layout.ReadableWrap(c, m.SheetMaxWidth, func() {
				ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(12).Children(func() {
					ui.Text(c, i18n.T("terminals.launch.sheet_title")).FontSize(18).Bold().LetterSpacing(-0.2).TextColor(t.Text)

					if s.launchErr != "" {
						components.ErrorInline(c, s.launchErr, nil)
					}

					if components.SegmentedControl(c, &s.launchMode,
						i18n.T("terminals.launch.mode_template"),
						i18n.T("terminals.launch.mode_command")) {
						components.HapticLight()
						s.launchErr = ""
					}

					if s.launchMode == 0 {
						ui.Text(c, i18n.T("terminals.launch.templates_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
						if len(tpls) == 0 {
							ui.Text(c, i18n.T("terminals.launch.templates_empty")).FontSize(13).LineHeight(1.35).TextColor(t.TextMuted)
						} else {
							ui.Column(c).FillWidth().Gap(7).Children(func() {
								for _, tpl := range tpls {
									tpl := tpl
									selected := s.launchTemplate == tpl.Name
									bg := ex.MutedBg
									borderCol := ex.SubtleBorder
									borderW := float32(0.75)
									if selected {
										bg = ex.BrandTint
										borderCol = ex.Brand
										borderW = 1.25
									}
									row := ui.Row(c.Key("tpl_"+tpl.Name)).FillWidth().MinHeight(54).Padding(10, 12).Radius(12).
										Background(bg).Border(borderW, borderCol).AlignItems(ui.Center).Gap(10).
										Role(ui.RoleButton).Label(tpl.Name).Checked(selected).Disabled(s.launchBusy)
									if !s.launchBusy && row.Pressed() {
										row.Scale(0.99, 0.99)
									}
									row.Children(func() {
										// Tactile radio/check indicator.
										if selected {
											ui.Row(c).Size(20, 20).Radius(10).Background(ex.Brand).
												AlignItems(ui.Center).Justify(ui.Center).Shrink(0).Children(func() {
												theme.IconBox(c, 12, ui.Hex("#FFFFFF"), theme.IconCheck)
											})
										} else {
											ui.Box(c).Size(20, 20).Radius(10).Background(t.Surface).
												Border(1.25, t.TextMuted.Alpha(0.55)).Shrink(0)
										}
										ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
											ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
												ui.Text(c, tpl.Name).FontSize(14.5).FontWeight(600).TextColor(t.Text).MaxLines(1)
												if tpl.Agent != "" {
													components.StatusPill(c, tpl.Agent, components.ToneInfo)
												}
											})
											if tpl.Description != "" {
												ui.Text(c, tpl.Description).FontSize(12).LineHeight(1.3).TextColor(t.TextMuted).MaxLines(2)
											}
											if strings.TrimSpace(tpl.Cwd) != "" {
												ui.Text(c, strings.TrimSpace(tpl.Cwd)).Font("monospace").FontSize(11).TextColor(t.TextMuted).MaxLines(1)
											}
										})
									})
									if row.Clicked() {
										components.HapticLight()
										s.launchTemplate = tpl.Name
										s.launchErr = ""
									}
								}
							})
						}
						components.FormField(c, i18n.T("terminals.launch.task_label"), i18n.T("terminals.launch.task_placeholder"), &s.launchTask, false).Disabled(s.launchBusy)
					} else {
						components.FormField(c, i18n.T("terminals.launch.cmd_label"), i18n.T("terminals.launch.cmd_placeholder"), &s.launchCommand, false).Disabled(s.launchBusy)
					}

					// Target machine selector (Local + remote SSH machines with online beacon dots).
					ui.Column(c).FillWidth().Gap(6).Children(func() {
						ui.Text(c, i18n.T("terminals.launch.machine_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
						ui.ScrollHorizontal(c).FillWidth().Children(func() {
							ui.Row(c).Gap(6).Padding(1, 1).Children(func() {
								renderMach := func(id, label string, remote, online bool) {
									on := s.launchMachine == id
									bg := t.Surface
									fg := t.TextMuted
									borderCol := ex.SubtleBorder
									if on {
										bg = t.Accent
										fg = t.AccentText
										borderCol = t.Accent
									}
									chip := ui.Row(c.Key("lm_"+id)).MinHeight(40).Padding(6, 12).Radius(999).
										Background(bg).Border(0.75, borderCol).AlignItems(ui.Center).Gap(5).Shrink(0).
										Role(ui.RoleButton).Label(label).Checked(on).Disabled(s.launchBusy)
									if !s.launchBusy && !on && chip.Pressed() {
										chip.Background(t.SurfacePressed)
									}
									chip.Children(func() {
										if remote {
											dot := t.Success
											if !online {
												dot = t.Warning
											}
											ui.Box(c).Size(6, 6).Radius(3).Background(dot).Shrink(0)
										}
										ui.Text(c, label).FontSize(12.5).FontWeight(600).TextColor(fg).NoWrap()
									})
									if chip.Clicked() && !on {
										components.HapticLight()
										s.launchMachine = id
									}
								}
								renderMach("", i18n.T("terminals.machine.local"), false, true)
								for _, mach := range machines {
									name := strings.TrimSpace(mach.Name)
									if name == "" || strings.EqualFold(name, "local") {
										continue
									}
									renderMach(name, name, true, mach.IsOnline())
								}
							})
						})
					})

					components.FormField(c, i18n.T("terminals.launch.cwd_label"), i18n.T("terminals.launch.cwd_placeholder"), &s.launchCwd, false).Disabled(s.launchBusy)
					components.FormField(c, i18n.T("terminals.launch.name_label"), i18n.T("terminals.launch.name_placeholder"), &s.launchName, false).Disabled(s.launchBusy)

					// Quiet smart-defaults summary pill confirming keep=true and linger.origin=mobile.
					ui.Row(c).FillWidth().Padding(8, 11).Radius(10).Background(ex.MutedBg).
						Border(0.75, ex.SubtleBorder).AlignItems(ui.Center).Gap(7).Children(func() {
						ui.Box(c).Size(6, 6).Radius(3).Background(t.Success).Shrink(0)
						ui.Text(c, i18n.T("terminals.launch.defaults_hint")).FontSize(11.5).FontWeight(500).TextColor(t.TextMuted).Grow(1).Basis(0)
					})

					btnLbl := i18n.T("terminals.launch_btn")
					if s.launchBusy {
						btnLbl = i18n.T("terminals.launching")
					}
					submitBtn := components.PrimaryTouchButton(c, btnLbl, s.launchBusy)
					submitBtn.FillWidth()
					if submitBtn.Clicked() {
						s.submitLaunch()
					}
				})
			})
		})
	})
}

func (s *Screen) submitLaunch() {
	if s.launchBusy {
		return
	}
	req := herdr.LaunchRequest{
		Cwd:  strings.TrimSpace(s.launchCwd),
		On:   strings.TrimSpace(s.launchMachine),
		Name: strings.TrimSpace(s.launchName),
		Keep: true,
		Labels: map[string]string{
			"linger.origin": "mobile",
		},
	}
	if s.launchMode == 0 {
		if strings.TrimSpace(s.launchTemplate) == "" {
			components.HapticWarning()
			s.launchErr = i18n.T("terminals.launch.err_select_template")
			return
		}
		req.Template = strings.TrimSpace(s.launchTemplate)
		req.Task = strings.TrimSpace(s.launchTask)
	} else {
		cmd := strings.TrimSpace(s.launchCommand)
		if cmd == "" {
			components.HapticWarning()
			s.launchErr = i18n.T("terminals.launch.err_enter_command")
			return
		}
		req.Line = cmd
	}

	cl, _, _ := s.activeClient()
	if cl == nil {
		components.HapticWarning()
		s.launchErr = presentHerdrError(herdr.ErrNotConnected)
		return
	}

	s.launchBusy = true
	s.launchErr = ""
	components.HapticLight()

	go func() {
		launched, err := cl.Launch(context.Background(), req)
		if err != nil {
			components.HapticWarning()
			msg := presentHerdrError(err)
			s.enqueueUI(func() {
				s.launchBusy = false
				s.launchErr = msg
			})
			return
		}
		components.HapticSuccess()
		if launched.Address != "" {
			s.mu.Lock()
			s.upsertTerminalLocked(launched)
			s.mu.Unlock()
		}
		s.enqueueUI(func() {
			s.launchBusy = false
			s.launchOpen = false
			s.launchTask = ""
			s.launchCommand = ""
			s.launchName = ""
			if launched.Address != "" {
				s.enterDetail(launched.Address)
			}
		})
		s.toast(i18n.Tf("terminals.toast.launched", map[string]any{"name": launched.DisplayName()}))
		s.Refresh(context.Background())
	}()
}
