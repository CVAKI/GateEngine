/* Render map viewer. Opens over the plate editor for plates named "*.map".
 * Shows the plate with every chip opened up to its gates (see maplayout.js), runs its own live simulation,
 * and lets you trace a signal: click a wire and everything on the same net lights up, through every chip border.
 */
(function () {
  'use strict';
  const D = GateDefs, ML = MapLayout;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const S = 'stroke="url(#geBrand)"';
  const MIN_START = 0.4;

  const ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>', play: '<path d="M7 4l13 8-13 8z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
    map: '<path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/>',
  };
  const ic = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ''}</svg>`;
  const fmtVal = (v, bits) => String(v) + ' · 0x' + BigInt(v).toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');

  class MapView {
    constructor(host, cb) {
      this.host = host; this.cb = cb || {};
      this.el = null; this.plate = null; this.lib = null; this.sim = null; this.timer = null;
      this.k = 1; this.tx = 0; this.ty = 0; this.depth = 'all'; this.paused = false; this.trace = null;
      this.onKey = (e) => { if (e.key === 'Escape' && this.isOpen) { e.stopPropagation(); e.preventDefault(); this.close(); } };
    }

    get isOpen() { return !!this.el; }

    open(plate, lib, opts) {
      opts = opts || {};
      this.close();
      this.plate = plate; this.lib = lib; this.hz = opts.hz === 0 ? 0 : (opts.hz || 1); this.depth = 'all'; this.mode = this.mode || 'plate'; this.paused = false; this.trace = null;
      const el = document.createElement('div');
      el.className = 'mapview';
      el.innerHTML = '<div class="mv-bar"></div><div class="mv-stage"><svg class="mv-svg" xmlns="http://www.w3.org/2000/svg"></svg><div class="mv-readout hidden"></div><div class="mv-mini hidden" title="Overview: click or drag to move around"><svg xmlns="http://www.w3.org/2000/svg"></svg></div></div>' +
        '<div class="mv-foot">Scroll to zoom &nbsp;·&nbsp; drag to pan &nbsp;·&nbsp; click a wire to trace its signal &nbsp;·&nbsp; click a switch to flip it &nbsp;·&nbsp; Esc to close</div>';
      this.host.appendChild(el);
      this.el = el; this.bar = el.querySelector('.mv-bar'); this.stage = el.querySelector('.mv-stage'); this.svg = el.querySelector('svg'); this.readout = el.querySelector('.mv-readout'); this.mini = el.querySelector('.mv-mini');
      this.bindEvents();
      document.addEventListener('keydown', this.onKey, true);
      this.startSim();
      this.build(true);
    }

    close() {
      if (!this.el) return;
      clearInterval(this.timer); this.timer = null; this.sim = null;
      document.removeEventListener('keydown', this.onKey, true);
      this.el.remove(); this.el = null; this.canvases = null;
      if (this.cb.onClose) this.cb.onClose();
    }

    // ---------------------------------------------------------------- simulation
    startSim() {
      clearInterval(this.timer); this.timer = null; this.sim = null;
      const nl = GateSim.compile(this.plate, this.lib);
      if (nl.errors.length) { if (this.cb.onToast) this.cb.onToast(nl.errors[0] + ' (map shown without live values)', 'warn'); return; }
      this.sim = new GateSim.Sim(nl);
      this.sim.settle();
      if (this.sim.clocks.length) this.timer = setInterval(() => {
        if (this.paused || !this.sim) return;
        const per = !this.hz || this.hz >= 1e6 ? Infinity : Math.max(1, Math.round(this.hz * 2 * 0.015)), t0 = performance.now();
        for (let i = 0; i < per; i++) { this.sim.tickClocks(); this.sim.settle(); if (performance.now() - t0 > 11) break; }
        this.update();
      }, !this.hz ? 15 : Math.max(15, 500 / this.hz));
    }

    // ---------------------------------------------------------------- build the picture
    build(fit) {
      const lay = MapLayout.layout(this.plate, this.lib, { maxDepth: this.depth === 'all' ? Infinity : Number(this.depth), mode: this.mode });
      this.lay = lay;
      if (this.depth === 'all') this.maxDepth = lay.stats.depth;
      this.leaves = [];
      const body = this.level(lay.root, 0, 0, '');
      const R = lay.root;
      // the root is drawn as a plate, like the editor: same border, same dot grid
      const plate = '<defs><pattern id="mvDots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.8" fill="#26356A"/></pattern>' +
        '<pattern id="mvDots5" width="50" height="50" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.6" fill="#3A4F9C"/></pattern></defs>' +
        `<rect class="plate-bg" width="${R.w}" height="${R.h}" rx="10"/><rect fill="url(#mvDots)" width="${R.w}" height="${R.h}" rx="10"/><rect fill="url(#mvDots5)" width="${R.w}" height="${R.h}" rx="10"/>`;
      const edge = `<rect class="plate-edge mv-edge" stroke="url(#geBrand)" x="1" y="1" width="${R.w - 2}" height="${R.h - 2}" rx="10"/>`;
      this.svg.innerHTML = '<g class="mv-world">' + plate + body + edge + '</g>';
      this.world = this.svg.querySelector('.mv-world');
      this.indexLive();
      this.buildMini();
      this.renderBar();
      if (fit) requestAnimationFrame(() => this.fit()); else this.applyView();
      this.update();
    }

    renderBar() {
      const st = this.lay.stats, depths = [];
      for (let i = 1; i <= this.maxDepth; i++) depths.push(i);
      const opts = '<option value="all">All levels</option>' + depths.map((i) => `<option value="${i}" ${String(this.depth) === String(i) ? 'selected' : ''}>${i} level${i > 1 ? 's' : ''} deep</option>`).join('');
      this.bar.innerHTML =
        `<span class="mv-title">${ic('map', 16)}<b>Map</b><span class="mv-name">${esc(D.showName(this.plate.name))}</span></span>` +
        `<label class="mv-ctl"><span class="ctl-l">Layout</span><select data-mv="mode"><option value="plate" ${this.mode === 'plate' ? 'selected' : ''}>Your layout</option><option value="flow" ${this.mode === 'flow' ? 'selected' : ''}>Auto flow</option></select></label>` +
        `<label class="mv-ctl"><span class="ctl-l">Open chips</span><select data-mv="depth">${opts}</select></label>` +
        `<span class="mv-stats">${st.gates} gates · ${st.chips} chips · ${st.depth} level${st.depth === 1 ? '' : 's'} deep${this.sim ? '' : ' · no live values'}</span>` +
        '<span class="mv-sp"></span>' +
        (this.sim && this.sim.clocks.length ? `<button class="btn sm" data-mv="pause">${ic(this.paused ? 'play' : 'pause', 14)}<span class="lbl">${this.paused ? 'Resume clock' : 'Pause clock'}</span></button>` : '') +
        `<button class="icon-btn" data-mv="out" title="Zoom out">${ic('minus')}</button><span class="mv-zoom">${Math.round(this.k * 100)}%</span><button class="icon-btn" data-mv="in" title="Zoom in">${ic('plus')}</button>` +
        `<button class="icon-btn" data-mv="fit" title="Fit to window">${ic('fit')}</button>` +
        `<button class="btn sm" data-mv="close" title="Close (Esc)">${ic('close', 14)}<span class="lbl">Close</span></button>`;
    }

    // one plate level; (ox, oy) is where its origin sits inside the parent group
    level(L, ox, oy, key) {
      const path = L.path;
      let h = '';
      const conn = new Set();
      for (const w of L.wires) { conn.add(w.fk); conn.add(w.tk); }
      for (const it of L.items) h += this.item(it, path, conn);
      // a wire hops over a different signal it crosses (same as the editor)
      const verts = [];
      L.wires.forEach((w, wi) => { for (let i = 1; i < w.pts.length; i++) if (w.pts[i].x === w.pts[i - 1].x && w.pts[i].y !== w.pts[i - 1].y) verts.push({ x: w.pts[i].x, y1: Math.min(w.pts[i].y, w.pts[i - 1].y), y2: Math.max(w.pts[i].y, w.pts[i - 1].y), wi, fk: w.fk }); });
      L.wires.forEach((w, wi) => {
        const d = EditorKit.hopPath(w.pts, wi, w.fk, w.bits > 1 ? 8 : 6, verts);
        h += `<path class="wire-hit" data-n="${w.net}" d="${d}"/><path class="wire idle ${w.bits > 1 ? 'bus' : ''}" data-k="${w.fk}" data-b="${w.bits}" data-n="${w.net}" d="${d}"/>`;
        if (w.bits > 1) h += `<text class="bv" data-k="${w.fk}" data-b="${w.bits}" x="${w.pts[0].x + 5}" y="${w.pts[0].y - 5}"></text>`;
      });
      for (const q of L.notes) h += `<text class="mn-note" x="${q.x}" y="${q.y}">${esc(q.text)}</text>`;
      if (!L.items.length) h += `<text class="mn-note" x="${L.w / 2}" y="${L.h / 2 + 3}" text-anchor="middle">(empty plate)</text>`;
      return h;
    }

    // little dots on the pins, lit while the pin is high
    pinDots(it, path, conn) {
      let h = '';
      for (const dir of ['in', 'out']) for (const name of Object.keys(it.pins[dir])) {
        const q = it.pins[dir][name], k = path + it.id + '.' + name, bus = q.bits > 1;
        h += `<circle class="pin ${dir === 'in' ? 'in' : 'out'} ${conn.has(k) ? 'conn' : ''} ${bus ? 'bus' : ''}" data-pk="${k}" data-b="${q.bits || 1}" cx="${q.x}" cy="${q.y}" r="${bus ? 4.6 : 3.2}"/>`;
      }
      return h;
    }

    item(it, path, conn) {
      const n = it.node, T = n.type, tr = `transform="translate(${it.x},${it.y})"`, nets = ` data-nets=" ${it.nets.join(' ')} "`;
      const label = n.props && n.props.label && T !== 'PLATE' && T !== 'LABEL' && it.kind !== 'port' ? `<text class="node-label" x="0" y="-5">${esc(n.props.label)}</text>` : '';
      if (it.kind === 'cluster') {
        const d = it.depthClass = it.child.depth % 4, ch = it.child;
        let h = `<g class="mc" ${tr}${nets}><rect class="mc-frame d${d}" width="${it.w}" height="${it.h}" rx="9"/><path class="mc-head d${d}" d="M0,9A9,9 0 0 1 9,0H${it.w - 9}A9,9 0 0 1 ${it.w},9V${ML.HEAD}H0Z"/>`;
        h += `<text class="mc-title" x="12" y="17.5">${esc(D.showName(it.ref))}</text><text class="mc-sub" x="${it.w - 12}" y="17.5">${esc(it.id)} · ${it.gates} gate${it.gates === 1 ? '' : 's'}</text>`;
        h += `<rect x="1" y="${ML.HEAD}" width="${it.w - 2}" height="${it.h - ML.HEAD - 1}" rx="8" fill="url(#mvDots)" pointer-events="none"/>`;
        h += `<g transform="translate(${ML.PAD},${ML.HEAD})">${this.level(ch, 0, 0, '')}</g>`;
        for (const s of it.stubs) {
          h += `<path class="wire-hit" data-n="${s.net}" d="M${s.x1},${s.y}H${s.x2}"/><path class="wire idle ${s.bits > 1 ? 'bus' : ''}" data-k="${s.key}" data-b="${s.bits}" data-n="${s.net}" d="M${s.x1},${s.y}H${s.x2}"/>`;
          if (s.bits > 1) h += `<text class="bv" data-k="${s.key}" data-b="${s.bits}" x="${Math.min(s.x1, s.x2) + 4}" y="${s.y - 5}"></text>`;
        }
        return h + this.pinDots(it, path, conn) + '</g>';
      }
      if (it.kind === 'port') {
        const isIn = it.dir === 'in', k = path + it.id + (isIn ? '.q' : '.d');
        const tick = isIn ? `<path class="mp-tick" d="M${it.w - 9},5L${it.w - 3},10L${it.w - 9},15"/>` : `<path class="mp-tick" d="M3,5L9,10L3,15"/>`;
        return `<g class="mp" ${tr}${nets} data-k="${k}" data-b="${it.bits}"><rect class="mp-body" ${S} x="1" y="1" width="${it.w - 2}" height="18" rx="5"/>${tick}` +
          `<text class="mp-label" x="${isIn ? 9 : 15}" y="13.5">${esc(it.label)}</text></g>`;
      }
      if (it.kind === 'chip') {
        const note = it.why === 'depth' ? '<title>Closed at this depth. Pick "All levels" to open it.</title>' : '';
        return `<g class="mch" ${tr}${nets}>${note}${D.bodySVG(n, it.d, { on: false })}${this.pinDots(it, path, conn)}</g>`;
      }
      if (it.kind === 'gate') {
        const out = it.d.outputs[0].name;
        return `<g class="mg" ${tr}${nets} data-k="${path}${it.id}.${out}">${D.bodySVG(n, it.d, { on: false })}${label}${this.pinDots(it, path, conn)}</g>`;
      }
      // other parts: switches, LEDs, displays, tunnels, bus parts, screens ...
      const idx = this.leaves.length;
      this.leaves.push({ it, path, ax: 0, ay: 0 });
      let body = D.bodySVG(n, it.d, this.leafState(n, path));
      if (T === 'SCREEN') body = body.replace(/data-sid="[^"]*"/, `data-sid="${esc(path + it.id)}"`);
      return `<g class="ml ${['INPUT', 'BUTTON', 'BUS_IN'].includes(T) ? 'click' : ''}" ${tr}${nets} data-leaf="${idx}"><g class="lb">${body}</g>${label}${this.pinDots(it, path, conn)}</g>`;
    }

    leafState(n, path) {
      const s = this.sim, st = { on: false };
      if (!s) return st;
      const pin = (k) => s.pin(path + k);
      switch (n.type) {
        case 'INPUT': st.on = !!s.get(path + n.id); break;
        case 'BUTTON': case 'CLOCK': st.on = !!s.get(path + n.id); break;
        case 'CONST1': st.on = true; break;
        case 'OUTPUT': case 'PROBE': st.on = !!pin(n.id + '.d'); break;
        case 'BUS_IN': case 'BUS_OUT': {
          const bits = D.fixProps(n.type, n.props).bits; let v = 0;
          for (let i = 0; i < bits; i++) if (n.type === 'BUS_IN' ? pin(n.id + '.q[' + i + ']') : pin(n.id + '.d[' + i + ']')) v += 2 ** i;
          st.val = v; break;
        }
        case 'SEG7': st.segs = D.SEGN.map((p) => !!pin(n.id + '.' + p)); break;
        case 'HEX': st.val = [0, 1, 2, 3].reduce((v, i) => v | (pin(n.id + '.d' + i) ? 1 << i : 0), 0); break;
        case 'SCREEN': { const sc = s.screens.get(path + n.id); if (sc && sc.def.mode === 'direct') st.px = sc.fb; break; }
      }
      return st;
    }

    // collect the elements that change while the circuit runs
    indexLive() {
      const q = (sel) => [...this.svg.querySelectorAll(sel)];
      this.wires = q('path.wire[data-k]').map((el) => ({ el, k: el.dataset.k, bits: +el.dataset.b, st: '' }));
      this.vals = q('text.bv').map((el) => ({ el, k: el.dataset.k, bits: +el.dataset.b, v: -1 }));
      this.pinEls = q('circle.pin[data-pk]').map((el) => ({ el, k: el.dataset.pk, bits: +el.dataset.b, on: -1 }));
      this.gates = q('g.mg').map((el) => ({ el, k: el.dataset.k, on: -1 }));
      this.ports = q('g.mp').map((el) => ({ el, k: el.dataset.k, bits: +el.dataset.b, on: -1 }));
      this.leafEls = q('g.ml').map((el) => { const L = this.leaves[+el.dataset.leaf]; return { el, body: el.querySelector('.lb'), L, sig: null }; });
      this.parts = q('[data-nets]').map((el) => ({ el, nets: el.dataset.nets }));
      this.shots = new Map();
      this.screenEls();
      // absolute position of every leaf (for clicking single bits of a Bit input)
      for (const e of this.leafEls) {
        let x = 0, y = 0;
        for (let n = e.el; n && n !== this.world; n = n.parentNode) {
          const t = n.getAttribute && n.getAttribute('transform'), m = t && /translate\(([-\d.]+),([-\d.]+)\)/.exec(t);
          if (m) { x += +m[1]; y += +m[2]; }
        }
        e.L.ax = x; e.L.ay = y;
      }
    }

    // pixel screens: one canvas each, drawn from the simulator's framebuffer
    screenEls() {
      this.canvases = new Map();
      for (const fo of this.svg.querySelectorAll('.px-fo')) {
        const sid = fo.dataset.sid, w = +fo.getAttribute('width'), h = +fo.getAttribute('height');
        const leaf = this.leaves.find((l) => (l.path + l.it.id) === sid);
        if (!leaf) continue;
        const g = leaf.it.d.geom, canvas = document.createElement('canvas');
        canvas.width = g.w; canvas.height = g.h;
        canvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;background:#050A16';
        const ctx = canvas.getContext('2d'), img = ctx.createImageData(g.w, g.h);
        fo.appendChild(canvas);
        this.canvases.set(sid, { canvas, ctx, img, u32: new Uint32Array(img.data.buffer), w: g.w, h: g.h, ver: -1, color: g.color });
      }
    }

    // ---------------------------------------------------------------- live values
    update() {
      if (!this.el) return;
      const s = this.sim;
      for (const w of this.wires) {
        let st = 'idle';
        if (s) st = w.bits > 1 ? (s.bus(w.k, w.bits) ? 'hi' : 'lo') : (s.isZ(w.k) ? 'z' : (s.pin(w.k) ? 'hi' : 'lo'));
        if (st !== w.st) { w.el.setAttribute('class', 'wire ' + st + (w.bits > 1 ? ' bus' : '') + (this.trace && w.el.dataset.n === String(this.trace.net) ? ' tr' : '')); w.st = st; }
      }
      if (!s) return;
      for (const v of this.vals) {
        const x = s.bus(v.k, v.bits);
        if (x !== v.v) { v.el.textContent = fmtVal(x, v.bits); v.v = x; }
      }
      for (const p of this.pinEls) { const on = p.bits > 1 ? (s.bus(p.k, p.bits) ? 1 : 0) : (s.pin(p.k) ? 1 : 0); if (on !== p.on) { p.el.classList.toggle('hi', !!on); p.on = on; } }
      for (const g of this.gates) { const on = s.pin(g.k) ? 1 : 0; if (on !== g.on) { g.el.classList.toggle('hi', !!on); g.on = on; } }
      for (const p of this.ports) {
        const on = p.bits > 1 ? (s.bus(p.k, p.bits) ? 1 : 0) : (s.pin(p.k) ? 1 : 0);
        if (on !== p.on) { p.el.classList.toggle('hi', !!on); p.on = on; }
      }
      for (const e of this.leafEls) {
        const n = e.L.it.node;
        if (n.type === 'SCREEN' && e.L.it.d.geom.mode !== 'direct') continue;
        const st = this.leafState(n, e.L.path), sig = JSON.stringify(st.px ? Object.assign({}, st, { px: st.px.join('') }) : st);
        if (sig !== e.sig) { e.body.innerHTML = D.bodySVG(n, e.L.it.d, st); e.sig = sig; }
      }
      for (const [sid, c] of this.canvases || []) {
        const sc = s.screens.get(sid);
        if (!sc || sc.def.mode === 'direct' || c.ver === sc.ver) continue;
        Editor.prototype.drawScreen(c, sc, c.color);
      }
      this.updateReadout();
    }

    // ---------------------------------------------------------------- tracing a signal
    setTrace(net, key, bits) {
      this.trace = net == null ? null : { net, key, bits };
      this.svg.classList.toggle('tracing', !!this.trace);
      for (const w of this.wires) { w.st = ''; }
      for (const p of this.parts) p.el.classList.toggle('tr', !!this.trace && p.nets.includes(' ' + net + ' '));
      this.update();
      this.updateReadout();
    }

    updateReadout() {
      const r = this.readout;
      if (!this.trace) { r.classList.add('hidden'); return; }
      const t = this.trace, s = this.sim;
      let v = 'no live values';
      if (s) { if (t.bits > 1) { const x = s.bus(t.key, t.bits); v = fmtVal(x, t.bits) + ' (' + t.bits + '-bit bus)'; } else v = s.isZ(t.key) ? 'floating' : (s.pin(t.key) ? '1 (high)' : '0 (low)'); }
      r.innerHTML = `<b>Tracing a signal</b><span>${esc(v)}</span><button class="icon-btn" data-mv="untrace" title="Stop tracing">${ic('close', 12)}</button>`;
      r.classList.remove('hidden');
    }

    // ---------------------------------------------------------------- view: pan and zoom
    applyView() {
      if (!this.world) return;
      this.world.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.k})`);
      this.svg.classList.toggle('far', this.k < 0.4);
      this.svg.classList.toggle('mid', this.k < 0.18);
      const z = this.bar && this.bar.querySelector('.mv-zoom'); if (z) z.textContent = Math.round(this.k * 100) + '%';
      this.updateMini();
    }

    // whole() = everything in view. Otherwise (first view of a big map) never go below a readable zoom: start at the inputs on the left
    fit(whole) {
      if (!this.el) return;
      const r = this.stage.getBoundingClientRect(), root = this.lay.root, m = 30;
      let k = clamp(Math.min((r.width - 2 * m) / root.w, (r.height - 2 * m) / root.h), 0.02, 1.2);
      if (!whole && k < MIN_START) k = MIN_START;
      this.k = k;
      this.tx = root.w * k + 2 * m > r.width ? m : (r.width - root.w * k) / 2;
      this.ty = root.h * k + 2 * m > r.height ? m : (r.height - root.h * k) / 2;
      this.applyView();
    }

    // small overview in the corner: every chip as a box, plus the part you are looking at
    buildMini() {
      const root = this.lay.root, rects = [];
      const walk = (L, ox, oy, d) => {
        for (const it of L.items) {
          if (it.kind !== 'cluster') continue;
          rects.push(`<rect class="mm-box d${d % 4}" x="${ox + it.x}" y="${oy + it.y}" width="${it.w}" height="${it.h}"/>`);
          walk(it.child, ox + it.x + ML.PAD, oy + it.y + ML.HEAD, d + 1);
        }
      };
      walk(root, 0, 0, 0);
      const s = Math.min(190 / root.w, 110 / root.h), mw = Math.max(40, root.w * s), mh = Math.max(24, root.h * s);
      this.miniScale = s;
      const svg = this.mini.querySelector('svg');
      svg.setAttribute('viewBox', `0 0 ${root.w} ${root.h}`); svg.setAttribute('width', mw); svg.setAttribute('height', mh);
      svg.innerHTML = `<rect class="mm-root" width="${root.w}" height="${root.h}"/>${rects.join('')}<rect class="mm-view" x="0" y="0" width="10" height="10"/>`;
      this.miniView = svg.querySelector('.mm-view');
      this.miniSvg = svg;
    }

    updateMini() {
      if (!this.miniView) return;
      const r = this.stage.getBoundingClientRect(), root = this.lay.root;
      const need = root.w * this.k > r.width * 1.02 || root.h * this.k > r.height * 1.02;
      this.mini.classList.toggle('hidden', !need);
      this.miniView.setAttribute('x', -this.tx / this.k); this.miniView.setAttribute('y', -this.ty / this.k);
      this.miniView.setAttribute('width', r.width / this.k); this.miniView.setAttribute('height', r.height / this.k);
    }

    jumpTo(wx, wy) {
      const r = this.stage.getBoundingClientRect();
      this.tx = r.width / 2 - wx * this.k; this.ty = r.height / 2 - wy * this.k;
      this.applyView();
    }

    zoomAt(f, cx, cy) {
      const r = this.stage.getBoundingClientRect(), px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
      const nk = clamp(this.k * f, 0.02, 5), real = nk / this.k;
      this.tx = px - (px - this.tx) * real; this.ty = py - (py - this.ty) * real; this.k = nk;
      this.applyView();
    }

    toWorld(e) {
      const r = this.stage.getBoundingClientRect();
      return { x: (e.clientX - r.left - this.tx) / this.k, y: (e.clientY - r.top - this.ty) / this.k };
    }

    bindEvents() {
      this.bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mv]');
        if (!b || b.tagName === 'SELECT') return;
        const a = b.dataset.mv;
        if (a === 'close') this.close();
        else if (a === 'fit') this.fit(true);
        else if (a === 'in') this.zoomAt(1.25);
        else if (a === 'out') this.zoomAt(1 / 1.25);
        else if (a === 'pause') { this.paused = !this.paused; this.renderBar(); }
      });
      this.bar.addEventListener('change', (e) => {
        const a = e.target.dataset.mv;
        if (a !== 'depth' && a !== 'mode') return;
        if (a === 'depth') this.depth = e.target.value; else this.mode = e.target.value;
        this.trace = null; this.svg.classList.remove('tracing'); this.build(true);
      });
      this.readout.addEventListener('click', (e) => { if (e.target.closest('[data-mv=untrace]')) this.setTrace(null); });
      this.stage.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
      this.stage.addEventListener('pointerdown', (e) => this.onDown(e));
      this.mini.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        const go = (ev) => { const b = this.miniSvg.getBoundingClientRect(); this.jumpTo((ev.clientX - b.left) / b.width * this.lay.root.w, (ev.clientY - b.top) / b.height * this.lay.root.h); };
        go(e);
        const up = () => { window.removeEventListener('pointermove', go); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', go); window.addEventListener('pointerup', up);
      });
    }

    onDown(e) {
      if (e.button !== 0 && e.button !== 1) return;
      if (e.target.closest('.mv-readout') || e.target.closest('.mv-mini')) return;
      // switches and buttons
      const lf = e.target.closest('.ml.click');
      if (lf && e.button === 0 && this.sim) { this.press(lf, e); return; }
      const sx = e.clientX, sy = e.clientY, tx = this.tx, ty = this.ty;
      let moved = false;
      const hit = e.target.closest('.wire-hit');
      this.stage.classList.add('drag');
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
        moved = true; this.tx = tx + ev.clientX - sx; this.ty = ty + ev.clientY - sy; this.applyView();
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        this.stage.classList.remove('drag');
        if (moved) return;
        if (hit) {
          const net = +hit.dataset.n, w = this.wires.find((q) => q.el.dataset.n === hit.dataset.n);
          this.setTrace(net, w ? w.k : '', w ? w.bits : 1);
        } else if (this.trace) this.setTrace(null);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }

    press(g, e) {
      const L = this.leaves[+g.dataset.leaf], n = L.it.node, s = this.sim;
      e.preventDefault();
      if (n.type === 'INPUT') { s.toggle(L.path + n.id); s.settle(); this.update(); }
      else if (n.type === 'BUS_IN') {
        if (L.path) return;
        const p = this.toWorld(e), bit = D.busBitAt(D.fixProps('BUS_IN', n.props).bits, p.x - L.ax, p.y - L.ay);
        if (bit >= 0) { s.toggle(n.id + '[' + bit + ']'); s.settle(); this.update(); }
      } else if (n.type === 'BUTTON') {
        const key = L.path + n.id;
        s.set(key, 1); s.settle(); this.update();
        const up = () => { window.removeEventListener('pointerup', up); if (this.sim) { this.sim.set(key, 0); this.sim.settle(); this.update(); } };
        window.addEventListener('pointerup', up);
      }
    }
  }

  window.MapView = MapView;
  window.MapView.isMapName = ML.isMapName;
})();
