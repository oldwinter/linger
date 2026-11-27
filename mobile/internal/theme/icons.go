package theme

import "github.com/egoist/mygo/ui"

// IconFunc draws a crisp 24x24-proportioned vector icon inside rect r using color.
type IconFunc func(p *ui.Painter, r ui.Rect, color ui.Color)

func iconStrokeWidth(r ui.Rect) float32 {
	w := r.W * 0.075
	if w < 1.45 {
		return 1.45
	}
	if w > 2.2 {
		return 2.2
	}
	return w
}

// IconBrandMark draws the signature LingerX sculpted obsidian squircle, ivory curve, and solar marigold orb.
func IconBrandMark(p *ui.Painter, r ui.Rect, _ ui.Color) {
	rad := r.W * 0.24
	p.Fill(r, ui.Hex("#161614"), rad)
	p.Stroke(r, ui.RGBA(255, 252, 242, 0.14), rad, 1)

	// Sculpted ivory L-curve matching mobile/resources/icon.png.
	var curve ui.Path
	x0 := r.X + r.W*0.23
	y0 := r.Y + r.H*0.23
	x1 := r.X + r.W*0.77
	y1 := r.Y + r.H*0.77
	topW := r.W * 0.14
	botH := r.H * 0.14
	cr := r.W * 0.06
	curve.MoveTo(x0, y0+cr).
		QuadTo(x0, y0, x0+cr, y0).
		LineTo(x0+topW, y0).
		QuadTo(x0+topW+r.W*0.04, y1-botH-r.H*0.04, x1, y1-botH).
		LineTo(x1, y1-cr).
		QuadTo(x1, y1, x1-cr, y1).
		LineTo(x0+cr, y1).
		QuadTo(x0, y1, x0, y1-cr).
		Close()
	p.FillPath(&curve, ui.Hex("#F5F4EE"))

	// Radiant solar marigold orb.
	orbD := r.W * 0.22
	orbX := r.X + r.W*0.58 - orbD/2
	orbY := r.Y + r.H*0.42 - orbD/2
	p.Fill(ui.Rect{X: orbX, Y: orbY, W: orbD, H: orbD}, ui.Hex("#F5A442"), orbD/2)
}

// IconRooms draws an editorial rounded chat bubble icon for the Rooms tab.
func IconRooms(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	box := ui.Rect{X: r.X + r.W*0.13, Y: r.Y + r.H*0.16, W: r.W * 0.74, H: r.H * 0.56}
	p.Stroke(box, color, r.W*0.20, sw)
	var tail ui.Path
	tail.Cap(ui.RoundCap).Join(ui.RoundJoin)
	tail.MoveTo(r.X+r.W*0.28, r.Y+r.H*0.72).
		LineTo(r.X+r.W*0.20, r.Y+r.H*0.86).
		LineTo(r.X+r.W*0.43, r.Y+r.H*0.72)
	p.StrokePath(&tail, sw, color)
}

// IconRoomsActive draws a duotone filled chat bubble icon for the active Rooms tab.
func IconRoomsActive(p *ui.Painter, r ui.Rect, color ui.Color) {
	box := ui.Rect{X: r.X + r.W*0.13, Y: r.Y + r.H*0.16, W: r.W * 0.74, H: r.H * 0.56}
	p.Fill(box, color.Alpha(0.16), r.W*0.20)
	IconRooms(p, r, color)
	sw := iconStrokeWidth(r)
	p.Line(r.X+r.W*0.30, r.Y+r.H*0.38, r.X+r.W*0.70, r.Y+r.H*0.38, sw*0.9, color)
	p.Line(r.X+r.W*0.30, r.Y+r.H*0.52, r.X+r.W*0.54, r.Y+r.H*0.52, sw*0.9, color)
}

// IconLive draws an activity pulse waveform icon for the Live tab.
func IconLive(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var path ui.Path
	path.Cap(ui.RoundCap).Join(ui.RoundJoin)
	path.MoveTo(r.X+r.W*0.10, r.Y+r.H*0.52).
		LineTo(r.X+r.W*0.28, r.Y+r.H*0.52).
		LineTo(r.X+r.W*0.41, r.Y+r.H*0.20).
		LineTo(r.X+r.W*0.57, r.Y+r.H*0.80).
		LineTo(r.X+r.W*0.70, r.Y+r.H*0.44).
		LineTo(r.X+r.W*0.90, r.Y+r.H*0.44)
	p.StrokePath(&path, sw, color)
}

