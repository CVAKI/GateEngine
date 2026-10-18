// Run with: npm test
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const D = require('../src/js/gates.js');
const { compile, Sim } = require('../src/js/sim.js');

function plate(name, w = 80, h = 50) { return { format: 1, name, width: w, height: h, nodes: [], wires: [], nextId: 1 }; }
function add(p, type, x, y, props) {
  const id = 'n' + p.nextId++;
  p.nodes.push({ id, type, x, y, props: Object.assign(D.defaultProps(type), props || {}) });
  return id;
}
function wire(p, a, apin, b, bpin) { p.wires.push({ id: 'w' + p.nextId++, from: { node: a, pin: apin }, to: { node: b, pin: bpin } }); }
function run(p, lib, inputs) {
  const nl = compile(p, lib);
  assert.deepStrictEqual(nl.errors, []);
  const sim = new Sim(nl);
  for (const [k, v] of Object.entries(inputs || {})) sim.set(k, v);
  sim.settle();
  return { sim, nl };
}

// Half adder: S = A xor B, C = A and B
const half = plate('HalfAdder', 45, 28);
const hA = add(half, 'INPUT', 10, 40, { label: 'A' });
const hB = add(half, 'INPUT', 10, 200, { label: 'B' });
const hx = add(half, 'XOR', 200, 40);
const ha = add(half, 'AND', 200, 160);
const hS = add(half, 'OUTPUT', 350, 60, { label: 'S' });
const hC = add(half, 'OUTPUT', 350, 180, { label: 'C' });
wire(half, hA, 'q', hx, 'i0'); wire(half, hB, 'q', hx, 'i1');
wire(half, hA, 'q', ha, 'i0'); wire(half, hB, 'q', ha, 'i1');
wire(half, hx, 'y', hS, 'd'); wire(half, ha, 'y', hC, 'd');

for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
  const { sim } = run(half, { get: () => null }, { [hA]: a, [hB]: b });
  assert.strictEqual(sim.pin(hS + '.d'), a ^ b, 'half adder sum');
  assert.strictEqual(sim.pin(hC + '.d'), a & b, 'half adder carry');
}

// Full adder built from two HalfAdder plates + OR (tests nested plates)
const full = plate('FullAdder', 90, 50);
const lib = { get: (n) => ({ HalfAdder: half, FullAdder: full }[n] || null) };
const fA = add(full, 'INPUT', 10, 40, { label: 'A' });
const fB = add(full, 'INPUT', 10, 120, { label: 'B' });
const fC = add(full, 'INPUT', 10, 300, { label: 'Cin' });
const h1 = add(full, 'PLATE', 150, 60, { ref: 'HalfAdder' });
const h2 = add(full, 'PLATE', 400, 200, { ref: 'HalfAdder' });
const or = add(full, 'OR', 640, 360);
const fS = add(full, 'OUTPUT', 800, 220, { label: 'S' });
const fCo = add(full, 'OUTPUT', 800, 380, { label: 'Cout' });
const d1 = D.describe(full.nodes.find((n) => n.id === h1), lib);
assert.deepStrictEqual(d1.inputs.map((p) => p.name), [hA, hB]);
assert.deepStrictEqual(d1.outputs.map((p) => p.name), [hS, hC]);
wire(full, fA, 'q', h1, hA); wire(full, fB, 'q', h1, hB);
wire(full, h1, hS, h2, hA); wire(full, fC, 'q', h2, hB);
wire(full, h2, hS, fS, 'd');
wire(full, h1, hC, or, 'i0'); wire(full, h2, hC, or, 'i1');
wire(full, or, 'y', fCo, 'd');

for (let i = 0; i < 8; i++) {
  const a = i & 1, b = (i >> 1) & 1, c = (i >> 2) & 1;
  const { sim } = run(full, lib, { [fA]: a, [fB]: b, [fC]: c });
  const total = a + b + c;
  assert.strictEqual(sim.pin(fS + '.d'), total & 1, `full adder sum ${a}${b}${c}`);
  assert.strictEqual(sim.pin(fCo + '.d'), total >> 1, `full adder carry ${a}${b}${c}`);
}

// Flattened netlist: 2 half adders (2 gates each) + OR = 5 gates
assert.strictEqual(compile(full, lib).gates.length, 5);

// SR latch from cross-coupled NOR gates holds state
const sr = plate('SR');
const sS = add(sr, 'INPUT', 0, 10, { label: 'S' });
const sR = add(sr, 'INPUT', 0, 50, { label: 'R' });
const n1 = add(sr, 'NOR', 30, 50);
const n2 = add(sr, 'NOR', 30, 10);
const qo = add(sr, 'OUTPUT', 100, 50, { label: 'Q' });
wire(sr, sR, 'q', n1, 'i0'); wire(sr, n2, 'y', n1, 'i1');
wire(sr, sS, 'q', n2, 'i0'); wire(sr, n1, 'y', n2, 'i1');
wire(sr, n1, 'y', qo, 'd');
{
  const nl = compile(sr, { get: () => null });
  const sim = new Sim(nl);
  sim.set(sS, 1); assert.ok(sim.settle());
  sim.set(sS, 0); sim.settle(); const held = sim.pin(qo + '.d');
  sim.settle(); assert.strictEqual(sim.pin(qo + '.d'), held, 'latch holds');
  sim.set(sR, 1); sim.settle(); sim.set(sR, 0); sim.settle();
  const afterReset = sim.pin(qo + '.d');
  sim.set(sS, 1); sim.settle(); sim.set(sS, 0); sim.settle();
  assert.notStrictEqual(sim.pin(qo + '.d'), afterReset, 'set flips the stored bit');
  assert.ok(!sim.unstable);
}

// Self-containing plate is reported, not looped forever
const loop = plate('Loop');
add(loop, 'PLATE', 0, 0, { ref: 'Loop' });
assert.ok(compile(loop, { get: (n) => (n === 'Loop' ? loop : null) }).errors.length > 0);
// Missing plate is reported
const miss = plate('Miss'); add(miss, 'PLATE', 0, 0, { ref: 'Nope' });
assert.ok(compile(miss, { get: () => null }).errors.length > 0);

// Write the example project (open it from the app with "Open project")
const out = path.join(__dirname, '..', 'examples', 'Adders');
fs.mkdirSync(path.join(out, 'plates'), { recursive: true });
fs.writeFileSync(path.join(out, 'gate.project.json'), JSON.stringify({ name: 'Adders', format: 1, created: 0, main: 'FullAdder' }, null, 2));
for (const p of [half, full, sr]) fs.writeFileSync(path.join(out, 'plates', p.name + '.plate.json'), JSON.stringify(p, null, 2));

console.log('All simulator tests passed.');
