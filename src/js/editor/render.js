/* Editor / render: Drawing the plate (SVG) and the pixel-screen canvases. */
(function () {
  'use strict';
  const { G, esc, routePts, orthoPts, hopPath, simplify } = EditorKit;

  EditorKit.mix(Editor, {
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
      this._laid = laid;
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
      if (this.sel && this.sel.type === 'wire' && !this.editLocked) {
        const L = laid.find((q) => q.w.id === this.sel.id);
        if (L) for (let i = 1; i + 1 < L.pts.length - 1; i++) {
          const p = L.pts[i], q = L.pts[i + 1], vert = p.x === q.x;
          if (!vert && p.y !== q.y) continue;
          if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) < 14) continue;
          h += `<rect class="seg-handle ${vert ? 'v' : 'h'}" data-seg="${L.w.id}:${i}" x="${(p.x + q.x) / 2 - 5}" y="${(p.y + q.y) / 2 - 5}" width="10" height="10" rx="3"><title>Drag to move this part of the wire</title></rect>`;
        }
      }
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
    },

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
    },

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
    },
  });
})();
