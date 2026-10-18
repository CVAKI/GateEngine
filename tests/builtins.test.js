// Run with: npm test  (checks every built-in part with real truth tables / clocked sequences)
const assert = require('assert');
const D = require('../src/js/gates.js');
const B = require('../src/js/builtins.js');
const { compile, Sim } = require('../src/js/sim.js');
const lib = { get: (n) => B.get(n) };

// Wrap a built-in in a test plate: one switch per input pin, one LED per output pin.
function rig(name) {
  const child = B.get(name);
  const ports = D.portsOf(child);
  const p = { format: 1, name: 'rig', width: 100, height: 100, nodes: [], wires: [], nextId: 1 };
  const add = (type, props) => { const id = 'n' + p.nextId++; p.nodes.push({ id, type, x: 0, y: 0, props: Object.assign(D.defaultProps(type), props || {}) }); return id; };
  const chip = add('PLATE', { ref: name });
  const ins = {}, outs = {};
  for (const q of ports.inputs) { const id = q.bits > 1 ? add('BUS_IN', { label: q.label, bits: q.bits }) : add('INPUT', { label: q.label }); ins[q.label] = id; p.wires.push({ id: 'w' + p.nextId++, from: { node: id, pin: 'q' }, to: { node: chip, pin: q.id } }); }
  for (const q of ports.outputs) { const id = q.bits > 1 ? add('BUS_OUT', { label: q.label, bits: q.bits }) : add('OUTPUT', { label: q.label }); outs[q.label] = id; p.wires.push({ id: 'w' + p.nextId++, from: { node: chip, pin: q.id }, to: { node: id, pin: 'd' } }); }
  const nl = compile(p, lib);
  assert.deepStrictEqual(nl.errors, [], name + ' compiles');
  const sim = new Sim(nl);
  const r = {
    nl, sim,
    set(l, v) { sim.set(ins[l], v); },
    get(l) { return sim.pin(outs[l] + '.d'); },
    go() { assert.ok(sim.settle(), name + ' settles'); },
    put(obj) { for (const [k, v] of Object.entries(obj)) r.set(k, v); r.go(); },
    clock(obj) { r.put(Object.assign({}, obj, { CLK: 0 })); r.put({ CLK: 1 }); r.put({ CLK: 0 }); },
    read(labels) { return labels.map((l) => r.get(l)); },
  };
  r.go();
  return r;
}
const num = (arr) => arr.reduce((s, v, i) => s + (v << i), 0);

// every built-in compiles and has ports
for (const n of B.names()) { const r = rig(n); assert.ok(r.nl.gates.length > 0, n + ' has gates'); }

{ const r = rig('Half adder'); for (let i = 0; i < 4; i++) { const a = i & 1, b = i >> 1; r.put({ A: a, B: b }); assert.strictEqual(r.get('S'), a ^ b); assert.strictEqual(r.get('C'), a & b); } }
{ const r = rig('Full adder'); for (let i = 0; i < 8; i++) { const a = i & 1, b = (i >> 1) & 1, c = i >> 2; r.put({ A: a, B: b, Cin: c }); assert.strictEqual(r.get('S'), (a + b + c) & 1); assert.strictEqual(r.get('Cout'), (a + b + c) >> 1); } }
{ const r = rig('MUX 2:1'); for (let i = 0; i < 8; i++) { const a = i & 1, b = (i >> 1) & 1, s = i >> 2; r.put({ D0: a, D1: b, S: s }); assert.strictEqual(r.get('Y'), s ? b : a); } }
{ const r = rig('MUX 4:1'); for (let s = 0; s < 4; s++) for (let d = 0; d < 16; d++) { r.put({ D0: d & 1, D1: (d >> 1) & 1, D2: (d >> 2) & 1, D3: (d >> 3) & 1, S0: s & 1, S1: s >> 1 }); assert.strictEqual(r.get('Y'), (d >> s) & 1); } }
{ const r = rig('Decoder 2:4'); for (let en = 0; en < 2; en++) for (let a = 0; a < 4; a++) { r.put({ A0: a & 1, A1: a >> 1, EN: en }); assert.deepStrictEqual(r.read(['Y0', 'Y1', 'Y2', 'Y3']), [0, 1, 2, 3].map((m) => (en && m === a ? 1 : 0))); } }
{ const r = rig('DEMUX 1:4'); for (let d = 0; d < 2; d++) for (let a = 0; a < 4; a++) { r.put({ D: d, S0: a & 1, S1: a >> 1 }); assert.deepStrictEqual(r.read(['Y0', 'Y1', 'Y2', 'Y3']), [0, 1, 2, 3].map((m) => (d && m === a ? 1 : 0))); } }
{ const r = rig('Encoder 4:2'); for (let v = 0; v < 16; v++) { r.put({ I0: v & 1, I1: (v >> 1) & 1, I2: (v >> 2) & 1, I3: v >> 3 }); const hi = v ? 31 - Math.clz32(v) : 0; assert.strictEqual(r.get('V'), v ? 1 : 0); if (v) assert.strictEqual(r.get('A0') + 2 * r.get('A1'), hi, 'encoder ' + v); } }
{ const r = rig('Comparator 1-bit'); for (let i = 0; i < 4; i++) { const a = i & 1, b = i >> 1; r.put({ A: a, B: b }); assert.deepStrictEqual(r.read(['GT', 'EQ', 'LT']), [+(a > b), +(a === b), +(a < b)]); } }
{ const r = rig('Comparator 4-bit'); for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) { r.put({ A0: a & 1, A1: (a >> 1) & 1, A2: (a >> 2) & 1, A3: a >> 3, B0: b & 1, B1: (b >> 1) & 1, B2: (b >> 2) & 1, B3: b >> 3 }); assert.deepStrictEqual(r.read(['GT', 'EQ', 'LT']), [+(a > b), +(a === b), +(a < b)], `cmp ${a} ${b}`); } }

