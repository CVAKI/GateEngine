// Bit input / Bit output parts, bus pins on chips, and the ready-made series chips (8-bit adder, ...).
// Run with: npm test
const assert = require('assert');
const D = require('../src/js/gates.js');
const B = require('../src/js/builtins.js');
const { compile, Sim } = require('../src/js/sim.js');
const lib = { get: (n) => B.get(n) };

// Wrap a built-in in a test plate: a Bit input per bus pin, a switch per 1-bit pin, a Bit output / LED per output.
function rig(name) {
  const child = B.get(name), ports = D.portsOf(child);
  const p = { format: 1, name: 'rig', width: 100, height: 100, nodes: [], wires: [], nextId: 1 };
  const add = (type, props) => { const id = 'n' + p.nextId++; p.nodes.push({ id, type, x: 0, y: 0, props: D.fixProps(type, Object.assign(D.defaultProps(type), props || {})) }); return id; };
  const wire = (a, ap, b, bp) => p.wires.push({ id: 'w' + p.nextId++, from: { node: a, pin: ap }, to: { node: b, pin: bp } });
  const chip = add('PLATE', { ref: name }), ins = {}, outs = {}, bits = {};
  for (const q of ports.inputs) { const id = q.bits > 1 ? add('BUS_IN', { label: q.label, bits: q.bits }) : add('INPUT', { label: q.label }); ins[q.label] = id; bits[q.label] = q.bits; wire(id, 'q', chip, q.id); }
  for (const q of ports.outputs) { const id = q.bits > 1 ? add('BUS_OUT', { label: q.label, bits: q.bits }) : add('OUTPUT', { label: q.label }); outs[q.label] = id; bits[q.label] = q.bits; wire(chip, q.id, id, 'd'); }
  const nl = compile(p, lib);
  assert.deepStrictEqual(nl.errors, [], name + ' compiles');
  const sim = new Sim(nl);
  const r = {
    nl, sim, bits,
    set(l, v) { if (bits[l] > 1) sim.setBus(ins[l], bits[l], v); else sim.set(ins[l], v); },
    get(l) { return bits[l] > 1 ? sim.bus(outs[l] + '.d', bits[l]) : sim.pin(outs[l] + '.d'); },
    go() { assert.ok(sim.settle(), name + ' settles'); },
    put(o) { for (const [k, v] of Object.entries(o)) r.set(k, v); r.go(); },
    clock(o) { r.put(Object.assign({}, o, { CLK: 0 })); r.put({ CLK: 1 }); r.put({ CLK: 0 }); },
  };
  r.go();
  return r;
}
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

// ---------- Bit input and Bit output as plain parts ----------
{
  const p = { format: 1, name: 't', width: 100, height: 100, nodes: [], wires: [], nextId: 1 };
  const add = (type, props) => { const id = 'n' + p.nextId++; p.nodes.push({ id, type, x: 0, y: 0, props: D.fixProps(type, Object.assign(D.defaultProps(type), props || {})) }); return id; };
  const inp = add('BUS_IN', { bits: 8, value: 0xA5 }), out = add('BUS_OUT', { bits: 8 }), sp = add('SPLIT', { bits: 8 }), mg = add('MERGE', { bits: 8 });
  const wire = (a, ap, b, bp) => p.wires.push({ id: 'w' + p.nextId++, from: { node: a, pin: ap }, to: { node: b, pin: bp } });
  wire(inp, 'q', sp, 'bus');
  for (let i = 0; i < 8; i++) wire(sp, 'o' + i, mg, 'i' + (7 - i));    // reverse the bit order
  wire(mg, 'bus', out, 'd');
  const nl = compile(p, { get: () => null });
  assert.deepStrictEqual(nl.errors, []);
  const sim = new Sim(nl); sim.settle();
  assert.strictEqual(sim.getBus(inp, 8), 0xA5, 'initial value from the part');
  assert.strictEqual(sim.bus(out + '.d', 8), 0xA5, 'value reaches the output (0xA5 reads the same reversed)');
  sim.setBus(inp, 8, 0x01); sim.settle(); assert.strictEqual(sim.bus(out + '.d', 8), 0x80, 'bit order reversed');
  sim.toggle(inp + '[3]'); sim.settle(); assert.strictEqual(sim.bus(out + '.d', 8), 0x90);
  // a bus wire into a 1-bit pin is refused
  const q = { format: 1, name: 'q', width: 100, height: 100, nodes: [], wires: [], nextId: 1 };
  q.nodes.push({ id: 'a', type: 'BUS_IN', x: 0, y: 0, props: D.fixProps('BUS_IN', {}) }, { id: 'b', type: 'OUTPUT', x: 0, y: 0, props: {} });
  q.wires.push({ id: 'w1', from: { node: 'a', pin: 'q' }, to: { node: 'b', pin: 'd' } });
  assert.ok(/Bus width mismatch/.test(compile(q, { get: () => null }).errors[0]), 'an 8-bit bus into a 1-bit pin is an error');
  console.log('bit input / output ok');
}

