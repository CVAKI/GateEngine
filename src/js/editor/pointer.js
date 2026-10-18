/* Editor / pointer: Mouse handling on the canvas: press, drag a part, pan, right-click delete. */
(function () {
  'use strict';
  const { G, snap, clamp, NAMEABLE } = EditorKit;

  EditorKit.mix(Editor, {
    // Two presses on the same part within 400 ms = double-click. Done by hand because the browser's own
    // dblclick is lost whenever the part under the mouse is redrawn between the two presses.
    isDouble(id, e) {
      const now = performance.now(), l = this.lastDown;
      if (l && l.id === id && now - l.t < 400 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 6) { this.lastDown = null; return true; }
      this.lastDown = { id, t: now, x: e.clientX, y: e.clientY };
      return false;
    },

    onDown(e) {
      if (e.button !== 0 || !this.plate) return;
      if (this.wiring) { this.wiringDown(e); return; }
      const pinEl = e.target.closest('[data-pin]');
      const nodeEl = e.target.closest('[data-node]');
      const wireEl = e.target.closest('[data-wire]');
      // double-click on a chip: look inside / open it (works while editing and while running)
      if (nodeEl && !pinEl) {
        const n = this.nodeMap.get(nodeEl.dataset.node);
        if (n && n.type === 'PLATE' && this.isDouble(n.id, e)) { this.openNode(n); return; }
        if (n && NAMEABLE.includes(n.type) && !this.running && !this.readonly && !(e.shiftKey || e.ctrlKey || e.metaKey) && this.isDouble(n.id, e)) { if (this.cb.onRename) this.cb.onRename(n); return; }
      } else this.lastDown = null;
      // classic Run, or inside a chip: the plate is frozen, switches and buttons are clickable
      if (this.running && (!this.auto || this.readonly)) { if (nodeEl && !pinEl) this.runClick(nodeEl.dataset.node, e); return; }
      if (this.readonly) return;
      const fillEl = e.target.closest('[data-fill]');
      if (fillEl && !this.editLocked) { const fn = this.nodeMap.get(fillEl.dataset.fill); if (fn) { this.startFill(e, fn); return; } }
      if (pinEl) { this.beginWire(pinEl, e); return; }
      const segEl = e.target.closest('[data-seg]');
      if (segEl && !this.editLocked) { this.startSegDrag(e, segEl.dataset.seg); return; }
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!add && !nodeEl && !wireEl && this.multi.size > 1 && e.target.closest('[data-group]')) { this.startGroupDrag(e); return; }   // drag inside the group box
      if (nodeEl && add) { this.toggleMulti(nodeEl.dataset.node); return; }      // Shift / Ctrl + click: add or remove a part
      if (nodeEl && this.multi.size > 1 && this.multi.has(nodeEl.dataset.node)) { this.startGroupDrag(e); return; }   // drag any picked part: the whole group moves
      if (!nodeEl && !wireEl && add) { this.startMarquee(e); return; }          // Ctrl + drag on empty plate: box select
      if (nodeEl) {
        const node = this.nodeMap.get(nodeEl.dataset.node);
        this.select({ type: 'node', id: node.id });
        // Live mode: a plain click on a switch / button / bit cell works it, dragging it moves it
        const bit = node.type === 'BUS_IN' ? this.bitUnder(node, e) : -1;
        const tap = this.running && (node.type === 'INPUT' || node.type === 'BUTTON') ? () => this.tapNode(node)
          : (this.running && bit >= 0 ? () => this.tapBit(node, bit) : null);
        this.startDrag(e, node, tap);
        return;
      }
      if (wireEl) { this.select({ type: 'wire', id: wireEl.dataset.wire }); if (!this.editLocked) this.armBranch(e, wireEl.dataset.wire); return; }
      if (this.sel || this.multi.size) this.select(null);
      this.startPanDrag(e);          // drag on empty plate: move the view
    },

    // open a chip: your own plate opens in a tab to edit; built-in parts (or anything while running) open inside, read-only
    openNode(n) {
      const child = n && n.type === 'PLATE' && this.lib.get(n.props.ref);
      if (!child) return;
      if (!this.editLocked && !child.builtin && this.cb.onOpenPlate) this.cb.onOpenPlate(n.props.ref);
      else this.enter(n.props.ref, n.id);
    },

    // Right-click a part or wire: ask first, then delete.
    onContext(e) {
      e.preventDefault();
      if (this.wiring) { this.popCorner(); return; }
      if (!this.plate || this.editLocked) return;
      const nodeEl = e.target.closest('[data-node]'), wireEl = e.target.closest('[data-wire]');
      if (nodeEl && this.multi.size > 1 && this.multi.has(nodeEl.dataset.node)) {      // right-click inside the group: delete them all
        const goAll = (ok) => { if (ok) this.deleteSelection(); };
        const group = { type: 'multi', id: 'multi', count: this.multi.size };
        if (this.cb.confirmDelete) Promise.resolve(this.cb.confirmDelete(group)).then(goAll); else goAll(true);
        return;
      }
      const sel = nodeEl ? { type: 'node', id: nodeEl.dataset.node } : (wireEl ? { type: 'wire', id: wireEl.dataset.wire } : null);
      if (!sel) return;
      this.select(sel);
      const go = (ok) => { if (ok && this.sel && this.sel.id === sel.id) this.deleteSelection(); };
      if (this.cb.confirmDelete) Promise.resolve(this.cb.confirmDelete(sel)).then(go); else go(true);
    },

    startDrag(e, node, tap) {
      const start = this.toPlate(e), ox = node.x, oy = node.y;
      let moved = false;
      const move = (ev) => {
        const pt = this.toPlate(ev), dx = pt.x - start.x, dy = pt.y - start.y;
        if (!moved) { if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; moved = true; this.checkpoint(); this.lastDown = null; }
        const d = this.descs.get(node.id);
        const nx = clamp(snap(ox + dx), 0, this.plate.width * G - d.w), ny = clamp(snap(oy + dy), 0, this.plate.height * G - d.h);
        if (nx === node.x && ny === node.y) return;
        node.x = nx; node.y = ny;
        this.render();
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (moved) { const pruned = this.prune(); this.render(); if (this.cb.onChange) this.cb.onChange(this.plate); if (pruned) this.refreshLive(); }
        else if (tap) tap();
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    },

    // drag on the empty plate = pan the view (middle mouse also works)
    startPanDrag(e) {
      const sx = e.clientX, sy = e.clientY, l = this.scroller.scrollLeft, t = this.scroller.scrollTop;
      const move = (ev) => { this.scroller.scrollLeft = l - (ev.clientX - sx); this.scroller.scrollTop = t - (ev.clientY - sy); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    },

    // which cell of a Bit input is under the pointer (-1: none)
    bitUnder(n, e) {
      const pt = this.toPlate(e), d = this.descs.get(n.id);
      return GateDefs.busBitAt(d.bus.bits, pt.x - n.x, pt.y - n.y);
    },

    tapBit(n, bit) {
      if (!this.sim || this.prefix) return;
      this.sim.toggle(n.id + '[' + bit + ']');
      const bits = GateDefs.fixProps(n.type, n.props).bits;
      n.props.value = GateDefs.packValue(this.sim.getBus(n.id, bits), bits);   // wide values (> 53 bits) are saved as a hex string
      this.sim.settle(); this.render();
    },

    tapNode(n) {
      if (!this.sim) return;
      if (n.type === 'INPUT') { n.props.value = this.sim.toggle(n.id); this.sim.settle(); this.render(); }
      else if (n.type === 'BUTTON') {
        this.sim.set(n.id, 1); this.sim.settle(); this.render();
        setTimeout(() => { if (this.sim) { this.sim.set(n.id, 0); this.sim.settle(); this.render(); } }, 200);
      }
    },

    startPan(e) {
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, l = this.scroller.scrollLeft, t = this.scroller.scrollTop;
      const move = (ev) => { this.scroller.scrollLeft = l - (ev.clientX - sx); this.scroller.scrollTop = t - (ev.clientY - sy); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    },
  });
})();
