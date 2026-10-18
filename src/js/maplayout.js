/* Map layout: turns a plate into a fully expanded "render map".
 *
 * Every chip is opened into a framed cluster that holds the plate inside it, and so on all the way down to
 * the gates. Each level gets an automatic left-to-right layout (inputs on the left, outputs on the right,
 * logic depth in between), so you can read the signal flow instead of hunting for it.
 *
 *   layout(plate, lib, { maxDepth }) -> { root, stats }
 *
 * A level L = { plate, path, w, h, items, wires, notes, ports }. Coordinates inside a level are relative to
 * that level's own origin. A cluster item draws its child level at (PAD, HEAD) inside its frame.
 *
 * Pure data, no DOM, so it runs in the tests too.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gates.js'));
  else root.MapLayout = factory(root.GateDefs);
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  const PAD = 14, HEAD = 26, MAX_DEPTH = 24;
  const PORT_TYPES = ['INPUT', 'OUTPUT', 'BUS_IN', 'BUS_OUT'];
  const SINK_TYPES = ['OUTPUT', 'BUS_OUT', 'SEG7', 'HEX', 'PROBE', 'SCREEN'];
  const ALAP_TYPES = ['CONST0', 'CONST1', 'TUNNEL_OUT'];     // sources that sit just before their first reader
  const isGateType = (t) => D.GATES.includes(t) || t === 'TRI';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const pinsOf = (d) => {
    const m = { in: {}, out: {} };
    for (const q of d.inputs) m.in[q.name] = { x: q.x, y: q.y, bits: q.bits || 1, label: q.label };
    for (const q of d.outputs) m.out[q.name] = { x: q.x, y: q.y, bits: q.bits || 1, label: q.label };
    return m;
  };

  // ------------------------------------------------------------------ small helpers
  function simplify(pts) {
    const a = [];
    for (const p of pts) { const q = a[a.length - 1]; if (!q || q.x !== p.x || q.y !== p.y) a.push({ x: p.x, y: p.y }); }
    const out = [];
    for (let i = 0; i < a.length; i++) {
      const p = out[out.length - 1], q = a[i], r = a[i + 1];
      if (p && r && ((p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y))) continue;
      out.push(q);
    }
    return out;
  }

  // least squares with a minimum gap: nodes in one column keep their order, stay apart and sit as close
  // to where their wires want them as possible (pool adjacent violators)
  function packColumn(nodes, desired, weight, gap) {
    const n = nodes.length;
    if (!n) return;
    const off = []; let o = 0;
    for (let i = 0; i < n; i++) { off.push(o); o += nodes[i].h + gap; }
    const blocks = [];
    for (let i = 0; i < n; i++) {
      blocks.push({ sum: (desired[i] - off[i]) * weight[i], w: weight[i], from: i, to: i });
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
        if (a.sum / a.w <= b.sum / b.w) break;
        a.sum += b.sum; a.w += b.w; a.to = b.to; blocks.pop();
      }
    }
    for (const b of blocks) { const v = b.sum / b.w; for (let i = b.from; i <= b.to; i++) nodes[i].y = v + off[i]; }
  }

  // ------------------------------------------------------------------ "Auto flow": layers left to right by logic depth
  function placeFlow(L, plate, edges) {
    const n = L.items.length;
    L.items.forEach((it, i) => { it.i = i; it.out = []; it.inn = []; });
    for (const e of edges) { e.a.out.push(e); e.b.inn.push(e); }

    // ---- break feedback loops (latches): DFS from the left, an edge into a node still on the stack goes backwards
    const mark = new Uint8Array(n), post = [];
    const dfs = (u) => {
      mark[u.i] = 1;
      for (const e of u.out) {
        if (e.b === u || mark[e.b.i] === 1) { e.back = true; continue; }
        if (mark[e.b.i] === 0) dfs(e.b);
      }
      mark[u.i] = 2; post.push(u);
    };
    const starts = L.items.filter((it) => !it.inn.length).sort((p, q) => p.ox - q.ox || p.oy - q.oy)
      .concat(L.items.slice().sort((p, q) => p.ox - q.ox || p.oy - q.oy));
    for (const s of starts) if (mark[s.i] === 0) dfs(s);

    // ---- layers: longest path from the left
    for (const it of L.items) it.layer = 0;
    for (let k = post.length - 1; k >= 0; k--) {
      const u = post[k];
      for (const e of u.out) if (!e.back) e.b.layer = Math.max(e.b.layer, u.layer + 1);
    }
    // sources that are not real inputs sit right before their first reader
    for (const it of L.items) {
      if (!ALAP_TYPES.includes(it.node.type) || it.inn.length) continue;
      const fw = it.out.filter((e) => !e.back);
      if (fw.length) it.layer = Math.max(0, Math.min(...fw.map((e) => e.b.layer)) - 1);
    }
    let maxL = 0;
    for (const it of L.items) maxL = Math.max(maxL, it.layer);
    const isSink = (it) => it.kind === 'port' ? it.dir === 'out' : (it.kind === 'part' && SINK_TYPES.includes(it.node.type));
    for (const it of L.items) if (isSink(it)) it.layer = maxL;
    // make sure every forward edge still goes left to right (a pulled-in source can break it)
    for (const e of edges) if (!e.back && e.b.layer <= e.a.layer) e.back = true;
    const LN = maxL + 1;
    const cols = Array.from({ length: LN }, () => []);
    for (const it of L.items) cols[it.layer].push(it);

    // ---- long edges get a dummy node in every layer they cross, so their wire has a lane there
    const segs = [];            // one per pair of adjacent layers: {a, b, ay, by, net, e}
    for (const e of edges) {
      if (e.back) continue;
      let cur = e.a, ay = e.pa.y;
      e.chain = [];
      for (let l = e.a.layer + 1; l < e.b.layer; l++) {
        const d = { dummy: true, h: 8, w: 0, y: 0, layer: l, oy: (e.a.oy + e.b.oy) / 2, ox: 0 };
        cols[l].push(d);
        const s = { a: cur, b: d, ay, by: 4, net: e.fk, e }; segs.push(s); e.chain.push(s);
        cur = d; ay = 4;
      }
      const s = { a: cur, b: e.b, ay, by: e.pb.y, net: e.fk, e }; segs.push(s); e.chain.push(s);
    }
    // links between adjacent layers (from here on .sOut / .sIn hold the segments)
    for (const c of cols) c.forEach((it) => { it.sOut = []; it.sIn = []; });
    for (const s of segs) { s.a.sOut.push(s); s.b.sIn.push(s); }

    // ---- order inside each layer: start from where the user put things, then sweep to cut crossings
    for (const c of cols) c.sort((p, q) => p.oy - q.oy || p.ox - q.ox);
    const fixed0 = true;
    const setOrd = () => cols.forEach((c) => c.forEach((it, k) => { it.ord = k; }));
    setOrd();
    const sweep = (l, dirDown) => {
      const c = cols[l];
      const bary = new Map();
      for (const it of c) {
        const nb = dirDown ? it.sIn.map((s) => s.a) : it.sOut.map((s) => s.b);
        bary.set(it, nb.length ? nb.reduce((t, x) => t + x.ord, 0) / nb.length : it.ord);
      }
      c.sort((p, q) => bary.get(p) - bary.get(q) || p.ord - q.ord);
      c.forEach((it, k) => { it.ord = k; });
    };
    for (let it = 0; it < 4; it++) {
      for (let l = 1; l < LN; l++) sweep(l, true);
      for (let l = LN - 2; l >= (fixed0 ? 1 : 0); l--) sweep(l, false);
    }

    // ---- vertical placement: pack, then pull every node toward its wires
    const GAP = 16;
    for (const c of cols) { let y = 0; for (const it of c) { it.y = y; y += it.h + GAP; } }
    for (let it = 0; it < 10; it++) {
      const down = it % 2 === 0;
      const order = [];
      for (let l = 0; l < LN; l++) order.push(l);
      if (!down) order.reverse();
      for (const l of order) {
        const c = cols[l], want = [], wt = [];
        for (const nd of c) {
          const ss = down ? nd.sIn : nd.sOut;
          if (!ss.length) { want.push(nd.y); wt.push(0.15); continue; }
          let t = 0;
          for (const s of ss) t += down ? s.a.y + s.ay - s.by : s.b.y + s.by - s.ay;
          want.push(t / ss.length); wt.push(1);
        }
        packColumn(c, want, wt, GAP);
      }
    }
    let minY = Infinity;
    for (const c of cols) for (const it of c) minY = Math.min(minY, it.y);
    if (!isFinite(minY)) minY = 0;

    // ---- back edges (feedback): one lane above the level each
    const backs = edges.filter((e) => e.back);
    // ---- horizontal tracks: forward wires between layers k-1 and k share channel k
    const chStubs = new Array(LN + 1).fill(0), chTracks = new Array(LN + 1).fill(0);
    for (const e of backs) {
      e.sx = chStubs[e.a.layer + 1]++;          // stub after the source's layer
      e.tx = chStubs[e.b.layer]++;              // stub before the target's layer
    }
    const chanSegs = Array.from({ length: LN + 1 }, () => []);
    for (const s of segs) {
      const k = s.a.layer + 1;
      const ya = s.a.y + s.ay, yb = s.b.y + s.by;
      s.lo = Math.min(ya, yb); s.hi = Math.max(ya, yb); s.k = k;
      chanSegs[k].push(s);
    }
    for (let k = 0; k <= LN; k++) {
      const tracks = [];
      chanSegs[k].sort((p, q) => p.lo - q.lo || p.hi - q.hi);
      for (const s of chanSegs[k]) {
        s.track = 0;
        if (s.lo === s.hi) continue;
        let t = 0;
        for (; t < tracks.length; t++) if (tracks[t].every((o) => o.net === s.net || o.hi < s.lo - 3 || o.lo > s.hi + 3)) break;
        if (t === tracks.length) tracks.push([]);
        tracks[t].push(s); s.track = t;
      }
      chTracks[k] = tracks.length;
    }
    const chW = chStubs.map((st, k) => 18 + st * 7 + (chTracks[k] ? 8 + chTracks[k] * 7 : 0));
    const colW = cols.map((c) => Math.max(12, ...c.map((it) => it.w)));
    const chStart = [], colX = [];
    let x = 0;
    for (let l = 0; l < LN; l++) { chStart[l] = x; colX[l] = x + chW[l]; x = colX[l] + colW[l]; }
    chStart[LN] = x; const totalW = x + chW[LN];

    const topM = 14 + backs.length * 7;
    for (let l = 0; l < LN; l++) {
      for (const it of cols[l]) {
        it.y = it.y - minY + topM;
        if (!it.dummy) it.x = it.kind === 'port' && it.dir === 'out' ? colX[l] + colW[l] - it.w : colX[l];
      }
    }
    const absOut = (it, pin) => ({ x: it.x + it.pins.out[pin].x, y: it.y + it.pins.out[pin].y });
    const absIn = (it, pin) => ({ x: it.x + it.pins.in[pin].x, y: it.y + it.pins.in[pin].y });
    const trackX = (s) => chStart[s.k] + 8 + chStubs[s.k] * 7 + (chTracks[s.k] ? 8 + s.track * 7 : 0);

    // ---- wire shapes
    for (const e of edges) {
      const src = absOut(e.a, e.fpin), dst = absIn(e.b, e.tpin);
      let pts;
      if (!e.back) {
        pts = [src]; let yc = src.y;
        for (const s of e.chain) {
          const vx = trackX(s), yn = s.b.dummy ? s.b.y + 4 : dst.y;
          pts.push({ x: vx, y: yc }, { x: vx, y: yn }); yc = yn;
        }
        pts.push(dst);
      } else {
        e.span = Math.abs(colX[e.b.layer] - colX[e.a.layer]);
        pts = null;
      }
      e.pts = pts; e.src = src; e.dst = dst;
    }
    backs.sort((p, q) => (p.span - q.span) || (p.a.i - q.a.i));
    backs.forEach((e, i) => {
      const laneY = topM - 8 - 7 * i;
      const sx = chStart[e.a.layer + 1] + 8 + 7 * e.sx, tx = chStart[e.b.layer] + 8 + 7 * e.tx;
      e.pts = [e.src, { x: sx, y: e.src.y }, { x: sx, y: laneY }, { x: tx, y: laneY }, { x: tx, y: e.dst.y }, e.dst];
    });
    for (const e of edges) {
      e.pts = simplify(e.pts);
      L.wires.push({ id: e.w.id, from: e.w.from, to: e.w.to, fk: e.fk, tk: e.tk, bits: e.bits, pts: e.pts, back: e.back, fnode: e.a.id, fpin: e.fpin });
    }

    // ---- size
    let maxB = 0;
    for (const it of L.items) maxB = Math.max(maxB, it.y + it.h);
    L.w = Math.max(totalW, 120); L.h = Math.max(maxB + 14, 44);
    // notes (Label parts) go under the circuit, wrapped to the width
    const labels = plate.nodes.filter((q) => q.type === 'LABEL' && q.props && q.props.label).sort((p, q) => p.y - q.y || p.x - q.x);
    let ny = L.h;
    const cw = Math.max(200, L.w - 20), cpl = Math.floor(cw / 5.3);
    for (const q of labels) {
      const words = String(q.props.label).split(/\s+/), lines = []; let line = '';
      for (const wd of words) { if ((line + ' ' + wd).trim().length > cpl && line) { lines.push(line); line = wd; } else line = (line + ' ' + wd).trim(); }
      if (line) lines.push(line);
      for (const ln of lines) { L.notes.push({ text: ln, x: 12, y: ny + 10 }); ny += 13; }
      ny += 3;
    }
    if (labels.length) L.h = ny + 8;
    if (L.items.length === 0) { L.w = 140; L.h = 50; }
    L.w = Math.max(L.w, ...L.notes.map((q) => q.x + q.text.length * 5.3 + 10));

  }

  // ------------------------------------------------------------------ "Your layout": the plate as you drew it
  // Parts keep the order and the arrangement you gave them. A chip that opens into a bigger frame makes room by
  // stretching the plate only where it needs to: every x (and y) on the plate moves through one monotone map, so
  // columns stay columns, rows stay rows, and your wires keep their bends and stay in their corridors. At the end the
  // plate then shrinks to fit what is on it.
  const GR = 10;
  function routePts(x1, y1, x2, y2) {
    if (x2 >= x1 + 20) { const mx = Math.round((x1 + x2) / 2 / GR) * GR; return [{ x: x1, y: y1 }, { x: mx, y: y1 }, { x: mx, y: y2 }, { x: x2, y: y2 }]; }
    const ox = x1 + 10, ix = x2 - 10, my = y1 === y2 ? y1 + 30 : Math.round((y1 + y2) / 2 / GR) * GR;
    return [{ x: x1, y: y1 }, { x: ox, y: y1 }, { x: ox, y: my }, { x: ix, y: my }, { x: ix, y: y2 }, { x: x2, y: y2 }];
  }
  // same rule as the editor: a wire through your bends stays at right angles (first leg horizontal, last leg horizontal)
  function orthoPts(a, pts, b) {
    const all = [a].concat(pts, [b]), out = [a];
    for (let k = 1; k < all.length; k++) {
      const p = out[out.length - 1], q = all[k];
      if (p.x !== q.x && p.y !== q.y) out.push(k === all.length - 1 ? { x: p.x, y: q.y } : { x: q.x, y: p.y });
      out.push(q);
    }
    return out;
  }
  // One axis: `coords` are the places that matter (part edges, wire bends, plate edge); `spans` = [from, to, needed length]
  // are the parts that must become longer. Returns a function that moves any of those coordinates to its new place.
  function stretchAxis(coords, spans) {
    const c = [...new Set(coords)].sort((p, q) => p - q), at = new Map(c.map((v, i) => [v, i]));
    const need = c.map(() => []);
    for (const [a, b, len] of spans) if (at.has(a) && at.has(b) && b > a) need[at.get(b)].push([at.get(a), len]);
    const out = [c[0] || 0];
    for (let i = 1; i < c.length; i++) {
      let v = out[i - 1] + (c[i] - c[i - 1]);
      for (const [j, len] of need[i]) v = Math.max(v, out[j] + len);
      out.push(v);
    }
    return (x) => out[at.get(x)];
  }

  function placeOnPlate(L, plate, edges) {
    const items = L.items;
    const labels = plate.nodes.filter((q) => q.type === 'LABEL' && q.props && q.props.label);
    const noteW = (q) => String(q.props.label).length * 5.8 + 8;
    let PW = plate.width * GR, PH = plate.height * GR;
    for (const it of items) { PW = Math.max(PW, it.ox + it.nw + 10); PH = Math.max(PH, it.oy + it.nh + 10); }
    // the wires as they look on your plate (your bends, or the editor's automatic route)
    const natural = edges.map((e) => {
      const pa = e.a.npins.out[e.fpin], pb = e.b.npins.in[e.tpin];
      const A = { x: e.a.ox + pa.x, y: e.a.oy + pa.y }, B = { x: e.b.ox + pb.x, y: e.b.oy + pb.y };
      const poly = e.w.pts && e.w.pts.length ? orthoPts(A, e.w.pts, B) : routePts(A.x, A.y, B.x, B.y);
      return poly.slice(1, -1);
    });
    const xs = [0, PW], ys = [0, PH], sx = [], sy = [];
    for (const it of items) {
      xs.push(it.ox, it.ox + it.nw); ys.push(it.oy, it.oy + it.nh);
      if (it.w > it.nw) sx.push([it.ox, it.ox + it.nw, it.w]);
      if (it.h > it.nh) sy.push([it.oy, it.oy + it.nh, it.h]);
    }
    for (const q of labels) { xs.push(q.x, q.x + noteW(q)); ys.push(q.y, q.y + 16); }
    for (const poly of natural) for (const p of poly) { xs.push(p.x); ys.push(p.y); }
    const FX = stretchAxis(xs, sx), FY = stretchAxis(ys, sy);
    for (const it of items) { it.x = FX(it.ox); it.y = FY(it.oy); }
    const absOut = (it, pin) => ({ x: it.x + it.pins.out[pin].x, y: it.y + it.pins.out[pin].y });
    const absIn = (it, pin) => ({ x: it.x + it.pins.in[pin].x, y: it.y + it.pins.in[pin].y });
    edges.forEach((e, i) => {
      const A = absOut(e.a, e.fpin), B = absIn(e.b, e.tpin);
      const mid = natural[i].map((p) => ({ x: FX(p.x), y: FY(p.y) }));
      const pts = simplify(orthoPts(A, mid, B));
      L.wires.push({ id: e.w.id, from: e.w.from, to: e.w.to, fk: e.fk, tk: e.tk, bits: e.bits, pts, back: false, fnode: e.a.id, fpin: e.fpin });
    });
    for (const q of labels) L.notes.push({ text: String(q.props.label), x: FX(q.x) + 4, y: FY(q.y) + 14 });
    // the plate shrinks to fit what is on it: no empty room left over, 30 units of margin like a built-in plate
    let W = 0, H = 0;
    for (const it of items) { W = Math.max(W, it.x + it.w); H = Math.max(H, it.y + it.h); }
    for (const w of L.wires) for (const q of w.pts) { W = Math.max(W, q.x); H = Math.max(H, q.y); }
    for (const q of L.notes) { W = Math.max(W, q.x + q.text.length * 5.3); H = Math.max(H, q.y + 4); }
    L.w = Math.max(W + 30, 120); L.h = Math.max(H + 30, 60);
  }

  // ------------------------------------------------------------------ the layout of one plate
  function layoutLevel(plate, path, depth, isRoot, ctx, stack) {
    const L = { plate, path, depth, w: 0, h: 0, items: [], wires: [], notes: [], ports: {}, stats: { gates: 0, chips: 0, parts: 0, depth: depth } };
    const nodes = plate.nodes.filter((n) => n.type !== 'LABEL');
    const byId = new Map();

    // ---- one item per node
    for (const n of nodes) {
      const it = { id: n.id, node: n, x: 0, y: 0, w: 0, h: 0, pins: null, kind: 'part', path, layer: 0, ox: n.x, oy: n.y };
      const t = n.type;
      if (!isRoot && PORT_TYPES.includes(t)) {
        const isIn = t === 'INPUT' || t === 'BUS_IN', bus = t === 'BUS_IN' || t === 'BUS_OUT';
        const bits = bus ? D.fixProps(t, n.props).bits : 1;
        const label = ((n.props && n.props.label) || (isIn ? 'IN' : 'OUT')) + (bits > 1 ? '[' + bits + ']' : '');
        it.kind = 'port'; it.dir = isIn ? 'in' : 'out'; it.label = label; it.bits = bits;
        it.w = clamp(Math.ceil((label.length * 6.4 + 28) / 10) * 10, 40, 160); it.h = 20;
        { const d0 = D.describe(n, ctx.lib); it.nw = d0.w; it.nh = d0.h; it.npins = pinsOf(d0); }
        it.pins = isIn ? { in: {}, out: { q: { x: it.w, y: 10, bits } } } : { in: { d: { x: 0, y: 10, bits } }, out: {} };
      } else if (t === 'PLATE') {
        const ref = n.props && n.props.ref, child = ref ? ctx.lib.get(ref) : null;
        const d = D.describe(n, ctx.lib);
        L.stats.chips++; ctx.stats.chips++;
        if (child && !stack.includes(ref) && depth < ctx.maxDepth && depth < MAX_DEPTH) {
          const cl = layoutLevel(child, path + n.id + '/', depth + 1, false, ctx, stack.concat(ref));
          it.kind = 'cluster'; it.ref = ref; it.child = cl; it.nw = d.w; it.nh = d.h; it.npins = pinsOf(d);
          it.w = Math.max(cl.w + 2 * PAD, D.showName(ref).length * 7.4 + 90);
          it.h = cl.h + HEAD + PAD;
          it.pins = { in: {}, out: {} }; it.stubs = [];
          const cp = path + n.id + '/';
          for (const id of Object.keys(cl.ports)) {
            const p = cl.ports[id], y = HEAD + p.y, key = path + n.id + '.' + id;
            if (p.dir === 'in') { it.pins.in[id] = { x: 0, y, bits: p.bits, label: p.label }; it.stubs.push({ dir: 'in', x1: 0, x2: PAD + p.x, y, key, bits: p.bits, inner: cp + id + '.q' }); }
            else { it.pins.out[id] = { x: it.w, y, bits: p.bits, label: p.label }; it.stubs.push({ dir: 'out', x1: PAD + p.x + p.w, x2: it.w, y, key, bits: p.bits, inner: cp + id + '.d' }); }
            ctx.union(key, cp + id + (p.dir === 'in' ? '.q' : '.d'));
          }
          it.gates = cl.stats.gates;
          L.stats.gates += cl.stats.gates; L.stats.parts += cl.stats.parts; L.stats.chips += cl.stats.chips;
          L.stats.depth = Math.max(L.stats.depth, cl.stats.depth);
        } else {
          it.kind = 'chip'; it.w = d.w; it.h = d.h; it.pins = pinsOf(d); it.d = d;
          it.why = !child ? 'missing' : (stack.includes(ref) ? 'loop' : 'depth');
        }
      } else {
        const d = D.describe(n, ctx.lib);
        it.kind = isGateType(t) ? 'gate' : 'part'; it.w = d.w; it.h = d.h; it.pins = pinsOf(d); it.d = d;
        if (it.kind === 'gate') { L.stats.gates++; ctx.stats.gates++; } else L.stats.parts++;
        if (t === 'TUNNEL_IN' || t === 'TUNNEL_OUT') {
          const nm = String((n.props && n.props.name) || '').trim();
          if (nm) ctx.union('T:' + path + nm, path + n.id + '.' + (t === 'TUNNEL_IN' ? 'd' : 'q'));
        }
      }
      if (it.nw == null) { it.nw = it.w; it.nh = it.h; it.npins = it.pins; }
      it.pinKeys = [];
      for (const k of ['in', 'out']) for (const name of Object.keys(it.pins[k])) it.pinKeys.push(path + n.id + '.' + name);
      byId.set(n.id, it); L.items.push(it);
    }

    // ---- edges (one per wire)
    const edges = [];
    for (const w of plate.wires) {
      const a = byId.get(w.from.node), b = byId.get(w.to.node);
      if (!a || !b) continue;
      const pa = a.pins.out[w.from.pin], pb = b.pins.in[w.to.pin];
      if (!pa || !pb) continue;
      const fk = path + w.from.node + '.' + w.from.pin, tk = path + w.to.node + '.' + w.to.pin;
      ctx.union(fk, tk);
      edges.push({ w, a, b, pa, pb, fk, tk, fpin: w.from.pin, tpin: w.to.pin, bits: pa.bits || 1, back: false });
    }

    if (ctx.mode === 'flow') placeFlow(L, plate, edges); else placeOnPlate(L, plate, edges);

    // ports of this level (the parent uses them to place the pins of the cluster)
    for (const it of L.items) if (it.kind === 'port') L.ports[it.id] = { dir: it.dir, y: it.y + 10, x: it.x, w: it.w, bits: it.bits, label: it.label };
    L.stats.depth = Math.max(L.stats.depth, depth);
    ctx.levels.push(L);
    return L;
  }

  // ------------------------------------------------------------------ public
  function layout(plate, lib, opts) {
    opts = opts || {};
    const parent = new Map();
    const find = (k) => { let r = k; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r); let c = k; while (c !== r) { const nx = parent.get(c); parent.set(c, r); c = nx; } return r; };
    const union = (a, b) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
    const ctx = { lib, mode: opts.mode === 'flow' ? 'flow' : 'plate', maxDepth: opts.maxDepth == null ? Infinity : opts.maxDepth, union, stats: { gates: 0, chips: 0 }, levels: [] };
    const root = layoutLevel(plate, '', 0, true, ctx, [plate.name]);
    // net numbers: everything wired together (also through chip borders and tunnels) shares one
    const ids = new Map();
    const net = (k) => { if (!parent.has(k)) parent.set(k, k); const r = find(k); let v = ids.get(r); if (v === undefined) { v = ids.size; ids.set(r, v); } return v; };
    for (const L of ctx.levels) {
      for (const w of L.wires) w.net = net(w.fk);
      for (const it of L.items) {
        it.nets = [...new Set(it.pinKeys.map(net))];
        if (it.stubs) for (const s of it.stubs) s.net = net(s.key);
      }
    }
    return { root, stats: { gates: ctx.stats.gates, chips: ctx.stats.chips, depth: root.stats.depth, levels: ctx.levels.length }, net };
  }

  // a plate whose name contains ".map" (gpu.map, alu.map copy ...) gets the Render map button
  const isMapName = (name) => /\.map(?![A-Za-z0-9_])/i.test(String(name || ''));

  return { layout, PAD, HEAD, MAX_DEPTH, isGateType, isMapName };
});
