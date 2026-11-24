package work

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

type uiRoutineTime struct {
	at time.Time
}

var (
	routineKindLabels  = []string{"Daily", "Weekly", "Every N Hours", "Every N Minutes", "Once"}
	routineKindValues  = []string{"daily", "weekly", "every_n_hours", "every_n_minutes", "once"}
	routineHoursItems  = []string{"00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"}
	routineMinItems    = []string{"00", "10", "20", "30", "40", "50"}
	routineIntvItems   = []string{"1", "2", "4", "6", "12", "24"}
	routineMinIntvOpts = []string{"10", "20", "30", "40", "50"}
	routineTZItems     = []string{"UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Shanghai"}
	weekdayShortLabels = []string{"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
	weekdayAPIValues   = []string{"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
)

func (s *Screen) initRoutineDefaults() {
	s.routineFormTime = uiRoutineTime{at: time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC)}
	s.routineWeekdays[0] = true
}

func (s *Screen) viewRoutinesSegment(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	routines := append([]api.Routine(nil), s.routines...)
	rooms := append([]api.RoomListItem(nil), s.rooms...)
	s.mu.Unlock()

	filtered := make([]api.Routine, 0, len(routines))
	for _, rt := range routines {
		if s.routineRoomFilter == "" || rt.RoomID == s.routineRoomFilter {
			filtered = append(filtered, rt)
		}
	}

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SegmentRoutines]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
			if s.routineError != "" {
				components.StatusBanner(c, components.ToneDanger, s.routineError, "Dismiss", func() {
					s.routineError = ""
				})
			}

			// Room filter bar + "+ Routine" CTA
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				ui.ScrollHorizontal(c).Grow(1).Basis(0).Children(func() {
					ui.Row(c).Gap(6).Role(ui.RoleTabList).Children(func() {
						allOn := s.routineRoomFilter == ""
						allChip := ui.Row(c.Key("all")).MinHeight(36).PaddingX(12).Radius(999).
							Background(func() ui.Color {
								if allOn {
									return t.Accent
								}
								return theme.Extra(t).MutedBg
							}()).AlignItems(ui.Center).Shrink(0).Role(ui.RoleTab).Label("All Rooms").Checked(allOn)
						allChip.Children(func() {
							fg := t.TextMuted
							if allOn {
								fg = t.AccentText
							}
							ui.Text(c, "All Rooms").FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
						})
						if allChip.Clicked() {
							s.routineRoomFilter = ""
						}

						for _, rm := range rooms {
							rm := rm
							on := s.routineRoomFilter == rm.ID
							chip := ui.Row(c.Key(rm.ID)).MinHeight(36).PaddingX(12).Radius(999).
								Background(func() ui.Color {
									if on {
										return t.Accent
									}
									return theme.Extra(t).MutedBg
								}()).AlignItems(ui.Center).Shrink(0).Role(ui.RoleTab).Label(rm.Name).Checked(on)
							chip.Children(func() {
								fg := t.TextMuted
								if on {
									fg = t.AccentText
								}
								ui.Text(c, rm.Name).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
							})
							if chip.Clicked() {
								s.routineRoomFilter = rm.ID
							}
						}
					})
				})
				newBtn := components.PrimaryTouchButton(c, "+ Routine", false)
				newBtn.Shrink(0)
				if newBtn.Clicked() {
					s.openNewRoutineSheet(rooms)
				}
			})

			if len(filtered) == 0 {
				components.EmptyState(c, theme.IconLive, "No Routines",
					"Schedule recurring prompts or digests for any Room.",
					"Create Routine", func() {
						s.openNewRoutineSheet(rooms)
					})
				return
			}

			for _, rt := range filtered {
				rt := rt
				rowBusy := s.routineBusyID == rt.ID
				runBusy := s.routineRunBusyID == rt.ID
				ui.Column(c.Key(rt.ID)).FillWidth().Padding(12, 12).Gap(8).
					Radius(12).Background(t.Surface).Border(1, t.Border).Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, rt.Name).FontSize(15).FontWeight(600).TextColor(t.Text).MaxLines(2)
							ui.Text(c, s.roomName(rt.RoomID)+" · "+formatRoutineCadence(rt)).
								FontSize(12).TextColor(t.TextMuted).MaxLines(2)
						})
						enabled := rt.Enabled
						sw := mobile.Switch(c, &enabled).Label("Enable " + rt.Name).Disabled(rowBusy)
						if sw.Changed() {
							s.toggleRoutineEnabled(rt, enabled)
						}
					})

					if strings.TrimSpace(rt.Instruction) != "" {
						ui.Text(c, rt.Instruction).FontSize(12).TextColor(t.TextMuted).MaxLines(3)
					}

					ui.Row(c).FillWidth().Wrap().Gap(6).AlignItems(ui.Center).Children(func() {
						if rt.Enabled {
							components.StatusPill(c, "Enabled", components.ToneSuccess)
						} else {
							components.StatusPill(c, "Paused", components.ToneNeutral)
						}
						if rt.NextRunAt != nil {
							components.StatusPill(c, "Next: "+rt.NextRunAt.UTC().Format("Jan 2 15:04 UTC"), components.ToneInfo)
						}
						components.StatusPill(c, "Updated "+rt.UpdatedAt.UTC().Format("15:04"), components.ToneNeutral)
					})

					ui.Row(c).FillWidth().Gap(8).Children(func() {
						runLabel := "Run Now"
						if runBusy {
							runLabel = "Running..."
						}
						runBtn := components.PrimaryTouchButton(c, runLabel, runBusy || rowBusy)
						runBtn.Grow(1).Basis(0)
						if runBtn.Clicked() {
							mygo.Haptics.Light()
							s.runRoutineNow(rt)
						}
						editBtn := components.SecondaryTouchButton(c, "Edit", rowBusy)
						editBtn.Grow(1).Basis(0)
						if editBtn.Clicked() {
							s.openEditRoutineSheet(rt)
						}
						delBtn := components.DangerTouchButton(c, "Delete", rowBusy)
						if delBtn.Clicked() {
							cp := rt
							s.routineDeleteItem = &cp
							s.routineDeleteSheet = true
						}
					})
				})
			}
		})
	})
}

