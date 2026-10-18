/* Editor / fill: Fill handle: stack copies of a part in a column or row (like Excel). */
(function () {
  'use strict';
  const { G, clamp } = EditorKit;

  EditorKit.mix(Editor, {
    startFill(e, node) {
      const d = this.descs.get(node.id), gap = 10, o = this.toPlate(e);
      this.select({ type: 'node', id: node.id });
      this.fill = { id: node.id, dir: 'down', total: 1, gap };
      const move = (ev) => {
        const pt = this.toPlate(ev), dx = pt.x - o.x, dy = pt.y - o.y, f = this.fill;
        f.dir = Math.abs(dx) > Math.abs(dy) ? 'right' : 'down';
        const pitch = (f.dir === 'down' ? d.h : d.w) + gap, dist = f.dir === 'down' ? dy : dx;
        const total = clamp(1 + Math.floor(dist / pitch + 0.5), 1, 64);
        if (total === f.total) { if (f.dir === this._fd) return; }
        f.total = total; this._fd = f.dir; this.render();
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const f = this.fill; this.fill = null;
        if (f && f.total > 1) this.fillCopies(f.id, f.total, f.dir, gap); else this.render();
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      this.render();
    },

    // Make `total` parts in all (the original plus copies) in a column ('down') or row ('right'). Labels count up: IN1, IN2, ...
    // Copies get no wires. The plate grows if the column does not fit. Returns how many copies were added.
    fillCopies(id, total, dir, gap) {
      if (!this.plate || this.editLocked) return 0;
      const p = this.plate, src = p.nodes.find((n) => n.id === id), d = src && this.descs.get(id);
      if (!src || !d) return 0;
      total = clamp(Math.round(total) || 1, 1, 64); gap = gap == null ? 10 : gap;
      if (total < 2) return 0;
      this.checkpoint();
      const bump = (s, k) => {
        const m = /^(.*?)(\d+)$/.exec(s);
        if (m) return m[1] + (Number(m[2]) + k);
        if (/^[A-Y]$/.test(s) && s.charCodeAt(0) + k <= 90) return String.fromCharCode(s.charCodeAt(0) + k);
        return s;
      };
      let made = 0;
      for (let k = 1; k < total; k++) {
        const x = src.x + (dir === 'right' ? k * (d.w + gap) : 0), y = src.y + (dir === 'down' ? k * (d.h + gap) : 0);
        if (x + d.w > 500 * G || y + d.h > 500 * G) break;
        p.width = Math.max(p.width, Math.ceil((x + d.w) / G) + 2); p.height = Math.max(p.height, Math.ceil((y + d.h) / G) + 2);
        const props = JSON.parse(JSON.stringify(src.props || {}));
        if (src.type !== 'LABEL') for (const key of ['label', 'name']) if (typeof props[key] === 'string' && props[key]) props[key] = bump(props[key], k);
        if (src.type === 'BUS_IN') props.value = 0;
        p.nodes.push({ id: 'n' + p.nextId++, type: src.type, x, y, props });
        made++;
      }
      p.width = Math.min(p.width, 500); p.height = Math.min(p.height, 500);
      this.sel = { type: 'node', id };
      this.changed();
      if (made < total - 1 && this.cb.onToast) this.cb.onToast('The plate is full: made ' + made + ' copies.', 'warn');
      return made;
    },
  });
})();
