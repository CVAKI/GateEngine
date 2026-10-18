/* Editor / core: the Editor class (constructor + state). All other methods are added by the files next to this one. */
(function () {
  'use strict';
  const { G } = EditorKit;

  class Editor {
    constructor(host, cb) {
      this.host = host;
      this.cb = cb || {};
      this.plate = null;
      this.lib = { get: () => null };
      this.zoom = 1;
      this.sel = null;
      this.running = false;
      this.sim = null;
      this.clockTimer = null;
      this.hz = 1;
      this.descs = new Map();
      this.nodeMap = new Map();
      this.histories = new WeakMap();
      this.addCount = 0;
      this.wiring = null;       // wire being drawn: {from, start, pts, axis, cur, hover}
      this.stack = [];          // plates we stepped into (double-click a chip), outermost first
      this.prefix = '';         // path of the plate on screen inside the running netlist ('n3/n7/')
      this.readonly = false;    // true while looking inside a chip
      this.auto = false;        // Live mode: simulation stays on while you edit
      this.canvases = new Map();// pixel screen canvases, kept between redraws
      this.lastDown = null;     // for double-click detection (see isDouble)
      this.fill = null;         // fill-handle drag in progress: {id, dir, total, gap}
      this.multi = new Set();   // ids of the parts picked by box select / shift-click (2 or more = a group)
      this.marq = null;         // box select in progress: {x1, y1, x2, y2}
      host.innerHTML = '<div class="scroller"><div class="stage"><svg class="plate-svg" xmlns="http://www.w3.org/2000/svg"></svg></div></div>' +
        '<div class="crumbs hidden"></div><div class="run-badge hidden">RUNNING</div>' +
        '<div class="wire-hint hidden">Click to bend the wire &nbsp;·&nbsp; click a pin to connect &nbsp;·&nbsp; push to the edge to scroll &nbsp;·&nbsp; right-click undoes a bend &nbsp;·&nbsp; Esc cancels</div>';
      this.crumbs = host.querySelector('.crumbs');
      this.hintEl = host.querySelector('.wire-hint');
      this.crumbs.addEventListener('click', (e) => {
        const b = e.target.closest('[data-crumb]');
        if (b) { this.exit(this.stack.length - Number(b.dataset.crumb)); return; }
        if (e.target.closest('[data-copy-builtin]') && this.cb.onCopyBuiltin) this.cb.onCopyBuiltin(this.plate);
      });
      this.scroller = host.querySelector('.scroller');
      this.svg = host.querySelector('svg');
      this.badge = host.querySelector('.run-badge');

      this.svg.addEventListener('pointerdown', (e) => this.onDown(e));
      this.svg.addEventListener('contextmenu', (e) => this.onContext(e));
      this.svg.addEventListener('pointermove', (e) => {
        if (!this.plate || !this.cb.onCursor) return;
        const p = this.toPlate(e);
        this.cb.onCursor(Math.round(p.x / G), Math.round(p.y / G));
      });
      this.scroller.addEventListener('pointerdown', (e) => { if (e.button === 1) this.startPan(e); });
      this.scroller.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY); }
      }, { passive: false });
      host.addEventListener('dragover', (e) => { if (this.plate && !this.editLocked) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
      host.addEventListener('drop', (e) => this.onDrop(e));
    }
  }

  window.Editor = Editor;
})();