{ const r = rig('SR latch'); r.put({ S: 1, R: 0 }); assert.strictEqual(r.get('Q'), 1); r.put({ S: 0 }); assert.strictEqual(r.get('Q'), 1); assert.strictEqual(r.get('Qn'), 0); r.put({ R: 1 }); assert.strictEqual(r.get('Q'), 0); r.put({ R: 0 }); assert.strictEqual(r.get('Q'), 0); }
{ const r = rig('D latch'); r.put({ D: 1, E: 1 }); assert.strictEqual(r.get('Q'), 1); r.put({ E: 0 }); r.put({ D: 0 }); assert.strictEqual(r.get('Q'), 1, 'latch holds'); r.put({ E: 1 }); assert.strictEqual(r.get('Q'), 0); }
{ // rising-edge D flip-flop: ignores D while the clock is high, captures on the edge
  const r = rig('D flip-flop'); r.clock({ D: 0 }); assert.strictEqual(r.get('Q'), 0, 'clocked in 0'); r.put({ D: 1, CLK: 0 }); assert.strictEqual(r.get('Q'), 0, 'D alone changes nothing');
  r.put({ CLK: 1 }); assert.strictEqual(r.get('Q'), 1); r.put({ D: 0 }); assert.strictEqual(r.get('Q'), 1, 'no change while high');
  r.put({ CLK: 0 }); assert.strictEqual(r.get('Q'), 1, 'no change on falling edge'); r.put({ CLK: 1 }); assert.strictEqual(r.get('Q'), 0); assert.strictEqual(r.get('Qn'), 1); }
{ const r = rig('T flip-flop'); r.put({ T: 1, CLK: 0 }); let q = r.get('Q'); for (let i = 0; i < 4; i++) { r.put({ CLK: 1 }); r.put({ CLK: 0 }); q ^= 1; assert.strictEqual(r.get('Q'), q, 'toggle'); } r.put({ T: 0 }); r.put({ CLK: 1 }); r.put({ CLK: 0 }); assert.strictEqual(r.get('Q'), q, 'T=0 holds'); }
{ const r = rig('JK flip-flop'); r.put({ J: 0, K: 0, CLK: 0 }); r.clock({ J: 1, K: 0 }); assert.strictEqual(r.get('Q'), 1, 'set'); r.clock({ J: 0, K: 0 }); assert.strictEqual(r.get('Q'), 1, 'hold'); r.clock({ J: 1, K: 1 }); assert.strictEqual(r.get('Q'), 0, 'toggle'); r.clock({ J: 1, K: 1 }); assert.strictEqual(r.get('Q'), 1, 'toggle'); r.clock({ J: 0, K: 1 }); assert.strictEqual(r.get('Q'), 0, 'reset'); }
{ const r = rig('Register 4-bit'); r.put({ D0: 1, D1: 0, D2: 1, D3: 1, LD: 1, CLK: 0 }); r.clock({ LD: 1 }); assert.strictEqual(num(r.read(['Q0', 'Q1', 'Q2', 'Q3'])), 13); r.put({ D0: 0, D1: 1, D2: 0, D3: 0, LD: 0 }); r.clock({ LD: 0 }); assert.strictEqual(num(r.read(['Q0', 'Q1', 'Q2', 'Q3'])), 13, 'holds when LD=0'); r.clock({ LD: 1 }); assert.strictEqual(num(r.read(['Q0', 'Q1', 'Q2', 'Q3'])), 2); }
{ const r = rig('Counter 4-bit'); r.put({ RST: 1, CLK: 0 }); r.clock({ RST: 1 }); assert.strictEqual(num(r.read(['Q0', 'Q1', 'Q2', 'Q3'])), 0); r.put({ RST: 0 }); for (let i = 1; i <= 20; i++) { r.clock({}); assert.strictEqual(num(r.read(['Q0', 'Q1', 'Q2', 'Q3'])), i % 16, 'count ' + i); } r.put({ RST: 1 }); r.clock({ RST: 1 }); assert.strictEqual(num(r.read(['Q0', 'Q1', 'Q2', 'Q3'])), 0, 'reset'); }
{ const r = rig('Shift register 4-bit'); r.put({ SI: 0, CLK: 0 }); for (let i = 0; i < 4; i++) r.clock({ SI: 0 }); const bits = [1, 0, 1, 1]; bits.forEach((b) => r.clock({ SI: b })); assert.deepStrictEqual(r.read(['Q0', 'Q1', 'Q2', 'Q3']), [1, 1, 0, 1], 'shifted in 1,0,1,1'); }
{ const r = rig('ROM 4x4'); const words = [0x5, 0xA, 0x3, 0xF]; for (let a = 0; a < 4; a++) { r.put({ A0: a & 1, A1: a >> 1 }); assert.strictEqual(num(r.read(['D0', 'D1', 'D2', 'D3'])), words[a]); } }
{ const r = rig('RAM 4x1'); const mem = [1, 0, 1, 1]; r.put({ A0: 0, A1: 0, D: 0, WE: 0 });
  for (let a = 0; a < 4; a++) { r.put({ A0: a & 1, A1: a >> 1, D: mem[a], WE: 1 }); r.put({ WE: 0 }); }
  r.put({ D: 0 });
  for (let a = 0; a < 4; a++) { r.put({ A0: a & 1, A1: a >> 1 }); assert.strictEqual(r.get('Q'), mem[a], 'ram read ' + a); }
  r.put({ A0: 1, A1: 0, D: 0, WE: 1 }); r.put({ WE: 0 }); r.put({ A0: 1, A1: 0 }); assert.strictEqual(r.get('Q'), 0); r.put({ A0: 0, A1: 1 }); assert.strictEqual(r.get('Q'), 1, 'other words untouched'); }
{ const r = rig('Hex decoder'); for (let v = 0; v < 16; v++) { r.put({ D0: v & 1, D1: (v >> 1) & 1, D2: (v >> 2) & 1, D3: v >> 3 }); assert.strictEqual(num(r.read(['a', 'b', 'c', 'd', 'e', 'f', 'g'])), D.HEXSEG[v], 'hex seg ' + v); } }

