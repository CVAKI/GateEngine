/* Editor / boxes: Boxes are frames you draw around parts to keep the plate tidy. They have no pins and no
 * effect on the circuit: only a place and a name. Drag the title bar and everything inside moves with it. */
(function () {
  'use strict';
  const { G, snap, clamp, esc } = EditorKit;
  const COLORS = ['#4DA3FF', '#00E5FF', '#7C5CFF', '#2ED3A0', '#FFB020', '#FF5C8A'];
  const HEAD = 22, MINW = 60, MINH = 50;
  EditorKit.BOX_COLORS = COLORS;
  EditorKit.BOX_HEAD = HEAD;

  EditorKit.mix(Editor, {
    boxList() { return (this.plate && this.plate.boxes) || []; },

    boxById(id) { return this.boxList().find((b) => b.id === id) || null; },

    // SVG for every box: sits under the wires and parts, only the title bar and the corner grip take the mouse
    boxesSVG() {
      let h = '';
      for (const b of this.boxList()) {
        const c = COLORS[b.color % COLORS.length] || COLORS[0];
        const sel = this.sel && this.sel.type === 'box' && this.sel.id === b.id;
        h += `<g class="box ${sel ? 'sel' : ''}">` +
          `<rect class="box-fill" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="${c}" stroke="${c}"/>` +
          `<path class="box-bar" d="M${b.x},${b.y + HEAD}V${b.y + 8}a8,8 0 0 1 8,-8H${b.x + b.w - 8}a8,8 0 0 1 8,8V${b.y + HEAD}Z" fill="${c}"/>` +
          `<text class="box-title" x="${b.x + 10}" y="${b.y + 15}" fill="${c}">${esc(b.label || '')}</text>` +
          `<rect class="box-head" data-box="${b.id}" x="${b.x}" y="${b.y}" width="${b.w}" height="${HEAD}" rx="8"><title>Drag to move the box and everything inside. Double-click to rename.</title></rect>`;
        if (!this.readonly) h += `<path class="box-grip" data-boxsize="${b.id}" d="M${b.x + b.w - 3},${b.y + b.h - 13}L${b.x + b.w - 13},${b.y + b.h - 3}M${b.x + b.w - 3},${b.y + b.h - 8}L${b.x + b.w - 8},${b.y + b.h - 3}" stroke="${c}"/>` +
          `<rect class="box-size" data-boxsize="${b.id}" x="${b.x + b.w - 16}" y="${b.y + b.h - 16}" width="16" height="16"><title>Drag to resize</title></rect>`;
        h += '</g>';
      }
      return h;
    },

    // what lives inside a box: parts and boxes whose centre is in it
    boxInside(b) {
      const inB = (x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
      const nodes = this.plate.nodes.filter((n) => { const d = this.descs.get(n.id); return d && inB(n.x + d.w / 2, n.y + d.h / 2); });
      const boxes = this.boxList().filter((o) => o !== b && inB(o.x + o.w / 2, o.y + o.h / 2));
      return { nodes, boxes };
    },

    addBox() {
      if (!this.plate || this.editLocked) return;
      this.checkpoint();
      const p = this.plate, r = this.scroller.getBoundingClientRect();
      const c = this.toPlate({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      const w = Math.min(240, p.width * G - 20), h = Math.min(160, p.height * G - 20);
      const n = this.boxList().length;
      const b = { id: 'b' + p.nextId++, x: clamp(snap(c.x - w / 2) + (n % 5) * 20, 0, p.width * G - w), y: clamp(snap(c.y - h / 2) + (n % 5) * 20, 0, p.height * G - h), w, h, label: 'Box ' + (n + 1), color: n % COLORS.length };
      (p.boxes = p.boxes || []).push(b);
      this.multi = new Set(); this.sel = { type: 'box', id: b.id };
      this.changed();
    },

    updateBox(id, patch) {
      const b = this.boxById(id);
      if (!b || this.editLocked) return;
      this.checkpoint();
      if ('label' in patch) b.label = String(patch.label).slice(0, 30);
      if ('color' in patch) b.color = clamp(Number(patch.color) || 0, 0, COLORS.length - 1);
      this.changed();
    },

    deleteBox(id) {
      if (!this.plate || this.editLocked) return;
      this.checkpoint();
      this.plate.boxes = this.boxList().filter((b) => b.id !== id);
      this.sel = null;
      this.changed();
    },

    // drag the title bar: the box and everything inside it move together
    startBoxDrag(e, b) {
      const start = this.toPlate(e), inside = this.boxInside(b), p = this.plate;
      const items = inside.nodes.map((n) => ({ o: n, x: n.x, y: n.y })).concat(inside.boxes.map((o) => ({ o, x: o.x, y: o.y })));
      const inner = new Set(inside.nodes.map((n) => n.id));
      const wires = p.wires.filter((w) => inner.has(w.from.node) && inner.has(w.to.node) && w.pts && w.pts.length).map((w) => ({ w, pts: w.pts.map((q) => ({ x: q.x, y: q.y })) }));
      // keep everything on the plate: the group box covers the box and its contents
      let bx = b.x, by = b.y, bx2 = b.x + b.w, by2 = b.y + b.h;
      for (const it of items) { const d = it.o.w ? { w: it.o.w, h: it.o.h } : this.descs.get(it.o.id); bx = Math.min(bx, it.x); by = Math.min(by, it.y); bx2 = Math.max(bx2, it.x + d.w); by2 = Math.max(by2, it.y + d.h); }
      const ox = b.x, oy = b.y;
      let moved = false, last = { x: 0, y: 0 };
      const move = (ev) => {
        const pt = this.toPlate(ev);
        if (!moved) { if (Math.abs(pt.x - start.x) < 4 && Math.abs(pt.y - start.y) < 4) return; moved = true; this.checkpoint(); this.lastDown = null; }
        const dx = clamp(snap(pt.x - start.x), -bx, p.width * G - bx2), dy = clamp(snap(pt.y - start.y), -by, p.height * G - by2);
        if (dx === last.x && dy === last.y) return;
        last = { x: dx, y: dy };
        b.x = ox + dx; b.y = oy + dy;
        for (const it of items) { it.o.x = it.x + dx; it.o.y = it.y + dy; }
        for (const q of wires) q.w.pts = q.pts.map((s) => ({ x: s.x + dx, y: s.y + dy }));
        this.render();
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (moved) { const pruned = this.prune(); this.render(); if (this.cb.onChange) this.cb.onChange(p); if (pruned) this.refreshLive(); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    },

    startBoxResize(e, b) {
      const start = this.toPlate(e), w0 = b.w, h0 = b.h, p = this.plate;
      let moved = false;
      const move = (ev) => {
        const pt = this.toPlate(ev);
        if (!moved) { if (Math.abs(pt.x - start.x) < 3 && Math.abs(pt.y - start.y) < 3) return; moved = true; this.checkpoint(); }
        const w = clamp(snap(w0 + pt.x - start.x), MINW, p.width * G - b.x), h = clamp(snap(h0 + pt.y - start.y), MINH, p.height * G - b.y);
        if (w === b.w && h === b.h) return;
        b.w = w; b.h = h; this.render();
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (moved && this.cb.onChange) this.cb.onChange(p);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    },

    // press on a box title bar or grip. Returns true when it handled the press.
    boxDown(e) {
      const sz = e.target.closest('[data-boxsize]');
      const hd = e.target.closest('[data-box]');
      const id = sz ? sz.dataset.boxsize : (hd ? hd.dataset.box : null);
      const b = id && this.boxById(id);
      if (!b) return false;
      this.select({ type: 'box', id: b.id });
      if (sz) { this.startBoxResize(e, b); return true; }
      if (this.isDouble('box' + b.id, e)) { if (this.cb.onBoxRename) this.cb.onBoxRename(b); return true; }
      this.startBoxDrag(e, b);
      return true;
    },
  });
})();