// ---------- formats and cells ----------
{
  assert.strictEqual(D.fmtBus(173, 8, 'dec'), '173'); assert.strictEqual(D.fmtBus(173, 8, 'hex'), '0xAD');
  assert.strictEqual(D.fmtBus(173, 8, 'signed'), '-83'); assert.strictEqual(D.fmtBus(5, 4, 'bin'), '0b0101');
  for (const bits of [2, 3, 4, 8, 9, 12, 16]) {
    const seen = new Set();
    for (let b = 0; b < bits; b++) { const c = D.busCell(bits, b); assert.strictEqual(D.busBitAt(bits, 5 + c.col * 16 + 7, c.row * 20 + 10), b, `cell ${bits}:${b}`); seen.add(c.col + ',' + c.row); }
    assert.strictEqual(seen.size, bits, 'no two bits share a cell');
  }
  assert.strictEqual(D.fixProps('BUS_IN', { bits: 99, value: 99999 }).bits, 64);
  assert.strictEqual(D.fixProps('BUS_IN', { bits: 4, value: 99 }).value, 15);
  assert.strictEqual(D.fixProps('BUS_OUT', { fmt: 'nope' }).fmt, 'dec');
  console.log('formats and cells ok');
}

// ---------- chip with bus pins: a user plate with Bit input / Bit output ports ----------
{
  const inner = { format: 1, name: 'Inv8', width: 40, height: 20, nextId: 1, nodes: [
    { id: 'i', type: 'BUS_IN', x: 10, y: 10, props: D.fixProps('BUS_IN', { label: 'X', bits: 8 }) },
    { id: 'o', type: 'BUS_OUT', x: 300, y: 10, props: D.fixProps('BUS_OUT', { label: 'NX', bits: 8 }) },
    { id: 's', type: 'SPLIT', x: 100, y: 10, props: { bits: 8 } }, { id: 'm', type: 'MERGE', x: 200, y: 10, props: { bits: 8 } },
    ...Array.from({ length: 8 }, (_, k) => ({ id: 'g' + k, type: 'NOT', x: 150, y: 10 + 40 * k, props: {} })),
  ], wires: [{ id: 'a', from: { node: 'i', pin: 'q' }, to: { node: 's', pin: 'bus' } }, { id: 'b', from: { node: 'm', pin: 'bus' }, to: { node: 'o', pin: 'd' } }] };
  inner.nodes.forEach((n) => { if (n.type === 'BUS_IN') n.y = 10; });
  for (let k = 0; k < 8; k++) inner.wires.push({ id: 'x' + k, from: { node: 's', pin: 'o' + k }, to: { node: 'g' + k, pin: 'i0' } }, { id: 'y' + k, from: { node: 'g' + k, pin: 'y' }, to: { node: 'm', pin: 'i' + k } });
  const L = { get: (n) => (n === 'Inv8' ? inner : B.get(n)) };
  const ports = D.portsOf(inner);
  assert.deepStrictEqual(ports.inputs.map((q) => [q.label, q.bits]), [['X', 8]]); assert.deepStrictEqual(ports.outputs.map((q) => [q.label, q.bits]), [['NX', 8]]);
  const d = D.describe({ id: 'c', type: 'PLATE', props: { ref: 'Inv8' } }, L);
  assert.strictEqual(d.inputs[0].bits, 8); assert.strictEqual(d.inputs[0].label, 'X[8]'); assert.strictEqual(d.outputs[0].bits, 8);
  // two chips in a row: bus to bus, value comes back unchanged
  const p = { format: 1, name: 'top', width: 100, height: 100, nodes: [], wires: [], nextId: 1 };
  const add = (type, props) => { const id = 'n' + p.nextId++; p.nodes.push({ id, type, x: 0, y: 0, props: D.fixProps(type, Object.assign(D.defaultProps(type), props || {})) }); return id; };
  const a = add('BUS_IN', { bits: 8 }), c1 = add('PLATE', { ref: 'Inv8' }), c2 = add('PLATE', { ref: 'Inv8' }), o = add('BUS_OUT', { bits: 8 }), o2 = add('BUS_OUT', { bits: 8 });
  const wire = (x, xp, y, yp) => p.wires.push({ id: 'w' + p.nextId++, from: { node: x, pin: xp }, to: { node: y, pin: yp } });
  wire(a, 'q', c1, 'i'); wire(c1, 'o', c2, 'i'); wire(c2, 'o', o, 'd'); wire(c1, 'o', o2, 'd');
  const nl = compile(p, L); assert.deepStrictEqual(nl.errors, []);
  const sim = new Sim(nl);
  for (const v of [0, 1, 0x55, 0xF0, 0xFF, 173]) { sim.setBus(a, 8, v); sim.settle(); assert.strictEqual(sim.bus(o2 + '.d', 8), (~v) & 255, 'inverted ' + v); assert.strictEqual(sim.bus(o + '.d', 8), v, 'double inverted ' + v); }
  // the live values inside a chip are reachable by path ('n2/' + part id)
  sim.setBus(a, 8, 0x0F); sim.settle(); assert.strictEqual(sim.bus(c1 + '/o.d', 8), 0xF0);
  console.log('bus pins on chips ok');
}