// IconLiveActive draws a highlighted pulse waveform with a solar beacon dot for the active Live tab.
func IconLiveActive(p *ui.Painter, r ui.Rect, color ui.Color) {
	p.Fill(ui.Rect{X: r.X + r.W*0.12, Y: r.Y + r.H*0.16, W: r.W * 0.76, H: r.H * 0.68}, color.Alpha(0.12), r.W*0.22)
	IconLive(p, r, color)
	dot := r.W * 0.16
	p.Fill(ui.Rect{X: r.X + r.W*0.82 - dot/2, Y: r.Y + r.H*0.24 - dot/2, W: dot, H: dot}, ui.Hex("#E58A28"), dot/2)
}

// IconWork draws a refined rounded checklist card icon for the Work tab.
func IconWork(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	frame := ui.Rect{X: r.X + r.W*0.16, Y: r.Y + r.H*0.14, W: r.W * 0.68, H: r.H * 0.72}
	p.Stroke(frame, color, r.W*0.16, sw)
	p.Line(r.X+r.W*0.32, r.Y+r.H*0.38, r.X+r.W*0.68, r.Y+r.H*0.38, sw, color)
	p.Line(r.X+r.W*0.32, r.Y+r.H*0.54, r.X+r.W*0.68, r.Y+r.H*0.54, sw, color)
	p.Line(r.X+r.W*0.32, r.Y+r.H*0.69, r.X+r.W*0.52, r.Y+r.H*0.69, sw, color)
}

// IconWorkActive draws a duotone filled checklist icon for the active Work tab.
func IconWorkActive(p *ui.Painter, r ui.Rect, color ui.Color) {
	frame := ui.Rect{X: r.X + r.W*0.16, Y: r.Y + r.H*0.14, W: r.W * 0.68, H: r.H * 0.72}
	p.Fill(frame, color.Alpha(0.16), r.W*0.16)
	IconWork(p, r, color)
}

// IconLibrary draws a layered book/folio icon for the Library tab.
func IconLibrary(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	p.Stroke(ui.Rect{X: r.X + r.W*0.16, Y: r.Y + r.H*0.16, W: r.W * 0.52, H: r.H * 0.68}, color, r.W*0.12, sw)
	var spine ui.Path
	spine.Cap(ui.RoundCap).Join(ui.RoundJoin)
	spine.MoveTo(r.X+r.W*0.76, r.Y+r.H*0.26).
		LineTo(r.X+r.W*0.84, r.Y+r.H*0.26).
		LineTo(r.X+r.W*0.84, r.Y+r.H*0.84).
		LineTo(r.X+r.W*0.32, r.Y+r.H*0.84)
	p.StrokePath(&spine, sw, color)
}

// IconLibraryActive draws a duotone filled folio icon for the active Library tab.
func IconLibraryActive(p *ui.Painter, r ui.Rect, color ui.Color) {
	p.Fill(ui.Rect{X: r.X + r.W*0.16, Y: r.Y + r.H*0.16, W: r.W * 0.52, H: r.H * 0.68}, color.Alpha(0.16), r.W*0.12)
	IconLibrary(p, r, color)
}

// IconMore draws a four-squircle control grid icon for the More & Connect tab.
func IconMore(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	s := r.W * 0.28
	gap := r.W * 0.14
	x0 := r.X + (r.W-2*s-gap)/2
	y0 := r.Y + (r.H-2*s-gap)/2
	rad := s * 0.34
	p.Stroke(ui.Rect{X: x0, Y: y0, W: s, H: s}, color, rad, sw)
	p.Stroke(ui.Rect{X: x0 + s + gap, Y: y0, W: s, H: s}, color, rad, sw)
	p.Stroke(ui.Rect{X: x0, Y: y0 + s + gap, W: s, H: s}, color, rad, sw)
	p.Stroke(ui.Rect{X: x0 + s + gap, Y: y0 + s + gap, W: s, H: s}, color, rad, sw)
}