func (s *Screen) openNewRoutineSheet(rooms []api.RoomListItem) {
	s.routineEditingID = ""
	s.routineEditingRev = 0
	s.routineSaveErr = ""
	s.routineSaving = false
	s.routineFormName = ""
	s.routineFormInstr = ""
	s.routineFormKind = 0
	s.routineFormHourIdx = 9
	s.routineFormMinIdx = 0
	s.routineFormIntvIdx = 1
	s.routineFormTZIdx = 0
	s.initRoutineDefaults()
	if s.routineRoomFilter != "" {
		s.routineFormRoomID = s.routineRoomFilter
	} else if len(rooms) > 0 {
		s.routineFormRoomID = rooms[0].ID
	}
	s.routineSheetOpen = true
}

func (s *Screen) openEditRoutineSheet(rt api.Routine) {
	s.routineEditingID = rt.ID
	s.routineEditingRev = rt.Revision
	s.routineFormRoomID = rt.RoomID
	s.routineFormName = rt.Name
	s.routineFormInstr = rt.Instruction
	s.routineSaveErr = ""
	s.routineSaving = false

	var cad api.RoutineCadence
	if len(rt.Cadence) > 0 && json.Unmarshal(rt.Cadence, &cad) == nil {
		for i, kv := range routineKindValues {
			if kv == cad.Kind {
				s.routineFormKind = i
				break
			}
		}
		if cad.Hour != nil && *cad.Hour >= 0 && *cad.Hour < 24 {
			s.routineFormHourIdx = *cad.Hour
			s.routineFormTime.at = time.Date(2026, 11, 24, *cad.Hour, 0, 0, 0, time.UTC)
		}
		if cad.Minute != nil {
			idx := (*cad.Minute) / 10
			if idx >= 0 && idx < len(routineMinItems) {
				s.routineFormMinIdx = idx
			}
			s.routineFormTime.at = time.Date(2026, 11, 24, s.routineFormTime.at.Hour(), *cad.Minute, 0, 0, time.UTC)
		}
		if cad.RunAt != nil {
			s.routineFormTime.at = *cad.RunAt
		}
		for i, tz := range routineTZItems {
			if tz == cad.Timezone {
				s.routineFormTZIdx = i
				break
			}
		}
		s.routineWeekdays = [7]bool{}
		for _, wd := range cad.Weekdays {
			for i, v := range weekdayAPIValues {
				if v == wd {
					s.routineWeekdays[i] = true
				}
			}
		}
	}
	s.routineSheetOpen = true
}