// ---------- the series chips ----------
const mask = (n) => (1 << n) - 1;
for (const N of [4, 8, 16]) {
  const r = rig(`Adder ${N}-bit`);
  assert.strictEqual(r.bits.A, N); assert.strictEqual(r.bits.S, N);
  const cases = [[0, 0, 0], [mask(N), 1, 0], [mask(N), mask(N), 1], [mask(N), 0, 1], [1, mask(N), 0]];
  if (N === 4) for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let c = 0; c < 2; c++) cases.push([a, b, c]);
  else for (let i = 0; i < 300; i++) cases.push([rnd(1 << N), rnd(1 << N), rnd(2)]);
  for (const [a, b, c] of cases) { r.put({ A: a, B: b, Cin: c }); const t = a + b + c; assert.strictEqual(r.get('S'), t & mask(N), `Adder ${N}: ${a}+${b}+${c}`); assert.strictEqual(r.get('Cout'), t >> N, `Adder ${N} carry ${a}+${b}+${c}`); }
}
{ const r = rig('Add-Sub 8-bit'); for (let i = 0; i < 400; i++) { const a = rnd(256), b = rnd(256), s = rnd(2); r.put({ A: a, B: b, SUB: s }); const t = s ? a - b : a + b; assert.strictEqual(r.get('S'), t & 255, `addsub ${a} ${s ? '-' : '+'} ${b}`); assert.strictEqual(r.get('Cout'), s ? +(a >= b) : t >> 8, 'carry/no-borrow'); } }
{ const r = rig('Incrementer 8-bit'); for (let a = 0; a < 256; a++) { r.put({ A: a }); assert.strictEqual(r.get('Y'), (a + 1) & 255, 'inc ' + a); assert.strictEqual(r.get('Cout'), +(a === 255)); } }
for (const [n, f] of [['AND 8-bit', (a, b) => a & b], ['OR 8-bit', (a, b) => a | b], ['XOR 8-bit', (a, b) => a ^ b]]) {
  const r = rig(n); for (let i = 0; i < 200; i++) { const a = rnd(256), b = rnd(256); r.put({ A: a, B: b }); assert.strictEqual(r.get('Y'), f(a, b), `${n} ${a} ${b}`); }
}
{ const r = rig('NOT 8-bit'); for (let a = 0; a < 256; a++) { r.put({ A: a }); assert.strictEqual(r.get('Y'), (~a) & 255, 'not ' + a); } }
{ const r = rig('MUX 2:1 8-bit'); for (let i = 0; i < 200; i++) { const a = rnd(256), b = rnd(256), s = rnd(2); r.put({ A: a, B: b, SEL: s }); assert.strictEqual(r.get('Y'), s ? b : a, `mux ${a} ${b} ${s}`); } }
{ const r = rig('Comparator 8-bit'); const cs = [[0, 0], [255, 255], [255, 0], [0, 255], [16, 15], [15, 16], [0x80, 0x7F]]; for (let i = 0; i < 400; i++) cs.push([rnd(256), rnd(256)]); for (let i = 0; i < 100; i++) { const a = rnd(256); cs.push([a, a], [a, a ^ (1 << rnd(8))]); }
  for (const [a, b] of cs) { r.put({ A: a, B: b }); assert.deepStrictEqual([r.get('GT'), r.get('EQ'), r.get('LT')], [+(a > b), +(a === b), +(a < b)], `cmp ${a} ${b}`); } }
{ const r = rig('Register 8-bit'); r.put({ D: 0, LD: 0, CLK: 0 }); r.clock({ D: 0xA7, LD: 1 }); assert.strictEqual(r.get('Q'), 0xA7, 'loaded');
  r.put({ D: 0x18, LD: 0 }); r.clock({ D: 0x18, LD: 0 }); assert.strictEqual(r.get('Q'), 0xA7, 'holds while LD=0'); r.clock({ D: 0x18, LD: 1 }); assert.strictEqual(r.get('Q'), 0x18, 'loads again');
  for (const v of [0, 255, 0x81, 0x7E]) { r.clock({ D: v, LD: 1 }); assert.strictEqual(r.get('Q'), v); } }
console.log('series chips ok: adders 4/8/16, add-sub, incrementer, AND/OR/XOR/NOT, MUX, comparator, register');
console.log('ALL SERIES TESTS PASSED');