// IconMoreActive draws a duotone four-squircle icon with a solar orb accent for the active More tab.
func IconMoreActive(p *ui.Painter, r ui.Rect, color ui.Color) {
	s := r.W * 0.28
	gap := r.W * 0.14
	x0 := r.X + (r.W-2*s-gap)/2
	y0 := r.Y + (r.H-2*s-gap)/2
	rad := s * 0.34
	p.Fill(ui.Rect{X: x0, Y: y0, W: s, H: s}, color.Alpha(0.18), rad)
	p.Fill(ui.Rect{X: x0, Y: y0 + s + gap, W: s, H: s}, color.Alpha(0.18), rad)
	p.Fill(ui.Rect{X: x0 + s + gap, Y: y0 + s + gap, W: s, H: s}, color.Alpha(0.18), rad)
	IconMore(p, r, color)
	p.Fill(ui.Rect{X: x0 + s + gap, Y: y0, W: s, H: s}, ui.Hex("#E58A28"), s/2)
}

// IconShield draws a TLS security shield icon.
func IconShield(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var path ui.Path
	path.Cap(ui.RoundCap).Join(ui.RoundJoin)
	path.MoveTo(r.X+r.W*0.50, r.Y+r.H*0.10).
		LineTo(r.X+r.W*0.84, r.Y+r.H*0.24).
		LineTo(r.X+r.W*0.80, r.Y+r.H*0.58).
		LineTo(r.X+r.W*0.50, r.Y+r.H*0.90).
		LineTo(r.X+r.W*0.20, r.Y+r.H*0.58).
		LineTo(r.X+r.W*0.16, r.Y+r.H*0.24).
		Close()
	p.StrokePath(&path, sw, color)
}

// IconLock draws a padlock icon for biometric lock and TLS badges.
func IconLock(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	body := ui.Rect{X: r.X + r.W*0.20, Y: r.Y + r.H*0.46, W: r.W * 0.60, H: r.H * 0.42}
	p.Stroke(body, color, r.W*0.12, sw)
	var shackle ui.Path
	shackle.Cap(ui.RoundCap)
	shackle.MoveTo(r.X+r.W*0.32, r.Y+r.H*0.46).
		LineTo(r.X+r.W*0.32, r.Y+r.H*0.30).
		QuadTo(r.X+r.W*0.50, r.Y+r.H*0.12, r.X+r.W*0.68, r.Y+r.H*0.30).
		LineTo(r.X+r.W*0.68, r.Y+r.H*0.46)
	p.StrokePath(&shackle, sw, color)
}

// IconHost draws a desktop display + stand icon for Linger Desktop hosts.
func IconHost(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	p.Stroke(ui.Rect{X: r.X + r.W*0.12, Y: r.Y + r.H*0.18, W: r.W * 0.76, H: r.H * 0.50}, color, r.W*0.10, sw)
	p.Line(r.X+r.W*0.50, r.Y+r.H*0.68, r.X+r.W*0.50, r.Y+r.H*0.84, sw, color)
	p.Line(r.X+r.W*0.30, r.Y+r.H*0.84, r.X+r.W*0.70, r.Y+r.H*0.84, sw, color)
}

// IconRadar draws concentric wireless discovery arcs for LAN mDNS radar.
func IconRadar(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	cx := r.X + r.W*0.50
	cy := r.Y + r.H*0.50
	var c1, c2 ui.Path
	c1.Circle(cx, cy, r.W*0.38)
	c2.Circle(cx, cy, r.W*0.21)
	p.StrokePath(&c1, sw, color.Alpha(0.55))
	p.StrokePath(&c2, sw, color)
	dot := r.W * 0.14
	p.Fill(ui.Rect{X: cx - dot/2, Y: cy - dot/2, W: dot, H: dot}, color, dot/2)
}

// IconQR draws a stylized QR corner-finder icon.
func IconQR(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	s := r.W * 0.30
	p.Stroke(ui.Rect{X: r.X + r.W*0.14, Y: r.Y + r.H*0.14, W: s, H: s}, color, 2.5, sw)
	p.Stroke(ui.Rect{X: r.X + r.W*0.56, Y: r.Y + r.H*0.14, W: s, H: s}, color, 2.5, sw)
	p.Stroke(ui.Rect{X: r.X + r.W*0.14, Y: r.Y + r.H*0.56, W: s, H: s}, color, 2.5, sw)
	p.Fill(ui.Rect{X: r.X + r.W*0.58, Y: r.Y + r.H*0.58, W: r.W * 0.12, H: r.H * 0.12}, color, 1.5)
	p.Fill(ui.Rect{X: r.X + r.W*0.74, Y: r.Y + r.H*0.74, W: r.W * 0.12, H: r.H * 0.12}, color, 1.5)
}

