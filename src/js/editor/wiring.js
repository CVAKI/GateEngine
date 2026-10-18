/* Editor / wiring: Drawing wires: bends, branching from a wire, dragging wire segments, connecting pins. */
(function () {
  'use strict';
  const { G, snap, clamp, route, simplify, pathOf } = EditorKit;

  EditorKit.mix(Editor, {
    // Press a pin: the wire follows the cursor. Release on a pin to connect (quick drag), or keep
    // going: every left-click drops a corner and turns the wire 90 degrees (horizontal <-> vertical,
    // up or down / left or right depending on where the cursor is). Click a pin to finish.
    beginWire(pinEl, e) {
      const from = { node: pinEl.dataset.node, pin: pinEl.dataset.pin, dir: pinEl.dataset.dir };
      const a = this.pinPos(from.node, from.pin, from.dir === 'out');
      if (!a) return;
      this.startWiring(from, a, e.clientX, e.clientY, [], 'h', e);
    },

    startWiring(from, a, dx, dy, pts, axis, e) {
      this.wiring = { from, start: a, pts, axis, cur: this.toPlate(e), hover: null, cx: e.clientX, cy: e.clientY };
      this.hintEl.classList.remove('hidden');
      this._wmove = (ev) => this.wireMove(ev);
      // near the edge of the view: scroll it, so a long wire can be finished without letting go
      this._wscroll = setInterval(() => {
        const w = this.wiring; if (!w) return;
        const r = this.scroller.getBoundingClientRect(), m = 40, sp = (d) => Math.min(24, Math.ceil(d / 3));
        let sx = 0, sy = 0;
        if (w.cx < r.left + m) sx = -sp(r.left + m - w.cx); else if (w.cx > r.right - m) sx = sp(w.cx - (r.right - m));
        if (w.cy < r.top + m) sy = -sp(r.top + m - w.cy); else if (w.cy > r.bottom - m) sy = sp(w.cy - (r.bottom - m));
        if (!sx && !sy) return;
        this.scroller.scrollLeft += sx; this.scroller.scrollTop += sy;
        w.cur = this.toPlate({ clientX: w.cx, clientY: w.cy }); this.updateGhost();
      }, 16);
      const up = (ev) => {
        window.removeEventListener('pointerup', up);
        if (!this.wiring || Math.hypot(ev.clientX - dx, ev.clientY - dy) < 6) return;   // a plain click: keep wiring
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const pe = t && t.closest && t.closest('[data-pin]');
        if (pe && this.svg.contains(pe) && !(pe.dataset.node === from.node && pe.dataset.pin === from.pin)) this.finishAt(pe);
      };
      window.addEventListener('pointermove', this._wmove); window.addEventListener('pointerup', up);
      this.updateGhost();
    },

    // Press on a wire and drag: a new wire starts from that spot (same signal), like branching off a junction.
    armBranch(e, wid) {
      const w = this.plate.wires.find((x) => x.id === wid), L = this._laid && this._laid.find((q) => q.w.id === wid);
      if (!w || !L) return;
      const pt = this.toPlate(e), dx = e.clientX, dy = e.clientY;
      const move = (ev) => {
        if (Math.hypot(ev.clientX - dx, ev.clientY - dy) < 6) return;
        cleanup();
        // nearest straight run of the wire to where it was pressed
        let best = -1, bd = Infinity;
        for (let i = 1; i < L.pts.length; i++) {
          const p = L.pts[i - 1], q = L.pts[i];
          const cx = clamp(pt.x, Math.min(p.x, q.x), Math.max(p.x, q.x)), cy = clamp(pt.y, Math.min(p.y, q.y), Math.max(p.y, q.y));
          const d = Math.hypot(pt.x - cx, pt.y - cy);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 1) return;
        const p = L.pts[best - 1], q = L.pts[best], horiz = p.y === q.y;
        const J = horiz ? { x: clamp(snap(pt.x), Math.min(p.x, q.x), Math.max(p.x, q.x)), y: p.y }
          : { x: p.x, y: clamp(snap(pt.y), Math.min(p.y, q.y), Math.max(p.y, q.y)) };
        const pts = simplify(L.pts.slice(0, best).concat([J])).slice(1);
        this.startWiring({ node: w.from.node, pin: w.from.pin, dir: 'out' }, L.pts[0], dx, dy, pts, horiz ? 'v' : 'h', ev);
      };
      const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', cleanup); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', cleanup);
    },

    // Drag the little square on a selected wire to slide that part of the wire sideways / up / down.
    startSegDrag(e, key) {
      const [wid, is] = key.split(':'), i = Number(is);
      const w = this.plate.wires.find((x) => x.id === wid), L = this._laid && this._laid.find((q) => q.w.id === wid);
      if (!w || !L) return;
      const pts = L.pts.map((p) => ({ x: p.x, y: p.y })), vert = pts[i].x === pts[i + 1].x, start = this.toPlate(e), o = vert ? pts[i].x : pts[i].y;
      let moved = false;
      const move = (ev) => {
        const pt = this.toPlate(ev), v = vert ? clamp(snap(o + pt.x - start.x), 0, this.plate.width * G) : clamp(snap(o + pt.y - start.y), 0, this.plate.height * G);
        if (!moved) { if (Math.abs(pt.x - start.x) < 4 && Math.abs(pt.y - start.y) < 4) return; moved = true; this.checkpoint(); }
        if (vert) { pts[i].x = v; pts[i + 1].x = v; } else { pts[i].y = v; pts[i + 1].y = v; }
        w.pts = pts.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));
        this.render();
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (moved) { this.render(); if (this.cb.onChange) this.cb.onChange(this.plate); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    },

    wireMove(ev) {
      const w = this.wiring; if (!w) return;
      w.cur = this.toPlate(ev); w.cx = ev.clientX; w.cy = ev.clientY;
      const pe = ev.target && ev.target.closest ? ev.target.closest('[data-pin]') : null;
      w.hover = null;
      if (pe && this.svg.contains(pe) && pe.dataset.dir !== w.from.dir) {
        const pos = this.pinPos(pe.dataset.node, pe.dataset.pin, pe.dataset.dir === 'out');
        if (pos) w.hover = { node: pe.dataset.node, pin: pe.dataset.pin, dir: pe.dataset.dir, pos };
      }
      this.updateGhost();
    },

    wireTip() { const w = this.wiring, p = w.pts.length ? w.pts[w.pts.length - 1] : w.start; return p; },

    // corners needed to run from P (heading along `axis`) into pin T, entering the pin horizontally
    connector(P, axis, T, tdir) {
      if (axis === 'h') { const mx = T.x + (tdir === 'in' ? -20 : 20); return [{ x: mx, y: P.y }, { x: mx, y: T.y }]; }
      return [{ x: P.x, y: T.y }];
    },

    ghostPoints() {
      const w = this.wiring, P = this.wireTip(), base = [w.start].concat(w.pts);
      if (w.hover) return simplify(base.concat(this.connector(P, w.axis, w.hover.pos, w.hover.dir), [w.hover.pos]));
      const c = w.cur;
      return simplify(base.concat(w.axis === 'h' ? [{ x: c.x, y: P.y }, c] : [{ x: P.x, y: c.y }, c]));
    },

    updateGhost() {
      if (!this.ghostEl) return;
      const w = this.wiring;
      if (!w) { this.ghostEl.setAttribute('d', ''); this.dotsEl.setAttribute('d', ''); return; }
      let d;
      if (w.hover && !w.pts.length) {   // no bends yet: show the automatic route that will be created
        const a = w.start, b = w.hover.pos;
        d = w.from.dir === 'out' ? route(a.x, a.y, b.x, b.y) : route(b.x, b.y, a.x, a.y);
      } else d = pathOf(this.ghostPoints());
      this.ghostEl.setAttribute('d', d);
      this.dotsEl.setAttribute('d', w.pts.map((p) => `M${p.x},${p.y}h0.01`).join(''));
    },

    wiringDown(e) {
      const w = this.wiring;
      const pe = e.target.closest('[data-pin]');
      if (pe) { this.finishAt(pe); return; }
      const pt = this.toPlate(e), P = this.wireTip();
      if (w.axis === 'h') {
        const x = clamp(snap(pt.x), 0, this.plate.width * G);
        if (x === P.x) return;
        w.pts.push({ x, y: P.y }); w.axis = 'v';
      } else {
        const y = clamp(snap(pt.y), 0, this.plate.height * G);
        if (y === P.y) return;
        w.pts.push({ x: P.x, y }); w.axis = 'h';
      }
      this.updateGhost();
    },

    finishAt(pe) {
      const w = this.wiring;
      const to = { node: pe.dataset.node, pin: pe.dataset.pin, dir: pe.dataset.dir };
      if (to.dir === w.from.dir) { if (this.cb.onToast) this.cb.onToast('Connect an output pin to an input pin.'); return; }
      const T = this.pinPos(to.node, to.pin, to.dir === 'out');
      if (!T) return;
      let pts = [];
      if (w.pts.length) {
        const full = simplify([w.start].concat(w.pts, this.connector(this.wireTip(), w.axis, T, to.dir), [T]));
        pts = full.slice(1, -1);
      }
      const fromIsOut = w.from.dir === 'out';
      if (!fromIsOut) pts.reverse();
      this.endWire();
      this.connect(fromIsOut ? w.from : to, fromIsOut ? to : w.from, pts);
    },

    popCorner() {
      const w = this.wiring; if (!w) return;
      if (w.pts.length) { w.pts.pop(); w.axis = w.axis === 'h' ? 'v' : 'h'; this.updateGhost(); } else this.endWire();
    },

    endWire() {
      if (this._wmove) window.removeEventListener('pointermove', this._wmove);
      this._wmove = null; this.wiring = null;
      if (this._wscroll) { clearInterval(this._wscroll); this._wscroll = null; }
      if (this.hintEl) this.hintEl.classList.add('hidden');
      this.updateGhost();
    },

    cancelWire() { this.endWire(); },

    connect(a, b, pts) {
      if (a.dir === b.dir) { if (this.cb.onToast) this.cb.onToast('Connect an output pin to an input pin.'); return; }
      const o = a.dir === 'out' ? a : b, i = a.dir === 'out' ? b : a;
      const bo = this.pinBits(o.node, o.pin, true), bi = this.pinBits(i.node, i.pin, false);
      if (bo !== bi) { if (this.cb.onToast) this.cb.onToast(`Bus width differs: ${bo}-bit output, ${bi}-bit input. Both ends need the same width.`, 'warn'); return; }
      this.checkpoint();
      this.plate.wires = this.plate.wires.filter((w) => !(w.to.node === i.node && w.to.pin === i.pin));
      const wire = { id: 'w' + this.plate.nextId++, from: { node: o.node, pin: o.pin }, to: { node: i.node, pin: i.pin } };
      if (pts && pts.length) wire.pts = pts.map((p) => ({ x: p.x, y: p.y }));
      this.plate.wires.push(wire);
      this.sel = null;
      this.changed();
    },
  });
})();
