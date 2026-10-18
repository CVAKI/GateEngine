/* Plate editor: SVG canvas with grid, nodes, wires, undo/redo and live simulation. */
(function () {
  'use strict';
  const G = GateDefs.GRID;
  const snap = (v) => Math.round(v / G) * G;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function route(x1, y1, x2, y2) {
    if (x2 >= x1 + 20) {
      const mx = Math.round((x1 + x2) / 2 / G) * G;
      return `M${x1},${y1}H${mx}V${y2}H${x2}`;
    }
    const ox = x1 + 10, ix = x2 - 10;
    const my = y1 === y2 ? y1 + 30 : Math.round((y1 + y2) / 2 / G) * G;
    return `M${x1},${y1}H${ox}V${my}H${ix}V${y2}H${x2}`;
  }

  // same routes as point lists (used to find where wires cross, so the crossing wire can hop over the other)
  function routePts(x1, y1, x2, y2) {
    if (x2 >= x1 + 20) { const mx = Math.round((x1 + x2) / 2 / G) * G; return [{ x: x1, y: y1 }, { x: mx, y: y1 }, { x: mx, y: y2 }, { x: x2, y: y2 }]; }
    const ox = x1 + 10, ix = x2 - 10, my = y1 === y2 ? y1 + 30 : Math.round((y1 + y2) / 2 / G) * G;
    return [{ x: x1, y: y1 }, { x: ox, y: y1 }, { x: ox, y: my }, { x: ix, y: my }, { x: ix, y: y2 }, { x: x2, y: y2 }];
  }
  // Path through user-placed bends. Missing elbows are added so a wire stays orthogonal even after
  // one of its parts was moved: first leg horizontal, last leg horizontal into the pin.
  function orthoPts(a, pts, b) {
    const all = [a].concat(pts, [b]), out = [a];
    for (let k = 1; k < all.length; k++) {
      const p = out[out.length - 1], q = all[k];
      if (p.x !== q.x && p.y !== q.y) out.push(k === all.length - 1 ? { x: p.x, y: q.y } : { x: q.x, y: p.y });
      out.push(q);
    }
    return out;
  }
  function orthoPath(a, pts, b) { return 'M' + orthoPts(a, pts, b).map((p) => p.x + ',' + p.y).join('L'); }
  // Wire path with a small hump wherever a horizontal run crosses a vertical run of a DIFFERENT signal.
  // `verts` = every vertical run on the plate: {x, y1, y2, wi (wire index), fk (signal)}.
  function hopPath(pts, wi, fk, r, verts) {
    let d = 'M' + pts[0].x + ',' + pts[0].y;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (p.y === q.y && p.x !== q.x) {
        const dir = q.x > p.x ? 1 : -1, lo = Math.min(p.x, q.x) + r + 2, hi = Math.max(p.x, q.x) - r - 2, hops = [];
        for (const v of verts) if (v.wi !== wi && v.fk !== fk && v.x > lo && v.x < hi && v.y1 < p.y && v.y2 > p.y) hops.push(v.x);
        hops.sort((a, b) => (a - b) * dir);
        let last = null;
        for (const x of hops) {
          if (last !== null && Math.abs(x - last) < 2 * r + 3) continue;   // two crossings too close for two humps: keep one
          d += `L${x - r * dir},${p.y}A${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${x + r * dir},${p.y}`; last = x;
        }
      }
      d += 'L' + q.x + ',' + q.y;
    }
    return d;
  }
  // drop repeated points and points in the middle of a straight run
  function simplify(pts) {
    const a = [];
    for (const p of pts) { const l = a[a.length - 1]; if (!l || l.x !== p.x || l.y !== p.y) a.push(p); }
    const o = [];
    for (let i = 0; i < a.length; i++) {
      const p = a[i], l = o[o.length - 1], n = a[i + 1];
      if (l && n && ((l.x === p.x && p.x === n.x) || (l.y === p.y && p.y === n.y))) continue;
      o.push(p);
    }
    return o;
  }
  const pathOf = (pts) => 'M' + pts.map((p) => p.x + ',' + p.y).join('L');

  // parts whose name becomes the pin name when the plate is used as a chip (double-click to rename)
  const NAMEABLE = ['INPUT', 'OUTPUT', 'BUS_IN', 'BUS_OUT', 'BUTTON', 'CLOCK', 'PROBE'];

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
        '<div class="wire-hint hidden">Click to bend the wire &nbsp;·&nbsp; click a pin to connect &nbsp;·&nbsp; right-click undoes a bend &nbsp;·&nbsp; Esc cancels</div>';
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

    // ---------- plate lifecycle ----------
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
    }
    // true while the plate cannot be edited: looking inside a chip, or running in classic (non-Live) mode
    get editLocked() { return this.readonly || (this.running && !this.auto); }
    clear() { this.stop(); this.stack = []; this.prefix = ''; this.readonly = false; this.endWire(); this.plate = null; this.sel = null; this.svg.innerHTML = ''; this.renderCrumbs(); }

    // ---------- stepping into chips ----------
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
    }
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
    }
    renderCrumbs() {
      const el = this.crumbs;
      if (!this.stack.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
      const names = this.stack.map((s) => s.plate.name).concat([this.plate.name]);
      let h = '<button class="crumb back" data-crumb="' + (names.length - 2) + '" title="Back (Esc)">‹ Back</button>';
      h += names.map((n, i) => `<button class="crumb ${i === names.length - 1 ? 'cur' : ''}" data-crumb="${i}">${esc(n)}</button>`).join('<span class="crumb-sep">›</span>');
      if (this.plate.builtin && !this.running) h += '<span class="crumb-tag">Built-in part · read-only</span><button class="btn sm" data-copy-builtin="1">Copy to project to edit</button>';
      else h += '<span class="crumb-tag">' + (this.running ? 'Live values · read-only' : 'Read-only view') + '</span>';
      el.innerHTML = h; el.classList.remove('hidden');
    }

    // ---------- history ----------
    hist() {
      let h = this.histories.get(this.plate);
      if (!h) { h = { undo: [], redo: [] }; this.histories.set(this.plate, h); }
      return h;
    }
    snapshot() {
      const p = this.plate;
      return JSON.stringify({ nodes: p.nodes, wires: p.wires, width: p.width, height: p.height, nextId: p.nextId });
    }
    checkpoint() {
      const h = this.hist();
      h.undo.push(this.snapshot());
      if (h.undo.length > 100) h.undo.shift();
      h.redo.length = 0;
    }
    undo() {
      if (!this.plate || this.editLocked) return;
      this.multi = new Set();
      const h = this.hist(); if (!h.undo.length) return;
      h.redo.push(this.snapshot());
      Object.assign(this.plate, JSON.parse(h.undo.pop()));
      this.sel = null; this.changed();
    }
    redo() {
      if (!this.plate || this.editLocked) return;
      this.multi = new Set();
      const h = this.hist(); if (!h.redo.length) return;
      h.undo.push(this.snapshot());
      Object.assign(this.plate, JSON.parse(h.redo.pop()));
      this.sel = null; this.changed();
    }
    canUndo() { return !!this.plate && !this.readonly && this.hist().undo.length > 0; }
    canRedo() { return !!this.plate && !this.readonly && this.hist().redo.length > 0; }

    changed() {
      this.render();
      this.prune() && this.render();
      if (this.cb.onChange) this.cb.onChange(this.plate);
      if (this.cb.onSelect) this.cb.onSelect(this.sel);
      this.refreshLive();
    }
    select(sel) {
      if (this.readonly) return;
      const same = (a, b) => (!a && !b) || (a && b && a.type === b.type && a.id === b.id);
      if (this.multi.size) { this.multi = new Set(); this.sel = sel; this.render(); if (this.cb.onSelect) this.cb.onSelect(sel); return; }
      if (same(sel, this.sel)) return;     // no redraw: replacing the element under the mouse breaks double-click
      this.sel = sel;
      this.render();
      if (this.cb.onSelect) this.cb.onSelect(sel);
    }

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
    }

    // ---------- geometry ----------
    toPlate(e) {
      const m = this.svg.getScreenCTM();
      if (!m) return { x: 0, y: 0 };
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }
    pinPos(nodeId, pin, out) {
      const n = this.nodeMap.get(nodeId), d = this.descs.get(nodeId);
      if (!n || !d) return null;
      const q = (out ? d.outputs : d.inputs).find((x) => x.name === pin);
      return q ? { x: n.x + q.x, y: n.y + q.y } : null;
    }
    pinBits(nodeId, pin, out) {
      const d = this.descs.get(nodeId), q = d && (out ? d.outputs : d.inputs).find((x) => x.name === pin);
      return (q && q.bits) || 1;
    }
    live(key) { return this.running && this.sim ? this.sim.pin(this.prefix + key) : 0; }
    liveZ(key) { return this.running && this.sim ? this.sim.isZ(this.prefix + key) : false; }
    // a bus wire counts as high when any of its bits is high
    liveBus(key, bits) { if (!this.running || !this.sim) return 0; for (let i = 0; i < bits; i++) if (this.sim.pin(this.prefix + key + '[' + i + ']')) return 1; return 0; }
    nodeOn(n) {
      const s = this.running && this.sim, pf = this.prefix;
      switch (n.type) {
        case 'INPUT': return s ? (pf ? !!this.sim.pin(pf + n.id + '.q') : !!this.sim.get(n.id)) : !!(n.props && n.props.value);
        case 'BUTTON': case 'CLOCK': return s ? !!this.sim.get(pf + n.id) : false;
        case 'CONST1': return true;
        case 'OUTPUT': case 'PROBE': return s ? !!this.live(n.id + '.d') : false;
      }
      return false;
    }
    // value of a Bit input / Bit output as a number (the stored value while the circuit is not running)
    busVal(n) {
      const P = GateDefs.fixProps(n.type, n.props), s = this.running && this.sim;
      if (!s) return n.type === 'BUS_IN' ? P.value : 0;
      let v = 0;
      for (let i = 0; i < P.bits; i++) {
        const on = n.type === 'BUS_IN' ? (this.prefix ? this.sim.pin(this.prefix + n.id + '.q[' + i + ']') : this.sim.get(n.id + '[' + i + ']'))
          : this.sim.pin(this.prefix + n.id + '.d[' + i + ']');
        if (on) v |= 1 << i;
      }
      return v;
    }
    // everything the part needs to draw its live state
    nodeState(n) {
      const st = { on: this.nodeOn(n) };
      if (n.type === 'BUS_IN' || n.type === 'BUS_OUT') st.val = this.busVal(n);
      if (n.type === 'SEG7') st.segs = GateDefs.SEGN.map((p) => !!this.live(n.id + '.' + p));
      if (n.type === 'SCREEN' && this.running && this.sim) { const sc = this.sim.screens.get(this.prefix + n.id); if (sc && sc.def.mode === 'direct') st.px = sc.fb; }
      if (n.type === 'HEX') st.val = [0, 1, 2, 3].reduce((v, i) => v | (this.live(n.id + '.d' + i) ? 1 << i : 0), 0);
      return st;
    }

    // ---------- rendering ----------
    render() {
      const p = this.plate, svg = this.svg;
      if (!p) { svg.innerHTML = ''; return; }
      const W = p.width * G, H = p.height * G;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', W * this.zoom);
      svg.setAttribute('height', H * this.zoom);
      this.descs.clear(); this.nodeMap.clear();
      for (const n of p.nodes) { this.descs.set(n.id, GateDefs.describe(n, this.lib)); this.nodeMap.set(n.id, n); }
      const live = this.running && this.sim;

      let h = '<defs><pattern id="geDots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.8" fill="#26356A"/></pattern>' +
        '<pattern id="geDots5" width="50" height="50" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.6" fill="#3A4F9C"/></pattern></defs>';
      h += `<rect class="plate-bg" width="${W}" height="${H}" rx="8"/>`;
      h += `<rect fill="url(#geDots)" width="${W}" height="${H}" rx="8"/><rect fill="url(#geDots5)" width="${W}" height="${H}" rx="8"/>`;
      h += `<rect class="plate-edge" stroke="url(#geBrand)" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8"/>`;

      // picked group: a box around it. Drag anywhere inside the box (or on its grip) to move the whole group.
      let gb = null;
      if (this.multi.size > 1) {
        let x1 = Infinity, y1 = Infinity, x2 = 0, y2 = 0;
        for (const n of p.nodes) if (this.multi.has(n.id)) { const d = this.descs.get(n.id); x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + d.w); y2 = Math.max(y2, n.y + d.h); }
        gb = { x: x1 - 8, y: y1 - 8, w: x2 - x1 + 16, h: y2 - y1 + 16 };
        h += `<rect class="group-box" data-group="1" x="${gb.x}" y="${gb.y}" width="${gb.w}" height="${gb.h}" rx="6"/>`;
      }
      const connected = new Set();
      h += '<g class="wires">';
      const laid = [], verts = [];
      p.wires.forEach((w) => {
        const a = this.pinPos(w.from.node, w.from.pin, true), b = this.pinPos(w.to.node, w.to.pin, false);
        if (!a || !b) return;
        const pts = simplify(w.pts && w.pts.length ? orthoPts(a, w.pts, b) : routePts(a.x, a.y, b.x, b.y)), wi = laid.length, fk = w.from.node + '.' + w.from.pin;
        for (let i = 1; i < pts.length; i++) if (pts[i].x === pts[i - 1].x && pts[i].y !== pts[i - 1].y) verts.push({ x: pts[i].x, y1: Math.min(pts[i].y, pts[i - 1].y), y2: Math.max(pts[i].y, pts[i - 1].y), wi, fk });
        laid.push({ w, a, b, pts, wi, fk });
      });
      for (const { w, a, b, pts, wi } of laid) {
        connected.add(w.from.node + '.' + w.from.pin); connected.add(w.to.node + '.' + w.to.pin);
        const bits0 = this.pinBits(w.from.node, w.from.pin, true);
        const d = hopPath(pts, wi, w.from.node + '.' + w.from.pin, bits0 > 1 ? 8 : 6, verts);
        const bits = this.pinBits(w.from.node, w.from.pin, true), fk = w.from.node + '.' + w.from.pin;
        let state = 'idle';
        if (live) state = bits > 1 ? (this.liveBus(fk, bits) ? 'hi' : 'lo') : (this.liveZ(fk) ? 'z' : (this.live(fk) ? 'hi' : 'lo'));
        const sel = this.sel && this.sel.type === 'wire' && this.sel.id === w.id ? 'sel' : '';
        h += `<path class="wire-hit" data-wire="${w.id}" d="${d}"/><path class="wire ${state} ${sel} ${bits > 1 ? 'bus' : ''}" d="${d}"/>`;
      }
      h += '</g><g class="nodes">';
      for (const n of p.nodes) {
        const d = this.descs.get(n.id);
        const sel = (this.sel && this.sel.type === 'node' && this.sel.id === n.id) || this.multi.has(n.id);
        const single = sel && !this.multi.size;
        h += `<g class="node ${sel ? 'sel' : ''}" data-node="${n.id}" transform="translate(${n.x},${n.y})">`;
        h += `<rect class="node-hit" x="0" y="0" width="${d.w}" height="${d.h}"/>`;
        if (sel) h += `<rect class="sel-box" x="-4" y="-4" width="${d.w + 8}" height="${d.h + 8}" rx="5"/>`;
        h += `<g class="body-g">${GateDefs.bodySVG(n, d, this.nodeState(n))}</g>`;
        if (n.props && n.props.label && n.type !== 'PLATE' && n.type !== 'LABEL') h += `<text class="node-label" x="0" y="-5">${esc(n.props.label)}</text>`;
        // fill handle (like Excel): drag it down or right to stack copies of the part
        if (single && !this.editLocked && n.type !== 'LABEL') h += `<rect class="fill-handle" data-fill="${n.id}" x="${d.w + 3}" y="${d.h + 3}" width="8" height="8" rx="1.5"><title>Drag down or right to make copies</title></rect>`;
        const pins = d.inputs.map((q) => ({ q, dir: 'in' })).concat(d.outputs.map((q) => ({ q, dir: 'out' })));
        for (const { q, dir } of pins) {
          const k = n.id + '.' + q.name;
          const bits = q.bits || 1;
          const hi = live && (bits > 1 ? this.liveBus(k, bits) : this.live(k)) ? 'hi' : '';
          h += `<circle class="pin ${dir} ${connected.has(k) ? 'conn' : ''} ${hi} ${bits > 1 ? 'bus' : ''}" cx="${q.x}" cy="${q.y}" r="${bits > 1 ? 4.6 : 3.2}"/>`;
          h += `<circle class="pin-hit" data-node="${n.id}" data-pin="${q.name}" data-dir="${dir}" cx="${q.x}" cy="${q.y}" r="${bits > 1 ? 8 : 7}"/>`;
        }
        h += '</g>';
      }
      h += '</g>';
      if (gb) h += `<g class="group-grip" data-group="1"><rect x="${gb.x}" y="${gb.y - 16}" width="110" height="16" rx="4"/><text x="${gb.x + 8}" y="${gb.y - 5}">✥ Move ${this.multi.size} parts</text></g>`;
      if (this.marq) { const m = this.marq; h += `<rect class="marquee" x="${Math.min(m.x1, m.x2)}" y="${Math.min(m.y1, m.y2)}" width="${Math.abs(m.x2 - m.x1)}" height="${Math.abs(m.y2 - m.y1)}"/>`; }
      if (this.fill && this.fill.total > 1) {
        const f = this.fill, n = this.nodeMap.get(f.id), d = this.descs.get(f.id);
        if (n && d) for (let k = 1; k < f.total; k++) {
          const gx = n.x + (f.dir === 'right' ? k * (d.w + f.gap) : 0), gy = n.y + (f.dir === 'down' ? k * (d.h + f.gap) : 0);
          h += `<rect class="fill-ghost" x="${gx}" y="${gy}" width="${d.w}" height="${d.h}" rx="4"/>`;
        }
        h += `<text class="fill-count" x="${n.x + d.w + 16}" y="${n.y + d.h + 16}">${f.total} parts</text>`;
      }
      h += '<path class="ghost" d=""/><path class="ghost-dots" d=""/>';
      svg.innerHTML = h;
      this.attachScreens();
      this.ghostEl = svg.querySelector('.ghost');
      this.dotsEl = svg.querySelector('.ghost-dots');
      svg.classList.toggle('ro', this.readonly);
      if (this.wiring) this.updateGhost();
      const clash = this.running && this.sim && this.sim.conflicts > 0;
      this.badge.classList.toggle('hidden', !this.running);
      this.badge.classList.toggle('warn', !!clash);
      this.badge.textContent = clash ? 'BUS CONFLICT' : (this.auto ? 'LIVE' : 'RUNNING');
    }

    // ---------- pixel screens ----------
    // Each screen part owns one <canvas> (one real pixel per screen pixel, up to 1000x1000). The plate SVG is
    // rebuilt on every redraw, so the canvases are kept in a map and moved into the new placeholders.
    attachScreens() {
      const fos = this.svg.querySelectorAll('.px-fo');
      for (const fo of fos) {
        const id = fo.dataset.sid, d = this.descs.get(id);
        if (!d || !d.geom) continue;
        const g = d.geom, key = this.prefix + id;
        const sc = this.running && this.sim ? this.sim.screens.get(key) : null;
        let e = this.canvases.get(key);
        if (!e || e.w !== g.w || e.h !== g.h) {
          const canvas = document.createElement('canvas');
          canvas.width = g.w; canvas.height = g.h;
          canvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;background:#050A16';
          const ctx = canvas.getContext('2d');
          const img = ctx.createImageData(g.w, g.h);
          e = { canvas, ctx, img, u32: new Uint32Array(img.data.buffer), w: g.w, h: g.h, ver: -1 };
          this.canvases.set(key, e);
        }
        if (sc) { if (e.ver !== sc.ver || e.color !== g.color) this.drawScreen(e, sc, g.color); }
        else if (e.ver !== 0) { e.ctx.clearRect(0, 0, e.w, e.h); e.ver = 0; }
        fo.appendChild(e.canvas);
      }
    }
    drawScreen(e, sc, color) {
      const rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      const off = rgb(5, 10, 22);
      const pal = color === 'rgb'
        ? [0, 1, 2, 3, 4, 5, 6, 7].map((v) => (v ? rgb(v & 1 ? 255 : 0, v & 2 ? 255 : 0, v & 4 ? 255 : 0) : off))
        : [off, rgb(0, 229, 255)];
      const fb = sc.fb, u = e.u32;
      for (let i = 0; i < fb.length; i++) u[i] = pal[fb[i]] || off;
      e.ctx.putImageData(e.img, 0, 0);
      e.ver = sc.ver; e.color = color;
    }

    // ---------- Live mode ----------
    setAuto(on) {
      this.auto = !!on;
      if (!this.plate) return;
      if (this.auto && !this.running) this.run();
      else if (!this.auto && this.running) this.stop();
      else this.render();
    }
    // after an edit while Live: rebuild the netlist, keep the switches, the screens and the clock running
    refreshLive() {
      if (!this.auto || !this.running || this.readonly || !this.plate) return;
      const nl = GateSim.compile(this.plate, this.lib);
      if (nl.errors.length) {
        if (this.cb.onToast && nl.errors[0] !== this._liveErr) this.cb.onToast(nl.errors[0], 'error');
        this._liveErr = nl.errors[0];
        return;
      }
      this._liveErr = null;
      this.sim = new GateSim.Sim(nl, this.sim);
      this.sim.settle();
      this.startClock();
      this.render();
      if (this.cb.onRunState) this.cb.onRunState(true, nl);
    }

    // ---------- pointer handling ----------
    // Two presses on the same part within 400 ms = double-click. Done by hand because the browser's own
    // dblclick is lost whenever the part under the mouse is redrawn between the two presses.
    isDouble(id, e) {
      const now = performance.now(), l = this.lastDown;
      if (l && l.id === id && now - l.t < 400 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 6) { this.lastDown = null; return true; }
      this.lastDown = { id, t: now, x: e.clientX, y: e.clientY };
      return false;
    }
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
      if (wireEl) { this.select({ type: 'wire', id: wireEl.dataset.wire }); return; }
      if (this.sel || this.multi.size) this.select(null);
      this.startPanDrag(e);          // drag on empty plate: move the view
    }
    // open a chip: your own plate opens in a tab to edit; built-in parts (or anything while running) open inside, read-only
    openNode(n) {
      const child = n && n.type === 'PLATE' && this.lib.get(n.props.ref);
      if (!child) return;
      if (!this.editLocked && !child.builtin && this.cb.onOpenPlate) this.cb.onOpenPlate(n.props.ref);
      else this.enter(n.props.ref, n.id);
    }
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
    }
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
    }
    // drag on the empty plate = pan the view (middle mouse also works)
    startPanDrag(e) {
      const sx = e.clientX, sy = e.clientY, l = this.scroller.scrollLeft, t = this.scroller.scrollTop;
      const move = (ev) => { this.scroller.scrollLeft = l - (ev.clientX - sx); this.scroller.scrollTop = t - (ev.clientY - sy); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }
    // which cell of a Bit input is under the pointer (-1: none)
    bitUnder(n, e) {
      const pt = this.toPlate(e), d = this.descs.get(n.id);
      return GateDefs.busBitAt(d.bus.bits, pt.x - n.x, pt.y - n.y);
    }
    tapBit(n, bit) {
      if (!this.sim || this.prefix) return;
      const on = this.sim.toggle(n.id + '[' + bit + ']'), cur = GateDefs.fixProps(n.type, n.props).value;
      n.props.value = on ? (cur | (1 << bit)) : (cur & ~(1 << bit));
      this.sim.settle(); this.render();
    }
    tapNode(n) {
      if (!this.sim) return;
      if (n.type === 'INPUT') { n.props.value = this.sim.toggle(n.id); this.sim.settle(); this.render(); }
      else if (n.type === 'BUTTON') {
        this.sim.set(n.id, 1); this.sim.settle(); this.render();
        setTimeout(() => { if (this.sim) { this.sim.set(n.id, 0); this.sim.settle(); this.render(); } }, 200);
      }
    }

    // ---------- drawing a wire ----------
    // Press a pin: the wire follows the cursor. Release on a pin to connect (quick drag), or keep
    // going: every left-click drops a corner and turns the wire 90 degrees (horizontal <-> vertical,
    // up or down / left or right depending on where the cursor is). Click a pin to finish.
    beginWire(pinEl, e) {
      const from = { node: pinEl.dataset.node, pin: pinEl.dataset.pin, dir: pinEl.dataset.dir };
      const a = this.pinPos(from.node, from.pin, from.dir === 'out');
      if (!a) return;
      this.wiring = { from, start: a, pts: [], axis: 'h', cur: this.toPlate(e), hover: null };
      this.hintEl.classList.remove('hidden');
      const dx = e.clientX, dy = e.clientY;
      this._wmove = (ev) => this.wireMove(ev);
      const up = (ev) => {
        window.removeEventListener('pointerup', up);
        if (!this.wiring || Math.hypot(ev.clientX - dx, ev.clientY - dy) < 6) return;   // a plain click: keep wiring
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const pe = t && t.closest && t.closest('[data-pin]');
        if (pe && this.svg.contains(pe) && !(pe.dataset.node === from.node && pe.dataset.pin === from.pin)) this.finishAt(pe);
      };
      window.addEventListener('pointermove', this._wmove); window.addEventListener('pointerup', up);
      this.updateGhost();
    }
    wireMove(ev) {
      const w = this.wiring; if (!w) return;
      w.cur = this.toPlate(ev);
      const pe = ev.target && ev.target.closest ? ev.target.closest('[data-pin]') : null;
      w.hover = null;
      if (pe && this.svg.contains(pe) && pe.dataset.dir !== w.from.dir) {
        const pos = this.pinPos(pe.dataset.node, pe.dataset.pin, pe.dataset.dir === 'out');
        if (pos) w.hover = { node: pe.dataset.node, pin: pe.dataset.pin, dir: pe.dataset.dir, pos };
      }
      this.updateGhost();
    }
    wireTip() { const w = this.wiring, p = w.pts.length ? w.pts[w.pts.length - 1] : w.start; return p; }
    // corners needed to run from P (heading along `axis`) into pin T, entering the pin horizontally
    connector(P, axis, T, tdir) {
      if (axis === 'h') { const mx = T.x + (tdir === 'in' ? -20 : 20); return [{ x: mx, y: P.y }, { x: mx, y: T.y }]; }
      return [{ x: P.x, y: T.y }];
    }
    ghostPoints() {
      const w = this.wiring, P = this.wireTip(), base = [w.start].concat(w.pts);
      if (w.hover) return simplify(base.concat(this.connector(P, w.axis, w.hover.pos, w.hover.dir), [w.hover.pos]));
      const c = w.cur;
      return simplify(base.concat(w.axis === 'h' ? [{ x: c.x, y: P.y }, c] : [{ x: P.x, y: c.y }, c]));
    }
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
    }
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
    }
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
    }
    popCorner() {
      const w = this.wiring; if (!w) return;
      if (w.pts.length) { w.pts.pop(); w.axis = w.axis === 'h' ? 'v' : 'h'; this.updateGhost(); } else this.endWire();
    }
    endWire() {
      if (this._wmove) window.removeEventListener('pointermove', this._wmove);
      this._wmove = null; this.wiring = null;
      if (this.hintEl) this.hintEl.classList.add('hidden');
      this.updateGhost();
    }
    cancelWire() { this.endWire(); }
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
    }
    startPan(e) {
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, l = this.scroller.scrollLeft, t = this.scroller.scrollTop;
      const move = (ev) => { this.scroller.scrollLeft = l - (ev.clientX - sx); this.scroller.scrollTop = t - (ev.clientY - sy); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }

    // ---------- editing ----------
    onDrop(e) {
      if (!this.plate || this.editLocked) return;
      e.preventDefault();
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (!data || !data.type) return;
      const pt = this.toPlate(e);
      this.addNode(data.type, pt.x, pt.y, data.ref ? { ref: data.ref } : {});
    }
    addAtCenter(type, ref) {
      if (this.editLocked) return;
      const r = this.scroller.getBoundingClientRect();
      const pt = this.toPlate({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      const off = (this.addCount++ % 6) * 20;
      this.addNode(type, pt.x + off, pt.y + off, ref ? { ref } : {});
    }
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
    }
    updateProps(id, patch) {
      if (this.editLocked) return;
      const n = this.plate && this.plate.nodes.find((x) => x.id === id);
      if (!n) return;
      this.checkpoint();
      n.props = GateDefs.fixProps(n.type, Object.assign(n.props || {}, patch));
      this.changed();
    }
    // ---------- box select and group move ----------
    // Ctrl + drag on empty plate draws a box; every part the box touches is picked. Shift / Ctrl + click adds or removes one part.
    // Drag any picked part and the whole group moves; wire bends between picked parts move with them.
    setMulti(ids) {
      this.multi = new Set(ids);
      if (this.multi.size === 1) { this.sel = { type: 'node', id: [...this.multi][0] }; this.multi = new Set(); }
      else this.sel = null;
      this.render();
      if (this.cb.onSelect) this.cb.onSelect(this.sel);
    }
    toggleMulti(id) {
      const cur = new Set(this.multi);
      if (!cur.size && this.sel && this.sel.type === 'node') cur.add(this.sel.id);
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      this.setMulti(cur);
    }
    selectAll() { if (this.plate && !this.readonly) this.setMulti(this.plate.nodes.map((n) => n.id)); }
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
    }
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
    }
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
    }
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
    }

    // ---------- fill handle: stack copies of a part in a column (or a row), like dragging the fill handle in Excel ----------
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
    }
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
    }
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
    }
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
    }

    // ---------- view ----------
    setZoom(z) {
      this.zoom = clamp(z, 0.2, 4);
      this.render();
      if (this.cb.onZoom) this.cb.onZoom(this.zoom);
    }
    zoomAt(factor, cx, cy) {
      if (!this.plate) return;
      const r = this.svg.getBoundingClientRect();
      const px = (cx - r.left) / this.zoom, py = (cy - r.top) / this.zoom;
      this.setZoom(this.zoom * factor);
      const r2 = this.svg.getBoundingClientRect();
      this.scroller.scrollLeft += r2.left + px * this.zoom - cx;
      this.scroller.scrollTop += r2.top + py * this.zoom - cy;
    }
    fit() {
      if (!this.plate) return;
      const r = this.scroller.getBoundingClientRect();
      const z = Math.min((r.width - 120) / (this.plate.width * G), (r.height - 120) / (this.plate.height * G));
      this.setZoom(clamp(z, 0.2, 2));
      this.scroller.scrollLeft = (this.scroller.scrollWidth - this.scroller.clientWidth) / 2;
      this.scroller.scrollTop = (this.scroller.scrollHeight - this.scroller.clientHeight) / 2;
    }

    // ---------- simulation ----------
    run() {
      if (!this.plate) return false;
      if (this.stack.length) this.exit(this.stack.length);
      this.endWire();
      const nl = GateSim.compile(this.plate, this.lib);
      if (nl.errors.length) { if (this.cb.onToast) this.cb.onToast(nl.errors[0], 'error'); return false; }
      this.canvases.clear();
      this.sim = new GateSim.Sim(nl);
      this.running = true;
      this.sel = null;
      this.sim.settle();
      if (this.sim.unstable && this.cb.onToast) this.cb.onToast('Circuit did not settle (feedback loop oscillating).', 'warn');
      this.startClock();
      this.render();
      if (this.cb.onSelect) this.cb.onSelect(null);
      if (this.cb.onRunState) this.cb.onRunState(true, nl);
      return true;
    }
    stop() {
      clearInterval(this.clockTimer); this.clockTimer = null;
      const was = this.running;
      this.running = false; this.sim = null; this.canvases.clear();
      if (this.stack.length) { const s = this.stack[0]; this.plate = s.plate; this.stack = []; this.prefix = ''; this.readonly = false; this.sel = null; this.renderCrumbs(); }
      if (this.plate) this.render();
      if (was && this.cb.onRunState) this.cb.onRunState(false);
    }
    startClock() {
      clearInterval(this.clockTimer); this.clockTimer = null;
      if (!this.sim || !this.sim.clocks.length) return;
      this.clockTimer = setInterval(() => { this.sim.tickClocks(); this.sim.settle(); this.render(); }, Math.max(15, 500 / this.hz));
    }
    setHz(hz) { this.hz = clamp(hz || 1, 0.1, 30); if (this.running) this.startClock(); }
    runClick(id, e) {
      const n = this.nodeMap.get(id);
      if (!n || !this.sim) return;
      if (n.type === 'INPUT') {
        if (this.prefix) return;                       // inside a chip the inputs come from the outside
        n.props.value = this.sim.toggle(id);
        this.sim.settle(); this.render();
      } else if (n.type === 'BUS_IN') {
        const bit = this.bitUnder(n, e);
        if (bit >= 0) this.tapBit(n, bit);
      } else if (n.type === 'BUTTON') {
        const key = this.prefix + id;
        this.sim.set(key, 1); this.sim.settle(); this.render();
        const up = () => { window.removeEventListener('pointerup', up); if (this.sim) { this.sim.set(key, 0); this.sim.settle(); this.render(); } };
        window.addEventListener('pointerup', up);
      }
    }
  }

  window.Editor = Editor;
})();
