/* Gate definitions: pin geometry + SVG symbols. Shared by the editor, palette and simulator. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GateDefs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GRID = 10;
  const MULTI = ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR'];
  const SINGLE = ['NOT', 'BUF'];
  const GATES = MULTI.concat(SINGLE);
  const NEG = ['NAND', 'NOR', 'XNOR', 'NOT'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // ---- wide numbers: buses go up to 64 bits (a 46-bit address already reaches 64 TiB).
  // Up to 53 bits a value is a plain Number; wider ones are BigInt at run time and a hex string ("0x...") in the saved file.
  const MAX_BITS = 64, SAFE_BITS = 53;
  const big = (v) => { try { return typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)) || 0); } catch (e) { return 0n; } };
  function parseValue(v, bits) {   // number, decimal text or 0x hex text -> Number (<= 53 bits) or BigInt, clamped to the width
    let b;
    if (typeof v === 'string') { try { b = BigInt(v.trim() || '0'); } catch (e) { b = 0n; } } else b = big(v);
    const max = (1n << BigInt(bits)) - 1n;
    if (b < 0n) b = 0n; if (b > max) b = max;
    return bits <= SAFE_BITS ? Number(b) : b;
  }
  const packValue = (v, bits) => (bits <= SAFE_BITS ? Number(v) : '0x' + big(v).toString(16));   // what goes into the JSON file
  const bitOf = (v, i) => (typeof v === 'bigint' ? Number((v >> BigInt(i)) & 1n) : (i < 31 ? (v >> i) & 1 : Math.floor(v / 2 ** i) % 2));
  const S = 'stroke="url(#geBrand)"';
  const SEGN = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  // 7-segment patterns for 0..F, bit0 = a ... bit6 = g
  const HEXSEG = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71];

  const NAMES = {
    AND: 'AND', OR: 'OR', NOT: 'NOT', NAND: 'NAND', NOR: 'NOR', XOR: 'XOR', XNOR: 'XNOR', BUF: 'Buffer',
    INPUT: 'Input switch', OUTPUT: 'Output LED', BUTTON: 'Button', CLOCK: 'Clock',
    CONST0: 'Constant 0', CONST1: 'Constant 1', PLATE: 'Plate',
    BUS_IN: 'Bit input', BUS_OUT: 'Bit output',
    SEG7: '7-segment', HEX: 'Hex display', PROBE: 'Probe', LABEL: 'Label', TUNNEL_IN: 'Tunnel in', TUNNEL_OUT: 'Tunnel out',
    TRI: 'Tri-state buffer', SPLIT: 'Splitter', MERGE: 'Merger', SCREEN: 'Pixel screen', MEM: 'Memory (RAM / ROM)',
  };

  const GROUPS = [
    { name: 'Logic gates', items: ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'BUF'] },
    { name: 'Input / Output', items: ['INPUT', 'BUS_IN', 'BUTTON', 'CLOCK', 'CONST1', 'CONST0', 'OUTPUT', 'BUS_OUT'] },
    { name: 'Displays & tools', items: ['SEG7', 'HEX', 'PROBE', 'TUNNEL_IN', 'TUNNEL_OUT', 'LABEL'] },
    { name: 'Bus & tri-state', items: ['TRI', 'SPLIT', 'MERGE'] },
    { name: 'Memory', items: ['MEM'] },
    { name: 'Screens', items: ['SCREEN'] },
  ];

  // Parts shown greyed out in the palette as "Coming soon". Empty now: tri-state and bus parts exist.
  const PLANNED = [];

  function evalGate(type, ins) {
    let ones = 0;
    for (let i = 0; i < ins.length; i++) if (ins[i]) ones++;
    const n = ins.length;
    switch (type) {
      case 'AND': return ones === n ? 1 : 0;
      case 'NAND': return ones === n ? 0 : 1;
      case 'OR': return ones > 0 ? 1 : 0;
      case 'NOR': return ones > 0 ? 0 : 1;
      case 'XOR': return ones & 1;
      case 'XNOR': return (ones & 1) ^ 1;
      case 'NOT': return ins[0] ? 0 : 1;
      case 'BUF': return ins[0] ? 1 : 0;
      case 'TRI': return ins[0] ? 1 : 0;   // data value; the simulator decides if it is driven (enable) or floating
    }
    return 0;
  }

  function defaultProps(type) {
    if (MULTI.includes(type)) return { inputs: 2 };
    if (type === 'INPUT') return { label: 'IN', value: 0 };
    if (type === 'OUTPUT') return { label: 'OUT' };
    if (type === 'BUTTON') return { label: 'BTN' };
    if (type === 'CLOCK') return { label: 'CLK' };
    if (type === 'PROBE') return { label: 'P' };
    if (type === 'LABEL') return { label: 'Note' };
    if (type === 'TUNNEL_IN' || type === 'TUNNEL_OUT') return { name: 'T1' };
    if (type === 'SPLIT' || type === 'MERGE') return { bits: 8, flip: true, group: 1 };   // new parts: pins numbered from the top, highest bit on top
    if (type === 'BUS_IN') return { label: 'A', bits: 8, value: 0, fmt: 'dec' };
    if (type === 'BUS_OUT') return { label: 'OUT', bits: 8, fmt: 'dec' };
    if (type === 'MEM') return { label: 'RAM', abits: 16, dbits: 8, mode: 'ram', write: 'edge', init: [] };
    if (type === 'SCREEN') return { w: 32, h: 32, mode: 'addr', color: 'mono', write: 'edge', view: 160 };
    return {};
  }

  // Clamp the properties of the new parts so a hand-edited file can never break the editor.
  function fixProps(type, props) {
    const p = Object.assign({}, props || {});
    if (type === 'SPLIT' || type === 'MERGE') { p.bits = clamp(Math.round(p.bits) || 8, 2, MAX_BITS); p.flip = !!p.flip; p.group = Math.round(p.group) || 1; if (p.group < 1 || p.bits % p.group) p.group = 1; }   // group: bits per pin (8-bit bus + group 4 = two 4-bit pins)   // flip: highest bit on top (old plates have no flip = bit 0 on top)
    if (type === 'BUS_IN' || type === 'BUS_OUT') {
      p.bits = clamp(Math.round(p.bits) || 8, 2, MAX_BITS);
      p.fmt = FORMATS.includes(p.fmt) ? p.fmt : 'dec';
      if (type === 'BUS_IN') p.value = parseValue(p.value, p.bits);
    }
    if (type === 'MEM') {
      p.abits = clamp(Math.round(p.abits) || 16, 1, MAX_BITS); p.dbits = clamp(Math.round(p.dbits) || 8, 1, MAX_BITS);
      p.mode = p.mode === 'rom' ? 'rom' : 'ram'; p.write = p.write === 'level' ? 'level' : 'edge';
      p.label = String(p.label == null ? 'RAM' : p.label).slice(0, 16);
      // start contents: [["0x0","0xFF"], ...] address / value pairs (hex or decimal text). Everything else reads 0.
      p.init = Array.isArray(p.init) ? p.init.filter((e) => Array.isArray(e) && e.length === 2).slice(0, 100000) : [];
    }
    if (type === 'SCREEN') {
      p.mode = p.mode === 'direct' ? 'direct' : 'addr';
      p.color = p.mode === 'addr' && p.color === 'rgb' ? 'rgb' : 'mono';
      p.write = p.write === 'level' ? 'level' : 'edge';
      const max = p.mode === 'direct' ? 16 : 1000;
      p.w = clamp(Math.round(p.w) || 32, 1, max);
      p.h = clamp(Math.round(p.h) || 32, 1, max);
      p.view = clamp(Math.round(p.view) || 160, 60, 400);
    }
    return p;
  }
  // ---- bit input / bit output: a row (or two) of cells, one bus wire ----
  const FORMATS = ['dec', 'hex', 'bin', 'signed'];
  // up to 8 cells per row, most significant bit top-left, least significant bottom-right
  function busGrid(bits) { const cols = Math.min(bits, 8); return { bits, cols, rows: Math.ceil(bits / cols) }; }
  function busCell(bits, bit) {
    const g = busGrid(bits), k = bits - 1 - bit, row = Math.floor(k / g.cols);
    const len = row < g.rows - 1 ? g.cols : bits - g.cols * (g.rows - 1);
    const col = (k - row * g.cols) + (row === g.rows - 1 ? g.cols - len : 0);
    return { col, row };
  }
  // which bit of a Bit input sits under local point (x, y)? -1 when none
  function busBitAt(bits, x, y) {
    const g = busGrid(bits), col = Math.floor((x - 5) / 16), row = Math.floor(y / 20);
    if (col < 0 || col >= g.cols || row < 0 || row >= g.rows) return -1;
    const len = row < g.rows - 1 ? g.cols : bits - g.cols * (g.rows - 1);
    const c = col - (row === g.rows - 1 ? g.cols - len : 0);
    if (c < 0) return -1;
    return bits - 1 - (row * g.cols + c);
  }
  function fmtBus(val, bits, fmt) {
    const v = big(val);
    if (fmt === 'hex') return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
    if (fmt === 'bin') return '0b' + v.toString(2).padStart(bits, '0');
    if (fmt === 'signed') return String(v >= (1n << BigInt(bits - 1)) ? v - (1n << BigInt(bits)) : v);
    return String(v);
  }
  const bitsFor = (n) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

  // Size and pins of a pixel screen. 'addr' = framebuffer: X, Y, colour, write-enable, clear pins (any
  // size up to 1000x1000). 'direct' = every pixel has its own input pin (up to 16x16).
  function screenGeom(props) {
    const p = fixProps('SCREEN', props);
    if (p.mode === 'direct') {
      const cell = 20, W = p.w * cell, H = p.h * cell, inputs = [];
      for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) inputs.push({ name: 'p' + (r * p.w + c), label: '', x: c * cell + 10, y: r * cell + 10 });
      return { mode: 'direct', w: p.w, h: p.h, color: 'mono', write: p.write, cell, W, H, inputs, geomW: W, geomH: H };
    }
    const xb = bitsFor(p.w), yb = bitsFor(p.h), cb = p.color === 'rgb' ? 3 : 1, PC = 50;
    let DW = clamp(Math.round(p.view / 10) * 10, 60, 400), DH = Math.round((DW * p.h / p.w) / 10) * 10;
    if (DH > 400) { DH = 400; DW = Math.max(20, Math.round((400 * p.w / p.h) / 10) * 10); }
    DH = Math.max(20, DH);
    const W = PC + DW + 10, H = Math.max(140, 30 + DH);
    const inputs = [
      { name: 'x', label: xb > 1 ? 'X[' + xb + ']' : 'X', bits: xb, x: 0, y: 40 },
      { name: 'y', label: yb > 1 ? 'Y[' + yb + ']' : 'Y', bits: yb, x: 0, y: 60 },
      { name: 'd', label: cb > 1 ? 'RGB' : 'D', bits: cb, x: 0, y: 80 },
      { name: 'we', label: 'WE', x: 0, y: 100 },
      { name: 'clr', label: 'CLR', x: 0, y: 120 },
    ];
    return { mode: 'addr', w: p.w, h: p.h, color: p.color, write: p.write, xb, yb, cb, PC, DW, DH, W, H, inputs };
  }

  // Input / output ports of a plate, ordered top-to-bottom. Port node ids are the pin names, so
  // moving a port never rewires a parent plate.
  function portsOf(plate) {
    const by = (a, b) => (a.y - b.y) || (a.x - b.x);
    const isBus = (n) => n.type === 'BUS_IN' || n.type === 'BUS_OUT';
    const mk = (types, pre) => plate.nodes.filter((n) => types.includes(n.type)).sort(by)
      .map((n, i) => ({ id: n.id, label: (n.props && n.props.label) || pre + (i + 1), bits: isBus(n) ? fixProps(n.type, n.props).bits : 1 }));
    // Input / Output parts are 1-bit pins, Bit input / Bit output parts are N-bit bus pins
    return { inputs: mk(['INPUT', 'BUS_IN'], 'IN'), outputs: mk(['OUTPUT', 'BUS_OUT'], 'OUT') };
  }

  // human size of a memory: 2^abits words of dbits bits (46 address bits x 8 bit = 64 TiB)
  function capacityText(abits, dbits) {
    const bytes = (1n << BigInt(abits)) * BigInt(dbits) / 8n || 1n;
    const U = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let i = 0, b = bytes; while (b >= 1024n && i < U.length - 1) { b >>= 10n; i++; }
    return b + ' ' + U[i];
  }

  // Size and pins of a node, in plate units (1 unit = 1 grid step = 10px).
  function describe(node, lib) {
    const t = node.type, p = node.props || {};
    if (GATES.includes(t)) {
      const n = SINGLE.includes(t) ? 1 : clamp(p.inputs || 2, 2, 8);
      const h = n === 1 ? 40 : n * 20;
      const inputs = [];
      for (let i = 0; i < n; i++) inputs.push({ name: 'i' + i, x: 0, y: n === 1 ? 20 : 10 + 20 * i });
      return { w: 60, h, inputs, outputs: [{ name: 'y', x: 60, y: h / 2 }] };
    }
    switch (t) {
      case 'TRI':
        return { w: 60, h: 60, inputs: [{ name: 'd', label: 'D', x: 0, y: 20 }, { name: 'en', label: 'EN', x: 0, y: 40 }], outputs: [{ name: 'y', x: 60, y: 30 }] };
      case 'SPLIT': {
        const fp = fixProps(t, p), n = fp.bits, g = fp.group, m = n / g, h = Math.max(m, 2) * 20;
        const outputs = []; for (let r = 0; r < m; r++) { const k = fp.flip ? m - 1 - r : r; const q = { name: 'o' + k, label: g > 1 ? (k * g + g - 1) + '-' + (k * g) : String(fp.flip ? r : k), x: 50, y: 10 + 20 * r }; if (g > 1) q.bits = g; outputs.push(q); }
        return { w: 50, h, inputs: [{ name: 'bus', label: n + '-bit', bits: n, x: 0, y: h / 2 }], outputs };
      }
      case 'MERGE': {
        const fp = fixProps(t, p), n = fp.bits, g = fp.group, m = n / g, h = Math.max(m, 2) * 20;
        const inputs = []; for (let r = 0; r < m; r++) { const k = fp.flip ? m - 1 - r : r; const q = { name: 'i' + k, label: g > 1 ? (k * g + g - 1) + '-' + (k * g) : String(fp.flip ? r : k), x: 0, y: 10 + 20 * r }; if (g > 1) q.bits = g; inputs.push(q); }
        return { w: 50, h, inputs, outputs: [{ name: 'bus', label: n + '-bit', bits: n, x: 50, y: h / 2 }] };
      }
      case 'MEM': {
        const m = fixProps(t, p), rom = m.mode === 'rom';
        const inputs = [{ name: 'a', label: 'A[' + m.abits + ']', bits: m.abits, x: 0, y: 20 }];
        if (!rom) { inputs.push({ name: 'd', label: 'D[' + m.dbits + ']', bits: m.dbits, x: 0, y: 40 }); inputs.push({ name: 'we', label: 'WE', x: 0, y: 60 }); }
        return { w: 120, h: rom ? 60 : 80, inputs, outputs: [{ name: 'q', label: 'Q[' + m.dbits + ']', bits: m.dbits, x: 120, y: 20 }], mem: m };
      }
      case 'SCREEN': {
        const g = screenGeom(p);
        return { w: g.W, h: g.H, inputs: g.inputs, outputs: [], geom: g };
      }
      case 'BUS_IN': {
        const bits = fixProps(t, p).bits, g = busGrid(bits), w = Math.ceil((g.cols * 16 + 18) / 10) * 10, h = g.rows * 20;
        return { w, h, inputs: [], outputs: [{ name: 'q', label: String(bits), bits, x: w, y: h / 2 }], bus: g };
      }
      case 'BUS_OUT': {
        const bits = fixProps(t, p).bits, g = busGrid(bits), w = Math.ceil((g.cols * 16 + 18) / 10) * 10, h = g.rows * 20;
        return { w, h, inputs: [{ name: 'd', label: String(bits), bits, x: 0, y: h / 2 }], outputs: [], bus: g };
      }
      case 'INPUT': case 'BUTTON': case 'CLOCK':
        return { w: 50, h: 20, inputs: [], outputs: [{ name: 'q', x: 50, y: 10 }] };
      case 'CONST0': case 'CONST1':
        return { w: 40, h: 20, inputs: [], outputs: [{ name: 'q', x: 40, y: 10 }] };
      case 'OUTPUT':
        return { w: 40, h: 20, inputs: [{ name: 'd', x: 0, y: 10 }], outputs: [] };
      case 'PROBE':
        return { w: 40, h: 20, inputs: [{ name: 'd', x: 0, y: 10 }], outputs: [] };
      case 'LABEL':
        return { w: Math.max(40, Math.ceil((String(p.label || '').length * 6.5 + 8) / 10) * 10), h: 20, inputs: [], outputs: [] };
      case 'TUNNEL_IN':
        return { w: 60, h: 20, inputs: [{ name: 'd', x: 0, y: 10 }], outputs: [] };
      case 'TUNNEL_OUT':
        return { w: 60, h: 20, inputs: [], outputs: [{ name: 'q', x: 60, y: 10 }] };
      case 'SEG7':
        return { w: 80, h: 150, inputs: SEGN.map((n, i) => ({ name: n, label: n, x: 0, y: 10 + 20 * i })), outputs: [] };
      case 'HEX':
        return { w: 70, h: 90, inputs: [0, 1, 2, 3].map((i) => ({ name: 'd' + i, label: String(1 << i), x: 0, y: 10 + 20 * i })), outputs: [] };
      case 'PLATE': {
        const def = lib && p.ref ? lib.get(p.ref) : null;
        if (!def) return { w: 100, h: 40, inputs: [], outputs: [], missing: true, title: showName(p.ref) || '?' };
        const ports = portsOf(def);
        const rows = Math.max(ports.inputs.length, ports.outputs.length, 1);
        const pl = (q) => (q.bits > 1 ? q.label + '[' + q.bits + ']' : q.label);   // bus pins show their width: A[8]
        const maxL = Math.max(0, ...ports.inputs.map((q) => pl(q).length));
        const maxR = Math.max(0, ...ports.outputs.map((q) => pl(q).length));
        const w = Math.max(100, Math.ceil(((maxL + maxR) * 6 + showName(p.ref).length * 7 + 40) / 10) * 10);
        const h = rows * 20 + 20;
        return {
          w, h, title: showName(p.ref),
          inputs: ports.inputs.map((q, i) => Object.assign({ name: q.id, label: pl(q), x: 0, y: 20 + 20 * i }, q.bits > 1 ? { bits: q.bits } : {})),
          outputs: ports.outputs.map((q, i) => Object.assign({ name: q.id, label: pl(q), x: w, y: 20 + 20 * i }, q.bits > 1 ? { bits: q.bits } : {})),
        };
      }
    }
    return { w: 40, h: 20, inputs: [], outputs: [] };
  }

  // a plate named "gpu.map" shows as "gpu" on chips, tabs and lists (rename still shows the full name)
  const showName = (n) => String(n == null ? '' : n).replace(/\.map(?![A-Za-z0-9_])/i, '');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // SVG body of a node (no pins, no label). st.on = signal is high.
  function bodySVG(node, d, st) {
    const t = node.type, on = !!(st && st.on);
    if (GATES.includes(t)) {
      const h = d.h, mid = h / 2, neg = NEG.includes(t);
      let s = '';
      for (const q of d.inputs) s += `<path class="lead" d="M0,${q.y}H14"/>`;
      s += `<path class="lead" d="M${neg ? 54 : 46},${mid}H60"/>`;
      if (t === 'AND' || t === 'NAND') {
        s += `<path class="body" ${S} d="M10,2H28A18,${(h - 4) / 2} 0 0 1 28,${h - 2}H10Z"/>`;
      } else if (t === 'NOT' || t === 'BUF') {
        s += `<path class="body" ${S} d="M10,4L46,20L10,36Z"/>`;
      } else {
        s += `<path class="body" ${S} d="M10,2Q32,2 46,${mid}Q32,${h - 2} 10,${h - 2}Q20,${mid} 10,2Z"/>`;
        if (t === 'XOR' || t === 'XNOR') s += `<path class="body-line" ${S} d="M4,2Q14,${mid} 4,${h - 2}"/>`;
      }
      if (neg) s += `<circle class="bubble" ${S} cx="50" cy="${mid}" r="4"/>`;
      return s;
    }
    switch (t) {
      case 'TRI':
        return `<path class="lead" d="M0,20H10M0,40H10M46,30H60"/><path class="body" ${S} d="M10,5L46,30L10,55Z"/>` +
          `<text class="pin-label" x="13" y="23">D</text><text class="pin-label" x="13" y="43">EN</text>`;
      case 'SPLIT': case 'MERGE': {
        const h = d.h, n = t === 'SPLIT' ? d.outputs.length : d.inputs.length;
        let s = `<rect class="body" ${S} x="18" y="2" width="14" height="${h - 4}" rx="3"/>`;
        if (t === 'SPLIT') {
          s += `<path class="lead bus" d="M0,${h / 2}H18"/>`;
          for (const q of d.outputs) s += `<path class="lead${q.bits ? ' bus' : ''}" d="M32,${q.y}H50"/><text class="pin-label end" x="46" y="${q.y - 3}">${q.label}</text>`;
        } else {
          s += `<path class="lead bus" d="M32,${h / 2}H50"/>`;
          for (const q of d.inputs) s += `<path class="lead${q.bits ? ' bus' : ''}" d="M0,${q.y}H18"/><text class="pin-label" x="4" y="${q.y - 3}">${q.label}</text>`;
        }
        return s + `<text class="val" x="25" y="${h / 2 + 3}" transform="rotate(-90 25 ${h / 2})">${n}</text>`;
      }
      case 'MEM': {
        const m = d.mem;
        let s = `<rect class="body plate-body" ${S} x="10" y="2" width="100" height="${d.h - 4}" rx="5"/>`;
        for (const q of d.inputs) s += `<path class="lead ${q.bits > 1 ? 'bus' : ''}" d="M0,${q.y}H10"/><text class="pin-label" x="14" y="${q.y + 3}">${esc(q.label)}</text>`;
        for (const q of d.outputs) s += `<path class="lead bus" d="M110,${q.y}H120"/><text class="pin-label end" x="106" y="${q.y + 3}">${esc(q.label)}</text>`;
        s += `<text class="plate-title" x="60" y="${d.h - 22}">${esc(m.mode === 'rom' ? 'ROM' : 'RAM')} ${esc(capacityText(m.abits, m.dbits))}</text>`;
        s += `<text class="pin-label" x="60" y="${d.h - 9}" text-anchor="middle">2^${m.abits} × ${m.dbits} bit</text>`;
        return s;
      }
      case 'SCREEN': {
        const g = d.geom;
        if (g.mode === 'direct') {
          let s = `<rect class="body screen-body" ${S} x="1" y="1" width="${d.w - 2}" height="${d.h - 2}" rx="4"/>`;
          for (let i = 0; i < g.inputs.length; i++) {
            const q = g.inputs[i], lit = st && st.px && st.px[i];
            s += `<rect class="pxcell ${lit ? 'on' : ''}" x="${q.x - 8}" y="${q.y - 8}" width="16" height="16" rx="2"/>`;
          }
          return s;
        }
        let s = `<rect class="body screen-body" ${S} x="2" y="1" width="${d.w - 4}" height="${d.h - 2}" rx="6"/>`;
        s += `<text class="plate-title" x="${g.PC + g.DW / 2}" y="14">${g.w}×${g.h}</text>`;
        for (const q of g.inputs) s += `<path class="lead ${q.bits > 1 ? 'bus' : ''}" d="M0,${q.y}H12"/><text class="pin-label" x="15" y="${q.y + 3}">${esc(q.label)}</text>`;
        s += `<rect class="screen-bg" x="${g.PC}" y="20" width="${g.DW}" height="${g.DH}"/>`;
        s += `<foreignObject class="px-fo" data-sid="${esc(node.id)}" x="${g.PC}" y="20" width="${g.DW}" height="${g.DH}" style="pointer-events:none"></foreignObject>`;
        return s;
      }
      case 'BUS_IN': case 'BUS_OUT': {
        const g = d.bus, bits = g.bits, val = (st && st.val) || 0, isIn = t === 'BUS_IN';
        const fmt = fixProps(t, node.props).fmt, mid = d.h / 2;
        let s = isIn ? `<path class="lead bus" d="M${d.w - 10},${mid}H${d.w}"/><rect class="body io bus-body ${val ? 'on' : ''}" ${S} x="1" y="1" width="${d.w - 11}" height="${d.h - 2}" rx="4"/>`
          : `<path class="lead bus" d="M0,${mid}H10"/><rect class="body io bus-body ${val ? 'on' : ''}" ${S} x="10" y="1" width="${d.w - 11}" height="${d.h - 2}" rx="4"/>`;
        for (let b = 0; b < bits; b++) {
          const c = busCell(bits, b), on = bitOf(val, b);
          if (isIn) s += `<rect class="bitcell ${on ? 'on' : ''}" x="${5 + c.col * 16}" y="${c.row * 20 + 3}" width="14" height="14" rx="3"/><text class="bitdigit ${on ? 'on' : ''}" x="${12 + c.col * 16}" y="${c.row * 20 + 13.5}">${on}</text>`;
          else s += `<circle class="bitled ${on ? 'on' : ''}" cx="${22 + c.col * 16}" cy="${c.row * 20 + 10}" r="6"/>`;
        }
        return s + `<text class="readout" x="${isIn ? d.w - 12 : d.w - 2}" y="-4">${fmtBus(val, bits, fmt)}</text>`;
      }
      case 'INPUT':
        return `<path class="lead" d="M40,10H50"/><rect class="body io ${on ? 'on' : ''}" ${S} x="1" y="1" width="38" height="18" rx="9"/>` +
          `<circle class="knob ${on ? 'on' : ''}" cx="${on ? 29 : 11}" cy="10" r="6"/><text class="val" x="${on ? 14 : 28}" y="13.5">${on ? 1 : 0}</text>`;
      case 'BUTTON':
        return `<path class="lead" d="M40,10H50"/><rect class="body io ${on ? 'on' : ''}" ${S} x="1" y="1" width="38" height="18" rx="4"/>` +
          `<circle class="knob ${on ? 'on' : ''}" cx="20" cy="10" r="5"/>`;
      case 'CLOCK':
        return `<path class="lead" d="M40,10H50"/><rect class="body io ${on ? 'on' : ''}" ${S} x="1" y="1" width="38" height="18" rx="4"/>` +
          `<path class="wave ${on ? 'on' : ''}" d="M7,14V6H14V14H21V6H28V14H33"/>`;
      case 'CONST0': case 'CONST1':
        return `<path class="lead" d="M30,10H40"/><rect class="body io ${t === 'CONST1' ? 'on' : ''}" ${S} x="1" y="1" width="28" height="18" rx="4"/>` +
          `<text class="val big" x="15" y="14.5">${t === 'CONST1' ? 1 : 0}</text>`;
      case 'OUTPUT':
        return `<path class="lead" d="M0,10H16"/><circle class="led ${on ? 'on' : ''}" cx="24" cy="10" r="8"/>`;
      case 'PROBE':
        return `<path class="lead" d="M0,10H10"/><rect class="body io ${on ? 'on' : ''}" ${S} x="10" y="1" width="28" height="18" rx="4"/>` +
          `<text class="val big" x="24" y="14.5">${on ? 1 : 0}</text>`;
      case 'LABEL':
        return `<text class="note-text" x="4" y="14">${esc(node.props && node.props.label || '')}</text>`;
      case 'TUNNEL_IN':
        return `<path class="lead" d="M0,10H10"/><path class="body" ${S} d="M10,2H46L56,10L46,18H10Z"/>` +
          `<text class="val tun" x="28" y="13">${esc(node.props && node.props.name || '')}</text>`;
      case 'TUNNEL_OUT':
        return `<path class="lead" d="M50,10H60"/><path class="body" ${S} d="M4,10L14,2H50V18H14Z"/>` +
          `<text class="val tun" x="32" y="13">${esc(node.props && node.props.name || '')}</text>`;
      case 'SEG7': case 'HEX': {
        const mask = t === 'HEX' ? HEXSEG[(st && st.val) | 0] || 0 : SEGN.reduce((m, _, i) => m | ((st && st.segs && st.segs[i] ? 1 : 0) << i), 0);
        const x0 = t === 'HEX' ? 20 : 34, y0 = t === 'HEX' ? 8 : 12, W = t === 'HEX' ? 40 : 34, H = t === 'HEX' ? 74 : 126;
        const th = t === 'HEX' ? 5 : 6, hl = W - 2 * th - 2, vl = (H - 3 * th - 4) / 2, my = y0 + (H - th) / 2;
        const seg = (i, x, y, w, hh) => `<rect class="seg ${mask >> i & 1 ? 'on' : ''}" x="${x}" y="${y}" width="${w}" height="${hh}" rx="1.5"/>`;
        let s = `<rect class="body seg-bg" ${S} x="${x0 - 8}" y="${y0 - 6}" width="${W + 16}" height="${H + 12}" rx="6"/>`;
        s += seg(0, x0 + th + 1, y0, hl, th) + seg(6, x0 + th + 1, my, hl, th) + seg(3, x0 + th + 1, y0 + H - th, hl, th);
        s += seg(5, x0, y0 + th + 1, th, vl) + seg(1, x0 + W - th, y0 + th + 1, th, vl);
        s += seg(4, x0, my + th + 1, th, vl) + seg(2, x0 + W - th, my + th + 1, th, vl);
        for (const q of d.inputs) s += `<path class="lead" d="M0,${q.y}H${x0 - 8 > 14 ? 14 : x0 - 8}"/><text class="pin-label" x="16" y="${q.y + 3}">${esc(q.label)}</text>`;
        return s;
      }
      case 'PLATE': {
        if (d.missing) {
          return `<rect class="body missing" x="1" y="1" width="${d.w - 2}" height="${d.h - 2}" rx="6"/><text class="plate-title err" x="${d.w / 2}" y="${d.h / 2 + 4}">missing: ${esc(d.title)}</text>`;
        }
        const w = d.w, h = d.h;
        let s = '';
        for (const q of d.inputs) s += `<path class="lead" d="M0,${q.y}H9"/>`;
        for (const q of d.outputs) s += `<path class="lead" d="M${w - 9},${q.y}H${w}"/>`;
        s += `<rect class="body plate-body" ${S} x="8" y="2" width="${w - 16}" height="${h - 4}" rx="5"/>`;
        s += `<path class="chip-notch" ${S} d="M${w / 2 - 6},2A6,6 0 0 0 ${w / 2 + 6},2"/><circle class="chip-dot" cx="16" cy="10" r="1.8"/>`;
        s += `<text class="plate-title" x="${w / 2}" y="${h / 2 + 4}">${esc(d.title)}</text>`;
        for (const q of d.inputs) s += `<text class="pin-label" x="14" y="${q.y + 3}">${esc(q.label)}</text>`;
        for (const q of d.outputs) s += `<text class="pin-label end" x="${w - 14}" y="${q.y + 3}">${esc(q.label)}</text>`;
        return s;
      }
    }
    return '';
  }

  // Small standalone icon for the palette.
  function iconSVG(type, ref, lib) {
    const extra = type === 'SPLIT' || type === 'MERGE' || type === 'BUS_IN' || type === 'BUS_OUT' ? { bits: 4 } : (type === 'SCREEN' ? { w: 16, h: 16, view: 80 } : {});
    const node = { id: 'x', type, x: 0, y: 0, props: Object.assign(defaultProps(type), extra, ref ? { ref } : {}) };
    const d = describe(node, lib);
    return `<svg class="pal-svg" viewBox="-4 -6 ${d.w + 8} ${d.h + 12}">${bodySVG(node, d, { on: false })}</svg>`;
  }

  return { MAX_BITS, SAFE_BITS, big, parseValue, packValue, bitOf, capacityText, GRID, HEXSEG, SEGN, GATES, MULTI, SINGLE, NAMES, GROUPS, PLANNED, evalGate, defaultProps, fixProps, FORMATS, busGrid, busCell, busBitAt, fmtBus, bitsFor, screenGeom, portsOf, describe, bodySVG, iconSVG, showName };
});
