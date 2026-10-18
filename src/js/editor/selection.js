/* Editor / selection: Selecting parts, box select, group move / copy, arrow-key nudge. */
(function () {
  'use strict';
  const { G, snap, clamp } = EditorKit;

  EditorKit.mix(Editor, {
    select(sel) {
      if (this.readonly) return;
      const same = (a, b) => (!a && !b) || (a && b && a.type === b.type && a.id === b.id);
      if (this.multi.size) { this.multi = new Set(); this.sel = sel; this.render(); if (this.cb.onSelect) this.cb.onSelect(sel); return; }
      if (same(sel, this.sel)) return;     // no redraw: replacing the element under the mouse breaks double-click
      this.sel = sel;
      this.render();
      if (this.cb.onSelect) this.cb.onSelect(sel);
    },

    // Ctrl + drag on empty plate draws a box; every part the box touches is picked. Shift / Ctrl + click adds or removes one part.
    // Drag any picked part and the whole group moves; wire bends between picked parts move with them.
    setMulti(ids) {
      this.multi = new Set(ids);
      if (this.multi.size === 1) { this.sel = { type: 'node', id: [...this.multi][0] }; this.multi = new Set(); }
      else this.sel = null;
      this.render();
      if (this.cb.onSelect) this.cb.onSelect(this.sel);
    },

    toggleMulti(id) {
      const cur = new Set(this.multi);
      if (!cur.size && this.sel && this.sel.type === 'node') cur.add(this.sel.id);
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      this.setMulti(cur);
    },

    selectAll() { if (this.plate && !this.readonly) this.setMulti(this.plate.nodes.map((n) => n.id)); },

    startMarquee(e) {
      const o = this.toPlate(e), keep = e.shiftKey ? new Set(this.multi) : new Set();
      this.marq = { x1: o.x, y1: o.y, x2: o.x, y2: o.y };
      const pick = () => {
        const m = this.marq, x1 = Math.min(m.x1, m.x2), x2 = Math.max(m.x1, m.x2), y1 = Math.min(m.y1, m.y2), y2 = Math.max(m.y1, m.y2);
        const ids = new Set(keep);
        for (const n of this.plate.nodes) { const d = this.descs.get(n.id); if (d && n.x < x2 && n.x + d.w > x1 && n.y < y2 && n.y + d.h > y1) ids.add(n.id); }
        return ids;
      };
      const move = (ev) => { const p = this.toPlate(ev); this.marq.x2 = p.x; this.marq.y2 = p.y; this.multi = pick(); this.sel = null; this.render(); };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const ids = pick(); this.marq = null; this.setMulti(ids);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      this.render();
    },

    startGroupDrag(e) {
      const start = this.toPlate(e), ids = [...this.multi], nodes = ids.map((id) => this.nodeMap.get(id)).filter(Boolean);
      const orig = nodes.map((n) => ({ n, x: n.x, y: n.y }));
      const inner = this.plate.wires.filter((w) => this.multi.has(w.from.node) && this.multi.has(w.to.node) && w.pts && w.pts.length)
        .map((w) => ({ w, pts: w.pts.map((q) => ({ x: q.x, y: q.y })) }));
      let bx = Infinity, by = Infinity, bx2 = 0, by2 = 0;
      for (const o of orig) { const d = this.descs.get(o.n.id); bx = Math.min(bx, o.x); by = Math.min(by, o.y); bx2 = Math.max(bx2, o.x + d.w); by2 = Math.max(by2, o.y + d.h); }
      let moved = false, last = { x: 0, y: 0 };
      const move = (ev) => {
        const pt = this.toPlate(ev);
        if (!moved) { if (Math.abs(pt.x - start.x) < 4 && Math.abs(pt.y - start.y) < 4) return; moved = true; this.checkpoint(); this.lastDown = null; }
        const dx = clamp(snap(pt.x - start.x), -bx, this.plate.width * G - bx2), dy = clamp(snap(pt.y - start.y), -by, this.plate.height * G - by2);
        if (dx === last.x && dy === last.y) return;
        last = { x: dx, y: dy };
        for (const o of orig) { o.n.x = o.x + dx; o.n.y = o.y + dy; }
        for (const q of inner) q.w.pts = q.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        this.render();
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (moved) { const pruned = this.prune(); this.render(); if (this.cb.onChange) this.cb.onChange(this.plate); if (pruned) this.refreshLive(); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    },

    // move the picked group (or the single selected part) with the arrow keys / buttons: dx, dy in pixels
    nudge(dx, dy) {
      if (!this.plate || this.editLocked) return;
      const ids = this.multi.size > 1 ? this.multi : (this.sel && this.sel.type === 'node' ? new Set([this.sel.id]) : null);
      if (!ids) return;
      const nodes = this.plate.nodes.filter((n) => ids.has(n.id));
      let bx = Infinity, by = Infinity, bx2 = 0, by2 = 0;
      for (const n of nodes) { const d = this.descs.get(n.id); bx = Math.min(bx, n.x); by = Math.min(by, n.y); bx2 = Math.max(bx2, n.x + d.w); by2 = Math.max(by2, n.y + d.h); }
      dx = clamp(dx, -bx, this.plate.width * G - bx2); dy = clamp(dy, -by, this.plate.height * G - by2);
      if (!dx && !dy) return;
      this.checkpoint();
      for (const n of nodes) { n.x += dx; n.y += dy; }
      for (const w of this.plate.wires) if (ids.has(w.from.node) && ids.has(w.to.node) && w.pts) w.pts = w.pts.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      this.prune(); this.render();
      if (this.cb.onChange) this.cb.onChange(this.plate);
      this.refreshLive();
    },

    // copy the picked group once, 20px down and right, keeping the wires between the copied parts
    duplicateGroup() {
      if (!this.plate || this.editLocked || this.multi.size < 2) return 0;
      this.checkpoint();
      const p = this.plate, map = new Map(), made = [];
      for (const n of p.nodes.filter((q) => this.multi.has(q.id))) {
        const d = this.descs.get(n.id), id = 'n' + p.nextId++;
        map.set(n.id, id);
        p.nodes.push({ id, type: n.type, x: clamp(n.x + 20, 0, p.width * G - d.w), y: clamp(n.y + 20, 0, p.height * G - d.h), props: JSON.parse(JSON.stringify(n.props || {})) });
        made.push(id);
      }
      for (const w of p.wires.slice()) if (map.has(w.from.node) && map.has(w.to.node)) {
        const c = { id: 'w' + p.nextId++, from: { node: map.get(w.from.node), pin: w.from.pin }, to: { node: map.get(w.to.node), pin: w.to.pin } };
        if (w.pts && w.pts.length) c.pts = w.pts.map((q) => ({ x: q.x + 20, y: q.y + 20 }));
        p.wires.push(c);
      }
      this.multi = new Set(made); this.sel = null;
      this.changed();
      return made.length;
    },
  });
})();
