package terminals

import (
	"context"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/herdr"
	"github.com/oldwinter/linger/mobile/internal/i18n"
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
	mobile.Sheet(c, &s.launchOpen, mobile.SheetOptions{
		Detents: []float32{0.78, 0.94},
		Label:   i18n.T("terminals.launch.sheet_a11y"),
	}, func() {
		s.mu.Lock()
		tpls := append([]herdr.TemplateInfo(nil), s.templates...)
		s.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, i18n.T("terminals.launch.sheet_title")).FontSize(18).Bold().TextColor(t.Text)

				if s.launchErr != "" {
					components.ErrorInline(c, s.launchErr, nil)
				}

				components.SegmentedControl(c, &s.launchMode,
					i18n.T("terminals.launch.mode_template"),
					i18n.T("terminals.launch.mode_command"))

				if s.launchMode == 0 {
					ui.Text(c, i18n.T("terminals.launch.templates_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					if len(tpls) == 0 {
						ui.Text(c, i18n.T("terminals.launch.templates_empty")).FontSize(13).LineHeight(1.35).TextColor(t.TextMuted)
					} else {
						ui.Column(c).FillWidth().Gap(6).Children(func() {
							for _, tpl := range tpls {
								tpl := tpl
								selected := s.launchTemplate == tpl.Name
								bg := ex.MutedBg
								borderCol := ex.SubtleBorder
								if selected {
									bg = ex.BrandTint
									borderCol = ex.Brand
								}
								row := ui.Column(c.Key("tpl_"+tpl.Name)).FillWidth().Padding(10, 12).Radius(12).
									Background(bg).Border(0.75, borderCol).Gap(2).
									Role(ui.RoleButton).Label(tpl.Name).Checked(selected)
								row.Children(func() {
									ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
										ui.Text(c, tpl.Name).FontSize(14).FontWeight(600).TextColor(t.Text)
										if tpl.Agent != "" {
											components.StatusPill(c, tpl.Agent, components.ToneInfo)
										}
									})
									if tpl.Description != "" {
										ui.Text(c, tpl.Description).FontSize(12).TextColor(t.TextMuted).MaxLines(2)
									}
								})
								if row.Clicked() {
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

				// Target machine selector (Local + remote SSH machines).
				ui.Column(c).FillWidth().Gap(6).Children(func() {
					ui.Text(c, i18n.T("terminals.launch.machine_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.ScrollHorizontal(c).FillWidth().Children(func() {
						ui.Row(c).Gap(6).Children(func() {
							renderMach := func(id, label string) {
								on := s.launchMachine == id
								bg := t.Surface
								fg := t.TextMuted
								borderCol := ex.SubtleBorder
								if on {
									bg = t.Accent
									fg = t.AccentText
									borderCol = t.Accent
								}
								chip := ui.Row(c.Key("lm_"+id)).MinHeight(34).Padding(5, 11).Radius(999).
									Background(bg).Border(0.75, borderCol).AlignItems(ui.Center).Shrink(0).
									Role(ui.RoleButton).Label(label).Checked(on).Disabled(s.launchBusy)
								chip.Children(func() {
									ui.Text(c, label).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
								})
								if chip.Clicked() {
									s.launchMachine = id
								}
							}
							renderMach("", i18n.T("terminals.machine.local"))
							for _, m := range machines {
								name := strings.TrimSpace(m.Name)
								if name == "" || strings.EqualFold(name, "local") {
									continue
								}
								renderMach(name, name)
							}
						})
					})
				})

				components.FormField(c, i18n.T("terminals.launch.cwd_label"), i18n.T("terminals.launch.cwd_placeholder"), &s.launchCwd, false).Disabled(s.launchBusy)
				components.FormField(c, i18n.T("terminals.launch.name_label"), i18n.T("terminals.launch.name_placeholder"), &s.launchName, false).Disabled(s.launchBusy)

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
			s.launchErr = i18n.T("terminals.launch.err_select_template")
			return
		}
		req.Template = strings.TrimSpace(s.launchTemplate)
		req.Task = strings.TrimSpace(s.launchTask)
	} else {
		cmd := strings.TrimSpace(s.launchCommand)
		if cmd == "" {
			s.launchErr = i18n.T("terminals.launch.err_enter_command")
			return
		}
		req.Line = cmd
	}

	cl, _, _ := s.activeClient()
	if cl == nil {
		s.launchErr = herdr.ErrNotConnected.Error()
		return
	}

	s.launchBusy = true
	s.launchErr = ""
	components.HapticLight()

	go func() {
		launched, err := cl.Launch(context.Background(), req)
		if err != nil {
			s.enqueueUI(func() {
				s.launchBusy = false
				s.launchErr = err.Error()
			})
			return
		}
		components.HapticSuccess()
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
