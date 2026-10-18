/* Editor / lifecycle: Plate lifecycle: load a plate, step into a chip and back out, breadcrumbs. */
(function () {
  'use strict';
  const { esc } = EditorKit;

  EditorKit.mix(Editor, {
    load(plate, lib) {
      this.stop();
      this.stack = []; this.prefix = ''; this.readonly = false; this.endWire();
      this.plate = plate;
      this.lib = lib || this.lib;
      this.sel = null; this.multi = new Set();
      this.render();                       // fills descs so prune can use them
      if (this.prune()) { this.render(); if (this.cb.onChange) this.cb.onChange(plate); }
      requestAnimationFrame(() => this.fit());
      if (this.cb.onSelect) this.cb.onSelect(null);
      if (this.auto) this.run();           // Live mode: every plate you open starts running
    },

    // true while the plate cannot be edited: looking inside a chip, or running in classic (non-Live) mode
    get editLocked() { return this.readonly || (this.running && !this.auto); },

    clear() { this.stop(); this.stack = []; this.prefix = ''; this.readonly = false; this.endWire(); this.plate = null; this.sel = null; this.svg.innerHTML = ''; this.renderCrumbs(); },

    // Double-click a chip to look inside it. Works while editing (read-only) and while running (live values).
    enter(ref, nodeId) {
      const child = this.lib.get(ref);
      if (!child || !this.plate) return false;
      this.endWire();
      this.multi = new Set();
      this.stack.push({ plate: this.plate, prefix: this.prefix, sel: this.sel });
      this.prefix = this.prefix + nodeId + '/';
      this.plate = child; this.sel = null; this.readonly = true;
      this.render(); this.renderCrumbs();
      requestAnimationFrame(() => this.fit());
      if (this.cb.onSelect) this.cb.onSelect(null);
      if (this.cb.onNav) this.cb.onNav();
      return true;
    },

    exit(levels) {
      levels = levels == null ? 1 : levels;
      while (levels-- > 0 && this.stack.length) {
        const s = this.stack.pop();
        this.plate = s.plate; this.prefix = s.prefix; this.sel = s.sel;
      }
      this.readonly = this.stack.length > 0;
      this.render(); this.renderCrumbs();
      requestAnimationFrame(() => this.fit());
      if (this.cb.onSelect) this.cb.onSelect(this.sel);
      if (this.cb.onNav) this.cb.onNav();
    },

    renderCrumbs() {
      const el = this.crumbs;
      if (!this.stack.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
      const names = this.stack.map((s) => GateDefs.showName(s.plate.name)).concat([GateDefs.showName(this.plate.name)]);
      let h = '<button class="crumb back" data-crumb="' + (names.length - 2) + '" title="Back (Esc)">‹ Back</button>';
      h += names.map((n, i) => `<button class="crumb ${i === names.length - 1 ? 'cur' : ''}" data-crumb="${i}">${esc(n)}</button>`).join('<span class="crumb-sep">›</span>');
      if (this.plate.builtin && !this.running) h += '<span class="crumb-tag">Built-in part · read-only</span><button class="btn sm" data-copy-builtin="1">Copy to project to edit</button>';
      else h += '<span class="crumb-tag">' + (this.running ? 'Live values · read-only' : 'Read-only view') + '</span>';
      el.innerHTML = h; el.classList.remove('hidden');
    },
  });
})();