// IconAlert draws an exclamation triangle icon.
func IconAlert(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var tri ui.Path
	tri.Cap(ui.RoundCap).Join(ui.RoundJoin)
	tri.MoveTo(r.X+r.W*0.50, r.Y+r.H*0.14).
		LineTo(r.X+r.W*0.88, r.Y+r.H*0.84).
		LineTo(r.X+r.W*0.12, r.Y+r.H*0.84).
		Close()
	p.StrokePath(&tri, sw, color)
	p.Line(r.X+r.W*0.50, r.Y+r.H*0.40, r.X+r.W*0.50, r.Y+r.H*0.62, sw, color)
	d := r.W * 0.10
	p.Fill(ui.Rect{X: r.X + r.W*0.50 - d/2, Y: r.Y + r.H*0.70, W: d, H: d}, color, d/2)
}

// IconCheck draws a crisp checkmark.
func IconCheck(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var path ui.Path
	path.Cap(ui.RoundCap).Join(ui.RoundJoin)
	path.MoveTo(r.X+r.W*0.18, r.Y+r.H*0.52).
		LineTo(r.X+r.W*0.42, r.Y+r.H*0.76).
		LineTo(r.X+r.W*0.84, r.Y+r.H*0.26)
	p.StrokePath(&path, sw, color)
}

// IconRefresh draws a circular reload icon.
func IconRefresh(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var c ui.Path
	c.Circle(r.X+r.W*0.50, r.Y+r.H*0.50, r.W*0.33)
	p.StrokePath(&c, sw, color)
	var arrow ui.Path
	arrow.Cap(ui.RoundCap).Join(ui.RoundJoin)
	arrow.MoveTo(r.X+r.W*0.72, r.Y+r.H*0.18).
		LineTo(r.X+r.W*0.86, r.Y+r.H*0.33).
		LineTo(r.X+r.W*0.66, r.Y+r.H*0.39)
	p.StrokePath(&arrow, sw, color)
}

// IconBack draws a left-pointing chevron for top-bar back navigation.
func IconBack(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var path ui.Path
	path.Cap(ui.RoundCap).Join(ui.RoundJoin)
	path.MoveTo(r.X+r.W*0.62, r.Y+r.H*0.20).
		LineTo(r.X+r.W*0.32, r.Y+r.H*0.50).
		LineTo(r.X+r.W*0.62, r.Y+r.H*0.80)
	p.StrokePath(&path, sw, color)
}

// IconChevronRight draws a subtle right disclosure chevron.
func IconChevronRight(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var path ui.Path
	path.Cap(ui.RoundCap).Join(ui.RoundJoin)
	path.MoveTo(r.X+r.W*0.38, r.Y+r.H*0.24).
		LineTo(r.X+r.W*0.64, r.Y+r.H*0.50).
		LineTo(r.X+r.W*0.38, r.Y+r.H*0.76)
	p.StrokePath(&path, sw, color)
}

// IconPlus draws a crisp geometric plus mark.
func IconPlus(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	p.Line(r.X+r.W*0.50, r.Y+r.H*0.22, r.X+r.W*0.50, r.Y+r.H*0.78, sw, color)
	p.Line(r.X+r.W*0.22, r.Y+r.H*0.50, r.X+r.W*0.78, r.Y+r.H*0.50, sw, color)
}

// IconSparkle draws a refined four-point editorial sparkle for Catch-Up and AI highlights.
func IconSparkle(p *ui.Painter, r ui.Rect, color ui.Color) {
	cx := r.X + r.W*0.50
	cy := r.Y + r.H*0.50
	var star ui.Path
	star.MoveTo(cx, r.Y+r.H*0.14).
		QuadTo(cx, cy, r.X+r.W*0.86, cy).
		QuadTo(cx, cy, cx, r.Y+r.H*0.86).
		QuadTo(cx, cy, r.X+r.W*0.14, cy).
		QuadTo(cx, cy, cx, r.Y+r.H*0.14).
		Close()
	p.FillPath(&star, color)
}