// OpenRoutineEditorForTest exposes opening a routine edit sheet for deterministic tests.
func (s *Screen) OpenRoutineEditorForTest(rt api.Routine) {
	s.openEditRoutineSheet(rt)
}

func (s *Screen) viewRoutineFormSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.routineSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.92},
		Label:   "Routine Schedule",
	}, func() {
		s.mu.Lock()
		rooms := append([]api.RoomListItem(nil), s.rooms...)
		s.mu.Unlock()

		ui.Column(c).Fill().Children(func() {
			ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				heading := "Create Routine"
				if s.routineEditingID != "" {
					heading = "Edit Routine"
				}
				ui.Text(c, heading).FontSize(18).Bold().TextColor(t.Text)

				if s.routineSaveErr != "" {
					components.StatusBanner(c, components.ToneDanger, s.routineSaveErr, "Dismiss", func() {
						s.routineSaveErr = ""
					})
				}

				if s.routineEditingID == "" && len(rooms) > 0 {
					ui.Text(c, "Target Room").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.ScrollHorizontal(c).FillWidth().Children(func() {
						ui.Row(c).Gap(6).Children(func() {
							for _, rm := range rooms {
								rm := rm
								on := s.routineFormRoomID == rm.ID
								bg := theme.Extra(t).MutedBg
								fg := t.TextMuted
								if on {
									bg = t.Accent
									fg = t.AccentText
								}
								chip := ui.Row(c.Key(rm.ID)).MinHeight(36).PaddingX(12).Radius(999).Background(bg).
									AlignItems(ui.Center).Shrink(0).Role(ui.RoleTab).Label("Room " + rm.Name).Checked(on).Disabled(s.routineSaving)
								chip.Children(func() {
									ui.Text(c, rm.Name).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
								})
								if chip.Clicked() && !s.routineSaving {
									s.routineFormRoomID = rm.ID
								}
							}
						})
					})
				}

				components.FormField(c, "Title", "Morning Standup Digest", &s.routineFormName, false).Disabled(s.routineSaving)

				ui.Column(c).FillWidth().Gap(4).Children(func() {
					ui.Text(c, "Instructions").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.TextArea(c, &s.routineFormInstr).FillWidth().MinHeight(82).
						Placeholder("What should the agent do on each run?").
						Label("Routine Instructions").Disabled(s.routineSaving)
				})

				ui.Text(c, "Cadence").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				mobile.Wheel(c, &s.routineFormKind, routineKindLabels).Label("Cadence Type").Disabled(s.routineSaving)

				kind := routineKindValues[s.routineFormKind%len(routineKindValues)]
				switch kind {
				case "daily", "weekly":
					if kind == "weekly" {
						ui.Text(c, "Weekdays").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
						ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
							for i, lbl := range weekdayShortLabels {
								on := s.routineWeekdays[i]
								bg := theme.Extra(t).MutedBg
								fg := t.TextMuted
								if on {
									bg = t.Accent
									fg = t.AccentText
								}
								chip := ui.Row(c.Key(i)).MinHeight(36).PaddingX(10).Radius(8).Background(bg).
									AlignItems(ui.Center).Role(ui.RoleCheckBox).Label(lbl).Checked(on).Disabled(s.routineSaving)
								chip.Children(func() {
									ui.Text(c, lbl).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
								})
								if chip.Clicked() && !s.routineSaving {
									s.routineWeekdays[i] = !s.routineWeekdays[i]
								}
							}
						})
					}
					ui.Text(c, "Time of Day").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					tp := mobile.TimePicker(c, &s.routineFormTime.at).Label("Routine Time").Disabled(s.routineSaving)
					if tp.Changed() {
						s.routineFormHourIdx = s.routineFormTime.at.Hour()
						s.routineFormMinIdx = s.routineFormTime.at.Minute() / 10
					}
				case "every_n_hours":
					ui.Text(c, "Repeat Every (Hours)").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					mobile.Wheel(c, &s.routineFormIntvIdx, routineIntvItems).Label("Interval Hours").Disabled(s.routineSaving)
				case "every_n_minutes":
					ui.Text(c, "Repeat Every (Minutes)").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					mobile.Wheel(c, &s.routineFormMinIdx, routineMinIntvOpts).Label("Interval Minutes").Disabled(s.routineSaving)
				case "once":
					ui.Text(c, "Run Date & Time").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					mobile.DatePicker(c, &s.routineFormTime.at).Label("Routine Date").Disabled(s.routineSaving)
					mobile.TimePicker(c, &s.routineFormTime.at).Label("Routine Time").Disabled(s.routineSaving)
				}

				ui.Text(c, "Timezone").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				mobile.Wheel(c, &s.routineFormTZIdx, routineTZItems).Label("Timezone").Disabled(s.routineSaving)
			})
		})
		ui.Divider(c)
		ui.Column(c).FillWidth().Padding(10, 16, 18, 16).Shrink(0).Children(func() {
			saveLabel := "Save Routine"
			if s.routineSaving {
				saveLabel = "Saving..."
			}
			disabled := s.routineSaving || strings.TrimSpace(s.routineFormName) == "" || strings.TrimSpace(s.routineFormInstr) == ""
			saveBtn := components.PrimaryTouchButton(c, saveLabel, disabled)
			saveBtn.FillWidth()
			if saveBtn.Clicked() {
				s.submitRoutineForm()
			}
		})
		})
	})
}

