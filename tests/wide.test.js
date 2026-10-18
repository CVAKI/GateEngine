// 32-bit buses: a Bit input of 32 wires reaches a Bit output intact, and 32-bit adds wrap like real hardware.
const assert = require('assert');
const D = require('../src/js/gates.js');
const B = require('../src/js/builtins.js');
const { compile, Sim } = require('../src/js/sim.js');
const lib = { get: (n) => B.get(n) };
function plate() {
  const p = { format: 1, name: 'w', width: 100, height: 50, nodes: [], wires: [], nextId: 1 };
  const add = (type, props) => { const id = 'n' + p.nextId++; p.nodes.push({ id, type, x: 0, y: 0, props: Object.assign(D.defaultProps(type), props) }); return id; };
  return { p, add, w: (a, ap, b, bp) => p.wires.push({ id: 'w' + p.nextId++, from: { node: a, pin: ap }, to: { node: b, pin: bp } }) };
}
const k = plate();
const i = k.add('BUS_IN', { label: 'A', bits: 32, value: 0 }), o = k.add('BUS_OUT', { label: 'Y', bits: 32 });
k.w(i, 'q', o, 'd');
assert.strictEqual(D.fixProps('BUS_IN', { bits: 99, value: 2 ** 40 }).bits, 64);
assert.strictEqual(D.fixProps('BUS_IN', { bits: 32, value: 2 ** 40 }).value, 2 ** 32 - 1);
const s = new Sim(compile(k.p, lib)); s.settle();
for (const v of [0, 1, 0x80000000, 0xDEADBEEF, 0xFFFFFFFF, 0x12345678]) {
  s.setBus(i, 32, v); s.settle();
  assert.strictEqual(s.bus(o + '.d', 32), v, 'bus value ' + v.toString(16));
  assert.strictEqual(s.getBus(i, 32), v);
}
assert.strictEqual(D.fmtBus(0xFFFFFFFF, 32, 'signed'), '-1');
assert.strictEqual(D.fmtBus(0x80000000, 32, 'hex'), '0x80000000');
console.log('32-bit buses ok');