// IconSend draws an upward arrow icon for the chat composer send action.
func IconSend(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var arrow ui.Path
	arrow.Cap(ui.RoundCap).Join(ui.RoundJoin)
	arrow.MoveTo(r.X+r.W*0.26, r.Y+r.H*0.46).
		LineTo(r.X+r.W*0.50, r.Y+r.H*0.22).
		LineTo(r.X+r.W*0.74, r.Y+r.H*0.46)
	p.StrokePath(&arrow, sw, color)
	p.Line(r.X+r.W*0.50, r.Y+r.H*0.24, r.X+r.W*0.50, r.Y+r.H*0.78, sw, color)
}

// IconSliders draws a minimal 2-rail sliders icon for Room Inspector & Preferences.
func IconSliders(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	y1 := r.Y + r.H*0.34
	y2 := r.Y + r.H*0.66
	p.Line(r.X+r.W*0.16, y1, r.X+r.W*0.84, y1, sw, color)
	p.Line(r.X+r.W*0.16, y2, r.X+r.W*0.84, y2, sw, color)
	d := r.W * 0.18
	p.Fill(ui.Rect{X: r.X + r.W*0.36 - d/2, Y: y1 - d/2, W: d, H: d}, color, d/2)
	p.Fill(ui.Rect{X: r.X + r.W*0.64 - d/2, Y: y2 - d/2, W: d, H: d}, color, d/2)
}

// IconPin draws a subtle angled pin icon for pinned rooms.
func IconPin(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var head ui.Path
	head.Circle(r.X+r.W*0.56, r.Y+r.H*0.38, r.W*0.20)
	p.FillPath(&head, color)
	p.Line(r.X+r.W*0.42, r.Y+r.H*0.52, r.X+r.W*0.20, r.Y+r.H*0.82, sw, color)
}

// IconRule draws a subtle compass/diamond rule icon.
func IconRule(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var d ui.Path
	d.Cap(ui.RoundCap).Join(ui.RoundJoin)
	d.MoveTo(r.X+r.W*0.50, r.Y+r.H*0.14).
		LineTo(r.X+r.W*0.86, r.Y+r.H*0.50).
		LineTo(r.X+r.W*0.50, r.Y+r.H*0.86).
		LineTo(r.X+r.W*0.14, r.Y+r.H*0.50).
		Close()
	p.StrokePath(&d, sw, color)
	dot := r.W * 0.16
	p.Fill(ui.Rect{X: r.X + r.W*0.50 - dot/2, Y: r.Y + r.H*0.50 - dot/2, W: dot, H: dot}, color, dot/2)
}

// IconUser draws a minimal user silhouette icon for Profile.
func IconUser(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var head ui.Path
	head.Circle(r.X+r.W*0.50, r.Y+r.H*0.33, r.W*0.18)
	p.StrokePath(&head, sw, color)
	var body ui.Path
	body.Cap(ui.RoundCap)
	body.MoveTo(r.X+r.W*0.20, r.Y+r.H*0.82).
		QuadTo(r.X+r.W*0.50, r.Y+r.H*0.54, r.X+r.W*0.80, r.Y+r.H*0.82)
	p.StrokePath(&body, sw, color)
}

// IconPlug draws a minimal connector link icon for Integrations.
func IconPlug(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	p.Stroke(ui.Rect{X: r.X + r.W*0.16, Y: r.Y + r.H*0.32, W: r.W * 0.42, H: r.H * 0.36}, color, r.W*0.18, sw)
	p.Stroke(ui.Rect{X: r.X + r.W*0.42, Y: r.Y + r.H*0.32, W: r.W * 0.42, H: r.H * 0.36}, color, r.W*0.18, sw)
}

// IconTerminal draws a crisp rounded command-prompt (>_) icon for herdr-core Terminals.
func IconTerminal(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	frame := ui.Rect{X: r.X + r.W*0.12, Y: r.Y + r.H*0.18, W: r.W * 0.76, H: r.H * 0.64}
	p.Stroke(frame, color, r.W*0.16, sw)
	var prompt ui.Path
	prompt.Cap(ui.RoundCap).Join(ui.RoundJoin)
	prompt.MoveTo(r.X+r.W*0.28, r.Y+r.H*0.38).
		LineTo(r.X+r.W*0.44, r.Y+r.H*0.50).
		LineTo(r.X+r.W*0.28, r.Y+r.H*0.62)
	p.StrokePath(&prompt, sw, color)
	p.Line(r.X+r.W*0.52, r.Y+r.H*0.62, r.X+r.W*0.72, r.Y+r.H*0.62, sw, color)
}

