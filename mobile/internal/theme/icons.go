package theme

import "github.com/egoist/mygo/ui"

// IconFunc draws a crisp 24x24-proportioned vector icon inside rect r using color.
type IconFunc func(p *ui.Painter, r ui.Rect, color ui.Color)

func iconStrokeWidth(r ui.Rect) float32 {
	w := r.W * 0.085
	if w < 1.5 {
		return 1.5
	}
	return w
}

// IconRooms draws a rounded chat bubble icon for the Rooms tab.
func IconRooms(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	box := ui.Rect{X: r.X + r.W*0.12, Y: r.Y + r.H*0.16, W: r.W * 0.76, H: r.H * 0.56}
	p.Stroke(box, color, r.W*0.18, sw)
	var tail ui.Path
	tail.MoveTo(r.X+r.W*0.28, r.Y+r.H*0.72).
		LineTo(r.X+r.W*0.22, r.Y+r.H*0.88).
		LineTo(r.X+r.W*0.44, r.Y+r.H*0.72)
	p.StrokePath(&tail, sw, color)
}

// IconLive draws an activity pulse waveform icon for the Live tab.
func IconLive(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var path ui.Path
	path.Cap(ui.RoundCap).Join(ui.RoundJoin)
	path.MoveTo(r.X+r.W*0.08, r.Y+r.H*0.52).
		LineTo(r.X+r.W*0.28, r.Y+r.H*0.52).
		LineTo(r.X+r.W*0.40, r.Y+r.H*0.20).
		LineTo(r.X+r.W*0.56, r.Y+r.H*0.80).
		LineTo(r.X+r.W*0.70, r.Y+r.H*0.42).
		LineTo(r.X+r.W*0.92, r.Y+r.H*0.42)
	p.StrokePath(&path, sw, color)
}

// IconWork draws a checklist board icon for the Work tab.
func IconWork(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	frame := ui.Rect{X: r.X + r.W*0.16, Y: r.Y + r.H*0.14, W: r.W * 0.68, H: r.H * 0.72}
	p.Stroke(frame, color, r.W*0.12, sw)
	p.Line(r.X+r.W*0.32, r.Y+r.H*0.38, r.X+r.W*0.68, r.Y+r.H*0.38, sw, color)
	p.Line(r.X+r.W*0.32, r.Y+r.H*0.55, r.X+r.W*0.68, r.Y+r.H*0.55, sw, color)
	p.Line(r.X+r.W*0.32, r.Y+r.H*0.70, r.X+r.W*0.54, r.Y+r.H*0.70, sw, color)
}

// IconLibrary draws a layered book/document stack icon for the Library tab.
func IconLibrary(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	p.Stroke(ui.Rect{X: r.X + r.W*0.16, Y: r.Y + r.H*0.16, W: r.W * 0.52, H: r.H * 0.68}, color, r.W*0.08, sw)
	var spine ui.Path
	spine.Cap(ui.RoundCap).Join(ui.RoundJoin)
	spine.MoveTo(r.X+r.W*0.76, r.Y+r.H*0.24).
		LineTo(r.X+r.W*0.84, r.Y+r.H*0.24).
		LineTo(r.X+r.W*0.84, r.Y+r.H*0.84).
		LineTo(r.X+r.W*0.32, r.Y+r.H*0.84)
	p.StrokePath(&spine, sw, color)
}

// IconMore draws a four-node control grid icon for the More & Connect tab.
func IconMore(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	s := r.W * 0.28
	gap := r.W * 0.14
	x0 := r.X + (r.W-2*s-gap)/2
	y0 := r.Y + (r.H-2*s-gap)/2
	rad := s * 0.28
	p.Stroke(ui.Rect{X: x0, Y: y0, W: s, H: s}, color, rad, sw)
	p.Stroke(ui.Rect{X: x0 + s + gap, Y: y0, W: s, H: s}, color, rad, sw)
	p.Stroke(ui.Rect{X: x0, Y: y0 + s + gap, W: s, H: s}, color, rad, sw)
	p.Stroke(ui.Rect{X: x0 + s + gap, Y: y0 + s + gap, W: s, H: s}, color, rad, sw)
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
	p.Stroke(body, color, r.W*0.10, sw)
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
	p.Stroke(ui.Rect{X: r.X + r.W*0.12, Y: r.Y + r.H*0.18, W: r.W * 0.76, H: r.H * 0.50}, color, r.W*0.08, sw)
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
	c2.Circle(cx, cy, r.W*0.20)
	p.StrokePath(&c1, sw, color)
	p.StrokePath(&c2, sw, color)
	dot := r.W * 0.14
	p.Fill(ui.Rect{X: cx - dot/2, Y: cy - dot/2, W: dot, H: dot}, color, dot/2)
}

// IconQR draws a stylized QR corner-finder icon.
func IconQR(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	s := r.W * 0.30
	p.Stroke(ui.Rect{X: r.X + r.W*0.14, Y: r.Y + r.H*0.14, W: s, H: s}, color, 2, sw)
	p.Stroke(ui.Rect{X: r.X + r.W*0.56, Y: r.Y + r.H*0.14, W: s, H: s}, color, 2, sw)
	p.Stroke(ui.Rect{X: r.X + r.W*0.14, Y: r.Y + r.H*0.56, W: s, H: s}, color, 2, sw)
	p.Fill(ui.Rect{X: r.X + r.W*0.58, Y: r.Y + r.H*0.58, W: r.W * 0.12, H: r.H * 0.12}, color, 1)
	p.Fill(ui.Rect{X: r.X + r.W*0.74, Y: r.Y + r.H*0.74, W: r.W * 0.12, H: r.H * 0.12}, color, 1)
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
	c.Circle(r.X+r.W*0.50, r.Y+r.H*0.50, r.W*0.34)
	p.StrokePath(&c, sw, color)
	var arrow ui.Path
	arrow.Cap(ui.RoundCap).Join(ui.RoundJoin)
	arrow.MoveTo(r.X+r.W*0.72, r.Y+r.H*0.20).
		LineTo(r.X+r.W*0.86, r.Y+r.H*0.34).
		LineTo(r.X+r.W*0.66, r.Y+r.H*0.40)
	p.StrokePath(&arrow, sw, color)
}

// IconBack draws a left-pointing chevron for top-bar back navigation.
func IconBack(p *ui.Painter, r ui.Rect, color ui.Color) {
	sw := iconStrokeWidth(r)
	var path ui.Path
	path.Cap(ui.RoundCap).Join(ui.RoundJoin)
	path.MoveTo(r.X+r.W*0.64, r.Y+r.H*0.20).
		LineTo(r.X+r.W*0.32, r.Y+r.H*0.50).
		LineTo(r.X+r.W*0.64, r.Y+r.H*0.80)
	p.StrokePath(&path, sw, color)
}

// IconBox renders a sized icon inside a layout box.
func IconBox(c *ui.Context, size float32, color ui.Color, draw IconFunc) ui.Element {
	return ui.Box(c).Size(size, size).Shrink(0).Draw(func(p *ui.Painter, r ui.Rect) {
		if draw != nil {
			draw(p, r, color)
		}
	})
}