func (s *Screen) buildRoutineCadenceFromForm() api.RoutineCadence {
	kind := routineKindValues[s.routineFormKind%len(routineKindValues)]
	tz := routineTZItems[s.routineFormTZIdx%len(routineTZItems)]
	cad := api.RoutineCadence{
		Kind:     kind,
		Timezone: tz,
	}
	switch kind {
	case "daily", "weekly":
		h := s.routineFormTime.at.Hour()
		m := s.routineFormTime.at.Minute()
		cad.Hour = &h
		cad.Minute = &m
		if kind == "weekly" {
			var days []string
			for i, on := range s.routineWeekdays {
				if on {
					days = append(days, weekdayAPIValues[i])
				}
			}
			if len(days) == 0 {
				days = []string{"monday"}
			}
			cad.Weekdays = days
		}
	case "every_n_hours":
		hoursList := []int{1, 2, 4, 6, 12, 24}
		h := hoursList[s.routineFormIntvIdx%len(hoursList)]
		cad.IntervalHours = &h
	case "every_n_minutes":
		minsList := []int{10, 20, 30, 40, 50}
		m := minsList[s.routineFormMinIdx%len(minsList)]
		cad.IntervalMinutes = &m
	case "once":
		t := s.routineFormTime.at.UTC()
		cad.RunAt = &t
	}
	return cad
}

func (s *Screen) submitRoutineForm() {
	if s.routineSaving {
		return
	}
	client := s.client()
	if client == nil {
		s.routineSaveErr = "Connect to a host before saving Routines."
		return
	}
	name := strings.TrimSpace(s.routineFormName)
	instr := strings.TrimSpace(s.routineFormInstr)
	if name == "" || instr == "" {
		s.routineSaveErr = "Title and instructions are required."
		return
	}
	editingID := s.routineEditingID
	editingRev := s.routineEditingRev
	roomID := s.routineFormRoomID
	if roomID == "" {
		s.mu.Lock()
		if len(s.rooms) > 0 {
			roomID = s.rooms[0].ID
		}
		s.mu.Unlock()
	}
	cadence := s.buildRoutineCadenceFromForm()

	s.routineSaving = true
	s.routineSaveErr = ""

	go func() {
		var saved api.Routine
		var err error
		if editingID == "" {
			saved, err = client.CreateRoomRoutineTyped(context.Background(), roomID, api.RoutineCreateInput{
				Name:        name,
				Instruction: instr,
				Cadence:     cadence,
			})
		} else {
			saved, err = client.UpdateRoutineTyped(context.Background(), editingID, api.RoutineUpdateInput{
				ExpectedRevision: editingRev,
				Name:             &name,
				Instruction:      &instr,
				Cadence:          &cadence,
			})
		}
		if err != nil {
			s.enqueueUI(func() {
				s.routineSaving = false
				s.routineSaveErr = err.Error()
			})
			return
		}
		s.replaceRoutine(saved)
		s.enqueueUI(func() {
			s.routineSaving = false
			s.routineSaveErr = ""
			s.routineSheetOpen = false
			s.toast("Routine saved")
		})
	}()
}