// IconMic draws a crisp condenser microphone icon for live voice capture and streaming.
func IconMic(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	capW := r.W * 0.30
	capH := r.H * 0.44
	capsule := ui.Rect{X: r.X + (r.W-capW)/2, Y: r.Y + r.H*0.12, W: capW, H: capH}
	p.Stroke(capsule, color, capW/2, sw)
	var cradle ui.Path
	cradle.Cap(ui.RoundCap)
	cradle.MoveTo(r.X+r.W*0.24, r.Y+r.H*0.48).
		QuadTo(r.X+r.W*0.24, r.Y+r.H*0.72, r.X+r.W*0.50, r.Y+r.H*0.72).
		QuadTo(r.X+r.W*0.76, r.Y+r.H*0.72, r.X+r.W*0.76, r.Y+r.H*0.48)
	p.StrokePath(&cradle, sw, color)
	p.Line(r.X+r.W*0.50, r.Y+r.H*0.72, r.X+r.W*0.50, r.Y+r.H*0.86, sw, color)
	p.Line(r.X+r.W*0.34, r.Y+r.H*0.86, r.X+r.W*0.66, r.Y+r.H*0.86, sw, color)
}

// IconMicOff draws a muted microphone icon with a diagonal slash.
func IconMicOff(p *ui.Painter, r ui.Rect, color ui.Color) {
	IconMic(p, r, color.Alpha(0.65))
	sw := iconStrokeWidth(r)
	p.Line(r.X+r.W*0.18, r.Y+r.H*0.18, r.X+r.W*0.82, r.Y+r.H*0.82, sw*1.1, color)
}

// IconSpeaker draws a speaker cone with sound waves for remote voice playback.
func IconSpeaker(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var cone ui.Path
	cone.Cap(ui.RoundCap).Join(ui.RoundJoin)
	cone.MoveTo(r.X+r.W*0.16, r.Y+r.H*0.40).
		LineTo(r.X+r.W*0.32, r.Y+r.H*0.40).
		LineTo(r.X+r.W*0.54, r.Y+r.H*0.22).
		LineTo(r.X+r.W*0.54, r.Y+r.H*0.78).
		LineTo(r.X+r.W*0.32, r.Y+r.H*0.60).
		LineTo(r.X+r.W*0.16, r.Y+r.H*0.60).
		Close()
	p.StrokePath(&cone, sw, color)
	var wave1, wave2 ui.Path
	wave1.Cap(ui.RoundCap)
	wave1.MoveTo(r.X+r.W*0.67, r.Y+r.H*0.36).QuadTo(r.X+r.W*0.76, r.Y+r.H*0.50, r.X+r.W*0.67, r.Y+r.H*0.64)
	p.StrokePath(&wave1, sw, color)
	wave2.Cap(ui.RoundCap)
	wave2.MoveTo(r.X+r.W*0.78, r.Y+r.H*0.26).QuadTo(r.X+r.W*0.91, r.Y+r.H*0.50, r.X+r.W*0.78, r.Y+r.H*0.74)
	p.StrokePath(&wave2, sw, color)
}

// IconSpeakerOff draws a silenced speaker icon with a diagonal slash.
func IconSpeakerOff(p *ui.Painter, r ui.Rect, color ui.Color) {
	IconSpeaker(p, r, color.Alpha(0.65))
	sw := iconStrokeWidth(r)
	p.Line(r.X+r.W*0.18, r.Y+r.H*0.18, r.X+r.W*0.82, r.Y+r.H*0.82, sw*1.1, color)
}

// IconBox renders a sized icon inside a layout box.
func IconBox(c *ui.Context, size float32, color ui.Color, draw IconFunc) ui.Element {
	return ui.Box(c).Size(size, size).Shrink(0).Draw(func(p *ui.Painter, r ui.Rect) {
		if draw != nil {
			draw(p, r, color)
		}
	})
}
