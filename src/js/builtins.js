/* Built-in parts. Every one is a real plate made of gates (and of other built-in plates), so you can
 * double-click a chip and see the gates inside it, all the way down to NAND/NOR level.
 * They resolve through the same library lookup as your own plates and are read-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gates.js'));
  else root.Builtins = factory(root.GateDefs);
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  const defs = new Map();
  const cache = new Map();
  const order = [];

  function get(name) {
    if (cache.has(name)) return cache.get(name);
    const d = defs.get(name);
    if (!d) return null;
    const p = d.make();
    cache.set(name, p);
    return p;
  }
  const lib = { get };

  // Tiny drawing kit. A "ref" is 'nodeId.pinName'. Gates return {id, y, i:[...]} so feedback can be wired later.
  function build(name, fn) {
    const p = { format: 1, name, width: 20, height: 20, nodes: [], wires: [], nextId: 1, builtin: true };
    const add = (type, x, y, props) => {
      const id = 'n' + p.nextId++;
      p.nodes.push({ id, type, x, y, props: Object.assign(D.defaultProps(type), props || {}) });
      return id;
    };
    // pts (optional): corners the wire runs through, so it can go around chips instead of behind them
    const w = (src, dst, pts) => {
      const [a, ap] = src.split('.'), [b, bp] = dst.split('.');
      const wire = { id: 'w' + p.nextId++, from: { node: a, pin: ap }, to: { node: b, pin: bp } };
      if (pts) wire.pts = pts;
      p.wires.push(wire);
    };
    const kit = {
      w,
      in: (label, x, y) => add('INPUT', x, y, { label }) + '.q',
      out: (label, x, y, src) => { const id = add('OUTPUT', x, y, { label }); if (src) w(src, id + '.d'); return id + '.d'; },
      one: (x, y) => add('CONST1', x, y) + '.q',
      note: (text, x, y) => { add('LABEL', x, y, { label: text }); },
      tin: (name, x, y, src) => { const id = add('TUNNEL_IN', x, y, { name }); if (src) w(src, id + '.d'); },
      tout: (name, x, y) => add('TUNNEL_OUT', x, y, { name }) + '.q',
      gate(type, x, y, ins) {
        const n = ins.length;
        const id = add(type, x, y, D.MULTI.includes(type) ? { inputs: n } : {});
        const g = { id, y: id + '.y', i: ins.map((_, k) => id + '.i' + k) };
        ins.forEach((src, k) => { if (src) w(src, g.i[k]); });
        return g;
      },
      // ---- buses: a Bit input / Bit output is one N-bit pin, a splitter fans a bus out into N wires, a merger packs N wires into a bus
      bin: (label, bits, x, y) => add('BUS_IN', x, y, { label, bits }) + '.q',
      bout: (label, bits, x, y, src) => { const id = add('BUS_OUT', x, y, { label, bits }); if (src) w(src, id + '.d'); return id + '.d'; },
      split(bits, x, y, src) {
        const id = add('SPLIT', x, y, { bits });
        if (src) w(src, id + '.bus');
        return Array.from({ length: bits }, (_, i) => id + '.o' + i);
      },
      merge(bits, x, y, srcs) {
        const id = add('MERGE', x, y, { bits });
        (srcs || []).forEach((s, i) => { if (s) w(s, id + '.i' + i); });
        return id + '.bus';
      },
      // where a pin sits on the plate
      at(ref) {
        const [nid, pin] = ref.split('.'), n = p.nodes.find((q) => q.id === nid), d = D.describe(n, lib);
        const q = d.outputs.concat(d.inputs).find((z) => z.name === pin);
        return { x: n.x + q.x, y: n.y + q.y };
      },
      // wire that runs down its own vertical lane (x = lx) so parallel bit wires do not sit on top of each other
      lane(src, dst, lx) {
        const a = kit.at(src), b = kit.at(dst);
        w(src, dst, [{ x: lx, y: a.y }, { x: lx, y: b.y }]);
      },
      // Another built-in plate as a chip. `conn` maps input label -> source ref.
      chip(ref, x, y, conn) {
        const child = get(ref);
        const id = add('PLATE', x, y, { ref });
        const dd = D.describe({ id, type: 'PLATE', props: { ref } }, lib);
        const ports = D.portsOf(child);
        const c = { id, w: dd.w, h: dd.h, i: {}, o: {} };
        ports.inputs.forEach((q) => { c.i[q.label] = id + '.' + q.id; });
        ports.outputs.forEach((q) => { c.o[q.label] = id + '.' + q.id; });
        for (const [label, src] of Object.entries(conn || {})) if (src) w(src, c.i[label]);
        return c;
      },
    };
    fn(kit);
    // size the plate to fit its parts
    let mx = 0, my = 0;
    for (const n of p.nodes) {
      const d = D.describe(n, lib);
      mx = Math.max(mx, n.x + d.w); my = Math.max(my, n.y + d.h);
    }
    p.width = Math.max(20, Math.ceil((mx + 30) / 10));
    p.height = Math.max(14, Math.ceil((my + 30) / 10));
    return p;
  }

  function def(cat, name, make) { defs.set(name, { cat, make }); order.push(name); }

  // ------------------------------------------------------------------ combinational
  def('Combinational', 'Half adder', () => build('Half adder', (k) => {
    const A = k.in('A', 10, 10), B = k.in('B', 10, 90);
    const x = k.gate('XOR', 140, 0, [A, B]), a = k.gate('AND', 140, 80, [A, B]);
    k.out('S', 280, 20, x.y); k.out('C', 280, 100, a.y);
  }));

  def('Combinational', 'Full adder', () => build('Full adder', (k) => {
    const A = k.in('A', 10, 10), B = k.in('B', 10, 90), Ci = k.in('Cin', 10, 200);
    const h1 = k.chip('Half adder', 130, 10, { A, B });
    const h2 = k.chip('Half adder', 300, 100, { A: h1.o.S, B: Ci });
    const or = k.gate('OR', 470, 170, [h1.o.C, h2.o.C]);
    k.out('S', 470, 110, h2.o.S); k.out('Cout', 580, 190, or.y);
  }));

  def('Combinational', 'MUX 2:1', () => build('MUX 2:1', (k) => {
    const D0 = k.in('D0', 10, 10), D1 = k.in('D1', 10, 90), S = k.in('S', 10, 170);
    const nS = k.gate('NOT', 90, 150, [S]);
    const a = k.gate('AND', 190, 0, [D0, nS.y]), b = k.gate('AND', 190, 80, [D1, S]);
    const o = k.gate('OR', 310, 40, [a.y, b.y]);
    k.out('Y', 430, 50, o.y);
  }));

  def('Combinational', 'MUX 4:1', () => build('MUX 4:1', (k) => {
    const D = [0, 1, 2, 3].map((n) => k.in('D' + n, 10, 10 + n * 60));
    const S0 = k.in('S0', 10, 290), S1 = k.in('S1', 10, 350);
    const m0 = k.chip('MUX 2:1', 190, 10, { D0: D[0], D1: D[1], S: S0 });
    const m1 = k.chip('MUX 2:1', 190, 130, { D0: D[2], D1: D[3], S: S0 });
    const m2 = k.chip('MUX 2:1', 370, 70, { D0: m0.o.Y, D1: m1.o.Y, S: S1 });
    k.out('Y', 540, 90, m2.o.Y);
  }));

  def('Combinational', 'Decoder 2:4', () => build('Decoder 2:4', (k) => {
    const A0 = k.in('A0', 10, 10), A1 = k.in('A1', 10, 70), EN = k.in('EN', 10, 200);
    const n0 = k.gate('NOT', 90, 0, [A0]), n1 = k.gate('NOT', 90, 60, [A1]);
    for (let m = 0; m < 4; m++) {
      const g = k.gate('AND', 250, m * 80, [EN, m & 1 ? A0 : n0.y, m & 2 ? A1 : n1.y]);
      k.out('Y' + m, 400, m * 80 + 20, g.y);
    }
  }));

  def('Combinational', 'DEMUX 1:4', () => build('DEMUX 1:4', (k) => {
    const D1 = k.in('D', 10, 10), S0 = k.in('S0', 10, 70), S1 = k.in('S1', 10, 130);
    const dec = k.chip('Decoder 2:4', 160, 10, { A0: S0, A1: S1, EN: D1 });
    for (let m = 0; m < 4; m++) k.out('Y' + m, 330, 20 + m * 30, dec.o['Y' + m]);
  }));

  def('Combinational', 'Encoder 4:2', () => build('Encoder 4:2', (k) => {
    const I = [0, 1, 2, 3].map((n) => k.in('I' + n, 10, 10 + n * 60));
    const n2 = k.gate('NOT', 100, 110, [I[2]]);
    const t = k.gate('AND', 200, 60, [I[1], n2.y]);
    const a0 = k.gate('OR', 320, 100, [I[3], t.y]);
    const a1 = k.gate('OR', 320, 180, [I[2], I[3]]);
    const v = k.gate('OR', 320, 260, I);
    k.out('A0', 460, 110, a0.y); k.out('A1', 460, 190, a1.y); k.out('V', 460, 290, v.y);
    k.note('highest input wins; V = any input high', 10, 330);
  }));

  def('Combinational', 'Comparator 1-bit', () => build('Comparator 1-bit', (k) => {
    const A = k.in('A', 10, 20), B = k.in('B', 10, 120);
    const nA = k.gate('NOT', 90, 70, [A]), nB = k.gate('NOT', 90, 160, [B]);
    const gt = k.gate('AND', 220, 0, [A, nB.y]);
    const eq = k.gate('XNOR', 220, 90, [A, B]);
    const lt = k.gate('AND', 220, 180, [nA.y, B]);
    k.out('GT', 360, 20, gt.y); k.out('EQ', 360, 110, eq.y); k.out('LT', 360, 200, lt.y);
  }));

  def('Combinational', 'Comparator 4-bit', () => build('Comparator 4-bit', (k) => {
    const A = [0, 1, 2, 3].map((n) => k.in('A' + n, 10, 10 + n * 50));
    const B = [0, 1, 2, 3].map((n) => k.in('B' + n, 10, 230 + n * 50));
    const c = [0, 1, 2, 3].map((n) => k.chip('Comparator 1-bit', 160, 10 + n * 110, { A: A[n], B: B[n] }));
    const G = (n) => c[n].o.GT, E = (n) => c[n].o.EQ;
    const t1 = k.gate('AND', 360, 10, [E(3), G(2)]);
    const t2 = k.gate('AND', 360, 90, [E(3), E(2), G(1)]);
    const t3 = k.gate('AND', 360, 190, [E(3), E(2), E(1), G(0)]);
    const gt = k.gate('OR', 500, 80, [G(3), t1.y, t2.y, t3.y]);
    const eq = k.gate('AND', 360, 320, [E(0), E(1), E(2), E(3)]);
    const lt = k.gate('NOR', 500, 250, [gt.y, eq.y]);
    k.out('GT', 640, 100, gt.y); k.out('EQ', 640, 340, eq.y); k.out('LT', 640, 270, lt.y);
  }));

  // ------------------------------------------------------------------ sequential
  def('Sequential', 'SR latch', () => build('SR latch', (k) => {
    const R = k.in('R', 10, 20), S = k.in('S', 10, 130);
    const gQ = k.gate('NOR', 140, 10, [R, null]);
    const gN = k.gate('NOR', 140, 120, [S, null]);
    k.w(gN.y, gQ.i[1]); k.w(gQ.y, gN.i[1]);
    k.out('Q', 290, 20, gQ.y); k.out('Qn', 290, 130, gN.y);
    k.note('S=1 sets Q, R=1 resets Q, both 0 holds', 10, 190);
  }));

  def('Sequential', 'D latch', () => build('D latch', (k) => {
    const D1 = k.in('D', 10, 10), E = k.in('E', 10, 140);
    const nD = k.gate('NOT', 90, 0, [D1]);
    const a = k.gate('NAND', 200, 0, [D1, E]), b = k.gate('NAND', 200, 90, [nD.y, E]);
    const q = k.gate('NAND', 330, 0, [a.y, null]), qn = k.gate('NAND', 330, 90, [b.y, null]);
    k.w(qn.y, q.i[1]); k.w(q.y, qn.i[1]);
    k.out('Q', 470, 10, q.y); k.out('Qn', 470, 100, qn.y);
    k.note('E=1: Q follows D. E=0: Q holds', 10, 190);
  }));

  def('Sequential', 'D flip-flop', () => build('D flip-flop', (k) => {
    const D1 = k.in('D', 10, 10), CLK = k.in('CLK', 10, 150);
    const nc = k.gate('NOT', 100, 130, [CLK]);
    const m = k.chip('D latch', 230, 10, { D: D1, E: nc.y });
    const s = k.chip('D latch', 440, 10, { D: m.o.Q });
    k.w(CLK, s.i.E, [{ x: 80, y: 160 }, { x: 80, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 50 }]);
    k.out('Q', 640, 20, s.o.Q); k.out('Qn', 640, 60, s.o.Qn);
    k.note('master-slave: Q takes D on the rising clock edge', 10, 240);
  }));

  def('Sequential', 'T flip-flop', () => build('T flip-flop', (k) => {
    const T = k.in('T', 10, 10), CLK = k.in('CLK', 10, 110);
    const x = k.gate('XOR', 110, 0, [T, null]);
    const ff = k.chip('D flip-flop', 240, 10, { D: x.y, CLK });
    k.w(ff.o.Q, x.i[1]);
    k.out('Q', 440, 20, ff.o.Q); k.out('Qn', 440, 60, ff.o.Qn);
    k.note('T=1 toggles Q on every rising clock edge', 10, 160);
  }));

  def('Sequential', 'JK flip-flop', () => build('JK flip-flop', (k) => {
    const J = k.in('J', 10, 10), K = k.in('K', 10, 90), CLK = k.in('CLK', 10, 200);
    const nK = k.gate('NOT', 90, 70, [K]);
    const a = k.gate('AND', 200, 0, [J, null]), b = k.gate('AND', 200, 80, [nK.y, null]);
    const o = k.gate('OR', 320, 40, [a.y, b.y]);
    const ff = k.chip('D flip-flop', 440, 30, { D: o.y, CLK });
    k.w(ff.o.Qn, a.i[1]); k.w(ff.o.Q, b.i[1]);
    k.out('Q', 640, 40, ff.o.Q); k.out('Qn', 640, 80, ff.o.Qn);
    k.note('D = J and not Q, or not K and Q', 10, 250);
  }));

  def('Sequential', 'Register 4-bit', () => build('Register 4-bit', (k) => {
    const Din = [0, 1, 2, 3].map((n) => k.in('D' + n, 10, 10 + n * 100));
    const LD = k.in('LD', 10, 430), CLK = k.in('CLK', 10, 500);
    [0, 1, 2, 3].forEach((n) => {
      const y = 10 + n * 100;
      const m = k.chip('MUX 2:1', 170, y, { D1: Din[n], S: LD });
      const ff = k.chip('D flip-flop', 340, y, { D: m.o.Y });
      k.w(CLK, ff.i.CLK, [{ x: 310, y: 510 }, { x: 310, y: y + 40 }]);
      k.w(ff.o.Q, m.i.D0, [{ x: 500, y: y + 20 }, { x: 500, y: y + 90 }, { x: 150, y: y + 90 }, { x: 150, y: y + 20 }]);
      k.out('Q' + n, 540, y + 20, ff.o.Q);
    });
    k.note('LD=1: load D on the clock edge. LD=0: hold', 10, 550);
  }));

  def('Sequential', 'Counter 4-bit', () => build('Counter 4-bit', (k) => {
    const RST = k.in('RST', 10, 10), CLK = k.in('CLK', 10, 480);
    const nR = k.gate('NOT', 90, 0, [RST]);
    // the outputs feed back into the logic through tunnels, so no wires run behind the flip-flops
    const Q = [0, 1, 2, 3].map((n) => k.tout('Q' + n, 10, 80 + n * 50));
    const ff = [0, 1, 2, 3].map((n) => k.chip('D flip-flop', 520, 10 + n * 110, {}));
    const d0 = k.gate('NOR', 400, 10, [RST, Q[0]]);
    const x1 = k.gate('XOR', 260, 130, [Q[1], Q[0]]);
    const d1 = k.gate('AND', 400, 120, [nR.y, x1.y]);
    const t2 = k.gate('AND', 150, 240, [Q[0], Q[1]]);
    const x2 = k.gate('XOR', 260, 240, [Q[2], t2.y]);
    const d2 = k.gate('AND', 400, 230, [nR.y, x2.y]);
    const t3 = k.gate('AND', 150, 340, [Q[0], Q[1], Q[2]]);
    const x3 = k.gate('XOR', 260, 360, [Q[3], t3.y]);
    const d3 = k.gate('AND', 400, 340, [nR.y, x3.y]);
    [d0, d1, d2, d3].forEach((g, n) => {
      k.w(g.y, ff[n].i.D);
      k.w(CLK, ff[n].i.CLK, [{ x: 490, y: 490 }, { x: 490, y: 10 + n * 110 + 40 }]);
      k.tin('Q' + n, 700, 10 + n * 110 + 10, ff[n].o.Q);
      k.out('Q' + n, 780, 10 + n * 110 + 40, ff[n].o.Q);
    });
    k.note('counts up on every rising clock edge, RST=1 clears', 10, 530);
  }));

  def('Sequential', 'Shift register 4-bit', () => build('Shift register 4-bit', (k) => {
    const SI = k.in('SI', 10, 10), CLK = k.in('CLK', 10, 160);
    let prev = SI;
    [0, 1, 2, 3].forEach((n) => {
      const ff = k.chip('D flip-flop', 160 + n * 200, 10, { D: prev });
      const lane = 140 + n * 200;
      k.w(CLK, ff.i.CLK, [{ x: lane, y: 170 }, { x: lane, y: 50 }]);
      k.out('Q' + n, 340 + n * 200, 130, ff.o.Q);
      prev = ff.o.Q;
    });
    k.note('serial in, each clock edge moves the bits one step along', 10, 220);
  }));

  // ------------------------------------------------------------------ memory
  def('Memory', 'ROM 4x4', () => build('ROM 4x4', (k) => {
    const words = [0x5, 0xA, 0x3, 0xF];
    const A0 = k.in('A0', 10, 10), A1 = k.in('A1', 10, 70), one = k.one(10, 160);
    const dec = k.chip('Decoder 2:4', 150, 10, { A0, A1, EN: one });
    for (let j = 0; j < 4; j++) {
      const src = [0, 1, 2, 3].filter((m) => words[m] >> j & 1).map((m) => dec.o['Y' + m]);
      const o = k.gate('OR', 340, j * 90, src.length > 1 ? src : src.concat(src));
      k.out('D' + j, 470, j * 90 + 20, o.y);
    }
    k.note('contents: 5, A, 3, F (copy this part to change them)', 10, 380);
  }));

  def('Memory', 'RAM 4x1', () => build('RAM 4x1', (k) => {
    const A0 = k.in('A0', 10, 10), A1 = k.in('A1', 10, 70), Din = k.in('D', 10, 130), WE = k.in('WE', 10, 190);
    const dec = k.chip('Decoder 2:4', 150, 10, { A0, A1, EN: WE });
    const lat = [0, 1, 2, 3].map((m) => k.chip('D latch', 340, 10 + m * 90, { D: Din, E: dec.o['Y' + m] }));
    const mux = k.chip('MUX 4:1', 540, 100, { D0: lat[0].o.Q, D1: lat[1].o.Q, D2: lat[2].o.Q, D3: lat[3].o.Q, S0: A0, S1: A1 });
    k.out('Q', 740, 140, mux.o.Y);
    k.note('4 words x 1 bit. WE=1 writes D at address A1A0', 10, 390);
  }));

  // ------------------------------------------------------------------ display drivers
  def('Display drivers', 'Hex decoder', () => build('Hex decoder', (k) => {
    const Din = [0, 1, 2, 3].map((n) => k.in('D' + n, 10, 10 + n * 60));
    const nD = Din.map((d, n) => k.gate('NOT', 90, n * 60, [d]));
    const mt = [];
    for (let m = 0; m < 16; m++) {
      mt.push(k.gate('AND', 260, 10 + m * 100, [0, 1, 2, 3].map((b) => (m >> b & 1 ? Din[b] : nD[b].y))));
    }
    let y = 10;
    'abcdefg'.split('').forEach((name, s) => {
      const on = [], off = [];
      for (let m = 0; m < 16; m++) (D.HEXSEG[m] >> s & 1 ? on : off).push(m);
      const useOff = on.length > 8;
      const list = (useOff ? off : on).map((m) => mt[m].y);
      const g = k.gate(useOff ? 'NOR' : 'OR', 460, y, list);
      k.out(name, 600, y + list.length * 10 - 10, g.y);
      y += list.length * 20 + 20;
    });
    k.note('drives a 7-segment part: a b c d e f g', 10, 280);
  }));


  // ------------------------------------------------------------------ series (bus) chips
  // N identical cells stacked in a column, like dragging a part down a column. The chip has bus pins:
  // A[N], B[N] in, one N-bit bus out. Splitters fan the buses out, a merger packs the results back.
  //   o.unary   : no B input
  //   o.extras  : extra 1-bit inputs shared by every cell (a select line, a load line, ...)
  //   o.pitch   : vertical distance between cells
  //   o.make(k, x, y) -> { w, h, a, b, out, ext: { label: pinRef } }
  function series(name, N, o) {
    return build(name, (k) => {
      const bh = Math.ceil(N / 8) * 20, two = !o.unary;
      const sa = k.split(N, 200, 10, k.bin('A', N, 10, 10));
      let nextY = 10 + N * 20 + 20, sb = null;
      if (two) { sb = k.split(N, 200, nextY, k.bin('B', N, 10, 10 + bh + 20)); nextY += N * 20 + 20; }
      const extras = {}, extraY = {};
      (o.extras || []).forEach((lbl) => { extras[lbl] = k.in(lbl, 10, nextY); extraY[lbl] = nextY + 10; nextY += 40; });
      const laneA = 270, laneB = laneA + 10 * N + 10, X = laneB + (two ? 10 * N : 0) + 30;
      const els = [];
      for (let i = 0; i < N; i++) els.push(o.make(k, X, 10 + i * o.pitch));
      els.forEach((e, i) => {
        k.lane(sa[i], e.a, laneA + 10 * i);
        if (two) k.lane(sb[i], e.b, laneB + 10 * i);
        (o.extras || []).forEach((lbl, idx) => { const t = k.at(e.ext[lbl]); k.w(extras[lbl], e.ext[lbl], [{ x: 262 - 8 * idx, y: extraY[lbl] }, { x: 262 - 8 * idx, y: t.y }]); });
      });
      const ew = els[0].w, lane0 = X + ew + 20, mx = lane0 + 10 * N + 20;
      const bus = k.merge(N, mx, 10, []);
      els.forEach((e, i) => { const mref = bus.split('.')[0] + '.i' + i; k.lane(e.out, mref, lane0 + 10 * i); });
      k.bout('Y', N, mx + 70, 10 + N * 10 - bh / 2, bus);
    });
  }
  const gateCell = (type, ins) => (k, x, y) => { const g = k.gate(type, x, y, new Array(ins).fill(null)); return { w: 60, h: ins === 1 ? 40 : 40, a: g.i[0], b: g.i[1], out: g.y, ext: {} }; };

  // Ripple-carry adder: a column of N full adders, carry running down the column.
  function adderN(name, N) {
    return build(name, (k) => {
      const bh = Math.ceil(N / 8) * 20;
      const sa = k.split(N, 200, 10, k.bin('A', N, 10, 10));
      const sbY = 10 + N * 20 + 20;
      const sb = k.split(N, 200, sbY, k.bin('B', N, 10, 10 + bh + 20));
      const cinY = sbY + N * 20 + 20, Cin = k.in('Cin', 10, cinY);
      const laneA = 270, laneB = laneA + 10 * N + 10, X = laneB + 10 * N + 40, P = 110;
      const fa = [];
      for (let i = 0; i < N; i++) fa.push(k.chip('Full adder', X, 10 + i * P, {}));
      const W = fa[0].w, Ox = X + W;
      fa.forEach((f, i) => { k.lane(sa[i], f.i.A, laneA + 10 * i); k.lane(sb[i], f.i.B, laneB + 10 * i); });
      k.w(Cin, fa[0].i.Cin, [{ x: 262, y: cinY + 10 }, { x: 262, y: 10 + 60 }]);
      for (let i = 0; i + 1 < N; i++) {
        const fy = 10 + i * P, midY = fy + fa[i].h + 15;
        k.w(fa[i].o.Cout, fa[i + 1].i.Cin, [{ x: Ox + 12, y: fy + 40 }, { x: Ox + 12, y: midY }, { x: X - 14, y: midY }, { x: X - 14, y: fy + P + 60 }]);
      }
      const lane0 = Ox + 20, mx = lane0 + 10 * N + 20;
      const bus = k.merge(N, mx, 10, []);
      fa.forEach((f, i) => k.lane(f.o.S, bus.split('.')[0] + '.i' + i, lane0 + 10 * i));
      k.bout('S', N, mx + 70, 10 + N * 10 - bh / 2, bus);
      k.out('Cout', mx + 70, 10 + (N - 1) * P + 30, fa[N - 1].o.Cout);
      k.note('ripple carry: each full adder passes its carry down to the next', 10, cinY + 50);
    });
  }
  def('Series (bus)', 'Adder 4-bit', () => adderN('Adder 4-bit', 4));
  def('Series (bus)', 'Adder 8-bit', () => adderN('Adder 8-bit', 8));
  def('Series (bus)', 'Adder 16-bit', () => adderN('Adder 16-bit', 16));

  def('Series (bus)', 'AND 8-bit', () => series('AND 8-bit', 8, { pitch: 50, make: gateCell('AND', 2) }));
  def('Series (bus)', 'OR 8-bit', () => series('OR 8-bit', 8, { pitch: 50, make: gateCell('OR', 2) }));
  def('Series (bus)', 'XOR 8-bit', () => series('XOR 8-bit', 8, { pitch: 50, make: gateCell('XOR', 2) }));
  def('Series (bus)', 'NOT 8-bit', () => series('NOT 8-bit', 8, { unary: true, pitch: 50, make: gateCell('NOT', 1) }));

  def('Series (bus)', 'MUX 2:1 8-bit', () => series('MUX 2:1 8-bit', 8, {
    pitch: 100, extras: ['SEL'],
    make(k, x, y) { const c = k.chip('MUX 2:1', x, y, {}); return { w: c.w, h: c.h, a: c.i.D0, b: c.i.D1, out: c.o.Y, ext: { SEL: c.i.S } }; },
  }));

  def('Series (bus)', 'Add-Sub 8-bit', () => build('Add-Sub 8-bit', (k) => {
    const A = k.bin('A', 8, 10, 10), B = k.bin('B', 8, 10, 50), SUB = k.in('SUB', 10, 100);
    const sub8 = k.merge(8, 130, 100, []), mid = sub8.split('.')[0];
    for (let i = 0; i < 8; i++) k.w(SUB, mid + '.i' + i, [{ x: 100, y: 110 }, { x: 100, y: 110 + 20 * i }]);
    const x = k.chip('XOR 8-bit', 300, 60, { A: B, B: sub8 });
    const ad = k.chip('Adder 8-bit', 520, 10, { A, B: x.o.Y });
    k.w(SUB, ad.i.Cin, [{ x: 100, y: 110 }, { x: 100, y: 270 }, { x: 480, y: 270 }, { x: 480, y: 10 + 60 }]);
    k.bout('S', 8, 700, 20, ad.o.S); k.out('Cout', 700, 70, ad.o.Cout);
    k.note('B is flipped when SUB=1 and SUB is also the carry in: A - B = A + not B + 1', 10, 300);
  }));

  def('Series (bus)', 'Incrementer 8-bit', () => build('Incrementer 8-bit', (k) => {
    const N = 8, sa = k.split(N, 200, 10, k.bin('A', N, 10, 10)), one = k.one(10, 10 + N * 20 + 20);
    const laneA = 270, X = laneA + 10 * N + 40, P = 90;
    const ha = [];
    for (let i = 0; i < N; i++) ha.push(k.chip('Half adder', X, 10 + i * P, {}));
    ha.forEach((h, i) => k.lane(sa[i], h.i.A, laneA + 10 * i));
    k.w(one, ha[0].i.B, [{ x: 262, y: 10 + N * 20 + 30 }, { x: 262, y: 10 + 40 }]);
    const Ox = X + ha[0].w;
    for (let i = 0; i + 1 < N; i++) {
      const fy = 10 + i * P, midY = fy + ha[i].h + 15;
      k.w(ha[i].o.C, ha[i + 1].i.B, [{ x: Ox + 12, y: fy + 40 }, { x: Ox + 12, y: midY }, { x: X - 14, y: midY }, { x: X - 14, y: fy + P + 40 }]);
    }
    const lane0 = Ox + 20, mx = lane0 + 10 * N + 20, bus = k.merge(N, mx, 10, []);
    ha.forEach((h, i) => k.lane(h.o.S, bus.split('.')[0] + '.i' + i, lane0 + 10 * i));
    k.bout('Y', N, mx + 70, 10 + N * 10 - 10, bus);
    k.out('Cout', mx + 70, 10 + (N - 1) * P + 30, ha[N - 1].o.C);
    k.note('Y = A + 1. Cout is high when A was 255 and wraps to 0', 10, 10 + N * 20 + 60);
  }));

  def('Series (bus)', 'Comparator 8-bit', () => build('Comparator 8-bit', (k) => {
    const sa = k.split(8, 200, 10, k.bin('A', 8, 10, 10)), sb = k.split(8, 200, 190, k.bin('B', 8, 10, 50));
    const X = 500, lo = k.chip('Comparator 4-bit', X, 10, {}), hi = k.chip('Comparator 4-bit', X, 10 + 180 + 30, {});
    for (let i = 0; i < 4; i++) {
      k.lane(sa[i], lo.i['A' + i], 270 + 10 * i); k.lane(sb[i], lo.i['B' + i], 320 + 10 * i);
      k.lane(sa[i + 4], hi.i['A' + i], 370 + 10 * i); k.lane(sb[i + 4], hi.i['B' + i], 420 + 10 * i);
    }
    const gx = X + lo.w + 50;
    const t = k.gate('AND', gx, 120, [hi.o.EQ, lo.o.GT]);
    const gt = k.gate('OR', gx + 110, 230, [hi.o.GT, t.y]);
    const eq = k.gate('AND', gx, 330, [hi.o.EQ, lo.o.EQ]);
    const lt = k.gate('NOR', gx + 110, 400, [gt.y, eq.y]);
    k.out('GT', gx + 220, 240, gt.y); k.out('EQ', gx + 220, 340, eq.y); k.out('LT', gx + 220, 410, lt.y);
    k.note('the high nibble decides; if it ties, the low nibble decides', 10, 280);
  }));

  def('Series (bus)', 'Register 8-bit', () => build('Register 8-bit', (k) => {
    const sd = k.split(8, 200, 10, k.bin('D', 8, 10, 10)), LD = k.in('LD', 10, 200), CLK = k.in('CLK', 10, 240);
    const X = 420, lo = k.chip('Register 4-bit', X, 10, {}), hi = k.chip('Register 4-bit', X, 10 + 140 + 30, {});
    for (let i = 0; i < 4; i++) { k.lane(sd[i], lo.i['D' + i], 270 + 10 * i); k.lane(sd[i + 4], hi.i['D' + i], 320 + 10 * i); }
    for (const c of [lo, hi]) {
      const ly = k.at(c.i.LD).y, cy = k.at(c.i.CLK).y;
      k.w(LD, c.i.LD, [{ x: 258, y: 210 }, { x: 258, y: ly }]);
      k.w(CLK, c.i.CLK, [{ x: 250, y: 250 }, { x: 250, y: cy }]);
    }
    const lane0 = X + lo.w + 20, mx = lane0 + 80 + 20, bus = k.merge(8, mx, 10, []), mid = bus.split('.')[0];
    for (let i = 0; i < 4; i++) { k.lane(lo.o['Q' + i], mid + '.i' + i, lane0 + 10 * i); k.lane(hi.o['Q' + i], mid + '.i' + (i + 4), lane0 + 40 + 10 * i); }
    k.bout('Q', 8, mx + 70, 80, bus);
    k.note('LD=1: load D on the clock edge. LD=0: hold. Two 4-bit registers side by side', 10, 300);
  }));

  const GROUP_ORDER = ['Combinational', 'Series (bus)', 'Sequential', 'Memory', 'Display drivers'];
  const groups = () => GROUP_ORDER.map((name) => ({ name, items: order.filter((n) => defs.get(n).cat === name) }));

  return { get, has: (n) => defs.has(n), names: () => order.slice(), groups };
});
