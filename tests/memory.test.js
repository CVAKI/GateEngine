// Wide buses (64 bit), sparse memory (64 TiB), unlimited clock Hz helpers.
const assert = require('assert');
const D = require('../src/js/gates.js');
const B = require('../src/js/builtins.js');
const { compile, Sim } = require('../src/js/sim.js');
const lib = { get: (n) => B.get(n) };
const p = { format: 1, name: 'm', width: 100, height: 50, nodes: [], wires: [], nextId: 1 };
const add = (t, props) => { const id = 'n' + p.nextId++; p.nodes.push({ id, type: t, x: 0, y: 0, props: Object.assign(D.defaultProps(t), props) }); return id; };
const w = (a, ap, b, bp) => p.wires.push({ id: 'w' + p.nextId++, from: { node: a, pin: ap }, to: { node: b, pin: bp } });
assert.strictEqual(D.fixProps('BUS_IN', { bits: 999 }).bits, 64);
assert.strictEqual(D.fixProps('MEM', { abits: 999, dbits: 0 }).abits, 64);
assert.strictEqual(D.capacityText(46, 8), '64 TiB');
assert.strictEqual(D.packValue(2n ** 64n - 1n, 64), '0xffffffffffffffff');
assert.strictEqual(D.parseValue('0xFFFFFFFFFFFFFFFF', 64), 2n ** 64n - 1n);
const A = add('BUS_IN', { label: 'A', bits: 46 }), Din = add('BUS_IN', { label: 'D', bits: 64 }), WE = add('INPUT', {});
const M = add('MEM', { abits: 46, dbits: 64, init: [['0x3FFFFFFFFFFF', '0xDEADBEEF12345678']] }), Q = add('BUS_OUT', { label: 'Q', bits: 64 });
w(A, 'q', M, 'a'); w(Din, 'q', M, 'd'); w(WE, 'q', M, 'we'); w(M, 'q', Q, 'd');
const nl = compile(p, lib); assert.strictEqual(nl.errors.length, 0);
const s = new Sim(nl); s.settle();
s.setBus(A, 46, 2n ** 46n - 1n); s.settle();
assert.strictEqual(s.bus(Q + '.d', 64), 0xDEADBEEF12345678n, 'init word at the very last address of 64 TiB');
s.setBus(A, 46, 2n ** 45n + 5n); s.setBus(Din, 64, 2n ** 64n - 1n); s.settle();
assert.strictEqual(s.bus(Q + '.d', 64), 0n, 'unwritten word reads 0');
s.set(WE, 1); s.settle(); s.set(WE, 0); s.settle();
assert.strictEqual(s.bus(Q + '.d', 64), 2n ** 64n - 1n, 'write on WE rising edge');
s.setBus(A, 46, 0n); s.settle();
assert.strictEqual(s.bus(Q + '.d', 64), 0n);
assert.strictEqual(s.mems.get(M).data.size, 2, 'sparse: only written words are stored');
// ROM: no D / WE pins, writes impossible
const r = D.describe({ type: 'MEM', props: { mode: 'rom' } });
assert.deepStrictEqual(r.inputs.map((q) => q.name), ['a']);
// a rebuild (Live mode edit) keeps the memory contents
const s2 = new Sim(compile(p, lib), s); s2.settle();
assert.strictEqual(s2.mems.get(M).data.size, 2);
console.log('wide buses + 64 TiB sparse memory ok');
