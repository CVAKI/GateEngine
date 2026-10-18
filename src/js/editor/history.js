/* Editor / history: Undo / redo history and the "something changed" notification. */
(function () {
  'use strict';

  EditorKit.mix(Editor, {
    hist() {
      let h = this.histories.get(this.plate);
      if (!h) { h = { undo: [], redo: [] }; this.histories.set(this.plate, h); }
      return h;
    },

    snapshot() {
      const p = this.plate;
      return JSON.stringify({ nodes: p.nodes, wires: p.wires, width: p.width, height: p.height, nextId: p.nextId });
    },

    checkpoint() {
      const h = this.hist();
      h.undo.push(this.snapshot());
      if (h.undo.length > 100) h.undo.shift();
      h.redo.length = 0;
    },

    undo() {
      if (!this.plate || this.editLocked) return;
      this.multi = new Set();
      const h = this.hist(); if (!h.undo.length) return;
      h.redo.push(this.snapshot());
      Object.assign(this.plate, JSON.parse(h.undo.pop()));
      this.sel = null; this.changed();
    },

    redo() {
      if (!this.plate || this.editLocked) return;
      this.multi = new Set();
      const h = this.hist(); if (!h.redo.length) return;
      h.undo.push(this.snapshot());
      Object.assign(this.plate, JSON.parse(h.redo.pop()));
      this.sel = null; this.changed();
    },

    canUndo() { return !!this.plate && !this.readonly && this.hist().undo.length > 0; },

    canRedo() { return !!this.plate && !this.readonly && this.hist().redo.length > 0; },

    changed() {
      this.render();
      this.prune() && this.render();
      if (this.cb.onChange) this.cb.onChange(this.plate);
      if (this.cb.onSelect) this.cb.onSelect(this.sel);
      this.refreshLive();
    },
  });
})();