func (s *Screen) toggleRoutineEnabled(rt api.Routine, enabled bool) {
	client := s.client()
	if client == nil || s.routineBusyID != "" {
		return
	}
	s.routineBusyID = rt.ID
	s.routineError = ""
	go func() {
		updated, err := client.UpdateRoutineTyped(context.Background(), rt.ID, api.RoutineUpdateInput{
			ExpectedRevision: rt.Revision,
			Enabled:          &enabled,
		})
		s.enqueueUI(func() {
			s.routineBusyID = ""
			if err != nil {
				s.routineError = err.Error()
				return
			}
			s.replaceRoutine(updated)
		})
	}()
}

func (s *Screen) runRoutineNow(rt api.Routine) {
	client := s.client()
	if client == nil || s.routineRunBusyID != "" {
		return
	}
	s.routineRunBusyID = rt.ID
	s.routineError = ""
	go func() {
		updated, err := client.RunRoutineNowTyped(context.Background(), rt.ID)
		s.enqueueUI(func() {
			s.routineRunBusyID = ""
			if err != nil {
				s.routineError = err.Error()
				return
			}
			s.replaceRoutine(updated)
			s.toast("Triggered " + rt.Name)
		})
	}()
}

func (s *Screen) viewRoutineDeleteActionSheet(c *ui.Context) {
	rt := s.routineDeleteItem
	if rt == nil {
		s.routineDeleteSheet = false
		return
	}
	mobile.ActionSheet(c, &s.routineDeleteSheet, mobile.ActionSheetOptions{
		Title:   "Delete Routine?",
		Message: rt.Name + " will stop running.",
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Delete Routine",
		Destructive: true,
		OnTap: func() {
			s.deleteRoutine(*rt)
		},
	})
}

func (s *Screen) deleteRoutine(rt api.Routine) {
	client := s.client()
	if client == nil {
		return
	}
	s.routineBusyID = rt.ID
	s.routineError = ""
	go func() {
		err := client.DeleteRoutineWithRevision(context.Background(), rt.ID, rt.Revision)
		s.enqueueUI(func() {
			s.routineBusyID = ""
			if err != nil {
				s.routineError = err.Error()
				return
			}
			s.mu.Lock()
			var filtered []api.Routine
			for _, item := range s.routines {
				if item.ID != rt.ID {
					filtered = append(filtered, item)
				}
			}
			s.routines = filtered
			s.mu.Unlock()
			s.routineDeleteItem = nil
			s.toast("Routine deleted")
		})
	}()
}

func (s *Screen) replaceRoutine(rt api.Routine) {
	s.mu.Lock()
	found := false
	for i := range s.routines {
		if s.routines[i].ID == rt.ID {
			s.routines[i] = rt
			found = true
			break
		}
	}
	if !found {
		s.routines = append([]api.Routine{rt}, s.routines...)
	}
	s.mu.Unlock()
	if cs := s.cacheStore(); cs != nil {
		_ = cs.UpsertRoutines(context.Background(), []api.Routine{rt})
	}
}

func formatRoutineCadence(rt api.Routine) string {
	if len(rt.Listener) > 0 && string(rt.Listener) != "null" {
		return "App listener"
	}
	var cad api.RoutineCadence
	if len(rt.Cadence) == 0 || json.Unmarshal(rt.Cadence, &cad) != nil {
		return "Custom schedule"
	}
	hh, mm := 9, 0
	if cad.Hour != nil {
		hh = *cad.Hour
	}
	if cad.Minute != nil {
		mm = *cad.Minute
	}
	switch cad.Kind {
	case "daily":
		return fmt.Sprintf("Daily at %02d:%02d %s", hh, mm, cad.Timezone)
	case "weekly":
		return fmt.Sprintf("Weekly (%s) at %02d:%02d", strings.Join(cad.Weekdays, ", "), hh, mm)
	case "every_n_hours":
		if cad.IntervalHours != nil {
			return fmt.Sprintf("Every %d hours", *cad.IntervalHours)
		}
		return "Hourly"
	case "every_n_minutes":
		if cad.IntervalMinutes != nil {
			return fmt.Sprintf("Every %d minutes", *cad.IntervalMinutes)
		}
		return "Minutes interval"
	case "once":
		if cad.RunAt != nil {
			return "Once at " + cad.RunAt.UTC().Format("Jan 2 15:04 UTC")
		}
		return "One-time"
	default:
		return "Scheduled"
	}
}
