/* Editor / editing: Adding, changing, resizing and deleting parts; cleaning up broken wires. */
(function () {
  'use strict';
  const { G, snap, clamp } = EditorKit;

  EditorKit.mix(Editor, {
    // Remove wires whose nodes or pins no longer exist. Returns true if anything was removed.
    prune() {
      const p = this.plate;
      const before = p.wires.length;
      const m = new Map(p.nodes.map((n) => [n.id, n]));
      const seenIn = new Set();
      p.wires = p.wires.filter((w) => {
        const a = m.get(w.from.node), b = m.get(w.to.node);
        if (!a || !b) return false;
        const da = GateDefs.describe(a, this.lib), db = GateDefs.describe(b, this.lib);
        const qa = da.outputs.find((q) => q.name === w.from.pin), qb = db.inputs.find((q) => q.name === w.to.pin);
        if (!qa || !qb || (qa.bits || 1) !== (qb.bits || 1)) return false;
        const k = w.to.node + '.' + w.to.pin;
        if (seenIn.has(k)) return false;
        seenIn.add(k);
        return true;
      });
      return p.wires.length !== before;
    },

    onDrop(e) {
      if (!this.plate || this.editLocked) return;
      e.preventDefault();
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (!data || !data.type) return;
      const pt = this.toPlate(e);
      this.addNode(data.type, pt.x, pt.y, data.ref ? { ref: data.ref } : {});
    },

    addAtCenter(type, ref) {
      if (this.editLocked) return;
      const r = this.scroller.getBoundingClientRect();
      const pt = this.toPlate({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      const off = (this.addCount++ % 6) * 20;
      this.addNode(type, pt.x + off, pt.y + off, ref ? { ref } : {});
    },

    addNode(type, x, y, props) {
      if (!this.plate || this.editLocked) return;
      if (type === 'PLATE' && this.cb.canUse && !this.cb.canUse(props.ref)) { if (this.cb.onToast) this.cb.onToast('A plate cannot contain itself.'); return; }
      this.checkpoint();
      const p = this.plate;
      const base = GateDefs.fixProps(type, Object.assign(GateDefs.defaultProps(type), props || {}));
      if (type === 'INPUT' || type === 'OUTPUT') {
        const count = p.nodes.filter((n) => n.type === type || (type === 'OUTPUT' && n.type === 'BUS_OUT')).length + 1;
        base.label = (type === 'INPUT' ? 'IN' : 'OUT') + count;
      }
      if (type === 'BUS_IN') base.label = String.fromCharCode(65 + Math.min(25, p.nodes.filter((n) => n.type === type).length));   // A, B, C ...
      if (type === 'BUS_OUT') base.label = 'OUT' + (p.nodes.filter((n) => n.type === 'OUTPUT' || n.type === 'BUS_OUT').length + 1);
      const node = { id: 'n' + p.nextId++, type, x: 0, y: 0, props: base };
      const d = GateDefs.describe(node, this.lib);
      node.x = clamp(snap(x - d.w / 2), 0, p.width * G - d.w);
      node.y = clamp(snap(y - d.h / 2), 0, p.height * G - d.h);
      p.nodes.push(node);
      this.sel = { type: 'node', id: node.id };
      this.changed();
    },

    updateProps(id, patch) {
      if (this.editLocked) return;
      const n = this.plate && this.plate.nodes.find((x) => x.id === id);
      if (!n) return;
      this.checkpoint();
      const wasFlip = !!(n.props && n.props.flip);
      n.props = GateDefs.fixProps(n.type, Object.assign(n.props || {}, patch));
      if (n.type === 'BUS_IN') n.props.value = GateDefs.packValue(n.props.value, n.props.bits);   // BigInt can't go into a JSON file
      // Splitter / Merger order switch: keep every wire on the SAME pin position.
      // Pin names are real bit numbers, so swap o_i <-> o_(n-1-i) (or i_...) on the wires of this part.
      if ((n.type === 'SPLIT' || n.type === 'MERGE') && 'flip' in patch && !!n.props.flip !== wasFlip) {
        const last = n.props.bits / n.props.group - 1, pre = n.type === 'SPLIT' ? 'o' : 'i';
        const re = new RegExp('^' + pre + '(\\d+)$');
        const swap = (e) => { const m = re.exec(e.pin); if (m) e.pin = pre + (last - Number(m[1])); };
        for (const w of this.plate.wires) {
          if (n.type === 'SPLIT' && w.from.node === n.id) swap(w.from);
          if (n.type === 'MERGE' && w.to.node === n.id) swap(w.to);
        }
      }
      this.changed();
    },

    deleteSelection() {
      if (!this.plate || this.editLocked || (!this.sel && !this.multi.size)) return;
      this.checkpoint();
      const p = this.plate;
      if (this.multi.size) {
        p.nodes = p.nodes.filter((n) => !this.multi.has(n.id));
        p.wires = p.wires.filter((w) => !this.multi.has(w.from.node) && !this.multi.has(w.to.node));
        this.multi = new Set();
      } else if (this.sel.type === 'node') {
        p.nodes = p.nodes.filter((n) => n.id !== this.sel.id);
        p.wires = p.wires.filter((w) => w.from.node !== this.sel.id && w.to.node !== this.sel.id);
      } else {
        p.wires = p.wires.filter((w) => w.id !== this.sel.id);
      }
      this.sel = null;
      this.changed();
    },

    resize(w, h) {
      if (!this.plate || this.readonly) return null;
      const p = this.plate;
      let minW = 10, minH = 10;
      for (const n of p.nodes) {
        const d = this.descs.get(n.id);
        minW = Math.max(minW, Math.ceil((n.x + d.w) / G));
        minH = Math.max(minH, Math.ceil((n.y + d.h) / G));
      }
      w = clamp(Math.round(w) || p.width, minW, 500);
      h = clamp(Math.round(h) || p.height, minH, 500);
      if (w === p.width && h === p.height) return { w, h };
      this.checkpoint();
      p.width = w; p.height = h;
      this.changed();
      return { w, h };
    },
  });
})();