// tunnels: same name on one plate = one net; live pins inside nested chips are readable
{
  const p = { format: 1, name: 't', width: 50, height: 50, nodes: [], wires: [], nextId: 1 };
  const add = (type, props) => { const id = 'n' + p.nextId++; p.nodes.push({ id, type, x: 0, y: 0, props: Object.assign(D.defaultProps(type), props || {}) }); return id; };
  const w = (a, ap, b, bp) => p.wires.push({ id: 'w' + p.nextId++, from: { node: a, pin: ap }, to: { node: b, pin: bp } });
  const i = add('INPUT'), ti = add('TUNNEL_IN', { name: 'X' }), to = add('TUNNEL_OUT', { name: 'X' }), o = add('OUTPUT'), fa = add('PLATE', { ref: 'Half adder' });
  w(i, 'q', ti, 'd'); w(to, 'q', o, 'd');
  const nl = compile(p, lib); assert.deepStrictEqual(nl.errors, []);
  const sim = new Sim(nl); sim.set(i, 1); sim.settle(); assert.strictEqual(sim.pin(o + '.d'), 1, 'tunnel carries the signal');
  assert.ok(sim.nl.topNets.has(fa + '/n3.y'), 'pins inside chips are addressable (path n/..)');
}

console.log('All built-in part tests passed (' + B.names().length + ' parts).');
