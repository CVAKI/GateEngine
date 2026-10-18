// Render map layout: every chip opened down to its gates, wires clean, nets joined through chip borders.
// Run with: npm test
const assert = require('assert');
const fs = require('fs'), path = require('path');
const D = require('../src/js/gates.js');
const B = require('../src/js/builtins.js');
const { compile } = require('../src/js/sim.js');
const M = require('../src/js/maplayout.js');
const lib = { get: (n) => B.get(n) };

// ---- the name rule: "gpu.map" and friends get the Render map button
for (const ok of ['gpu.map', 'alu.map', 'GPU.MAP', 'my gpu.map copy', 'a.map v2']) assert.ok(M.isMapName(ok), ok + ' is a map plate');
for (const no of ['gpu', 'mapper', 'roadmap', 'gpu.mapx', 'main', '', null]) assert.ok(!M.isMapName(no), no + ' is not a map plate');

function eachLevel(L, f) { f(L); for (const it of L.items) if (it.kind === 'cluster') eachLevel(it.child, f); }

// ---- every built-in part: the map shows exactly the gates the simulator runs, and the drawing is clean
let wires = 0;
for (const mode of ['plate', 'flow']) for (const name of B.names()) {
  const plate = B.get(name), nl = compile(plate, lib), r = M.layout(plate, lib, { mode });
  if (mode === 'plate') {
    // your layout: parts keep their order
    const its = r.root.items;
    for (const a of its) for (const b of its) if (a !== b && a.ox + a.nw <= b.ox) assert.ok(a.x + a.w <= b.x + 0.5 || a.y + a.h <= b.y || b.y + b.h <= a.y || a.x < b.x, name + ': left stays left');
  }
  assert.strictEqual(r.stats.gates, nl.gates.length, name + ': gates on the map = gates in the netlist');
  eachLevel(r.root, (L) => {
    const its = L.items;
    for (let i = 0; i < its.length; i++) {
      const a = its[i];
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= L.w + 0.5 && a.y + a.h <= L.h + 0.5, name + ': item inside its level');
      for (let j = i + 1; j < its.length; j++) { const b = its[j]; assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${name}: ${a.id} and ${b.id} overlap`); }
    }
    for (const w of L.wires) {
      wires++;
      assert.ok(w.pts.length >= 2, name + ': wire has points');
      for (let i = 1; i < w.pts.length; i++) assert.ok(w.pts[i].x === w.pts[i - 1].x || w.pts[i].y === w.pts[i - 1].y, name + ': wire turns at right angles');
      const src = L.items.find((q) => q.id === w.from.node), dst = L.items.find((q) => q.id === w.to.node);
      const a = src.pins.out[w.from.pin], b = dst.pins.in[w.to.pin];
      assert.deepStrictEqual(w.pts[0], { x: src.x + a.x, y: src.y + a.y }, name + ': wire starts on its output pin');
      assert.deepStrictEqual(w.pts[w.pts.length - 1], { x: dst.x + b.x, y: dst.y + b.y }, name + ': wire ends on its input pin');
      if (mode === 'flow' && !w.back) for (let i = 1; i < w.pts.length; i++) {
        const p = w.pts[i - 1], q = w.pts[i], x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y);
        for (const it of its) if (it.id !== w.from.node && it.id !== w.to.node) assert.ok(!(x2 > it.x + 1 && x1 < it.x + it.w - 1 && y2 > it.y + 1 && y1 < it.y + it.h - 1), `${name}: a wire runs through ${it.id}`);
      }
    }
  });
}
console.log(`ok - ${B.names().length} built-in parts, both layouts: gate counts match the simulator, ${wires} wires clean`);

// ---- your layout: the plate fits its content (no empty room) and the chip that was above stays above
{
  const P = { format: 1, name: 'r.map', width: 90, height: 60, nodes: [{ id: 'n1', type: 'PLATE', x: 100, y: 40, props: { ref: 'Adder 8-bit' } }, { id: 'n2', type: 'PLATE', x: 100, y: 300, props: { ref: 'Comparator 8-bit' } }], wires: [], nextId: 3 };
  const r = M.layout(P, lib, {}), [a, b] = r.root.items;
  assert.ok(a.y + a.h <= b.y, 'the chip that was above stays above');
  let mx = 0, my = 0;
  for (const it of r.root.items) { mx = Math.max(mx, it.x + it.w); my = Math.max(my, it.y + it.h); }
  for (const w of r.root.wires) for (const q of w.pts) { mx = Math.max(mx, q.x); my = Math.max(my, q.y); }
  assert.ok(r.root.w <= mx + 31 && r.root.h <= my + 31, 'plate fits its content');
  console.log('ok - plate fits content:', Math.round(r.root.w), 'x', Math.round(r.root.h));
}

// ---- open chips only as deep as asked
{
  const full = M.layout(B.get('Adder 4-bit'), lib, {}), one = M.layout(B.get('Adder 4-bit'), lib, { maxDepth: 1 }), none = M.layout(B.get('Adder 4-bit'), lib, { maxDepth: 0 });
  assert.ok(full.stats.depth > one.stats.depth && one.stats.depth > none.stats.depth);
  assert.ok(none.root.items.every((i) => i.kind !== 'cluster'), 'depth 0 opens nothing');
  assert.ok(none.root.items.some((i) => i.kind === 'chip' && i.why === 'depth'));
  assert.ok(one.root.items.some((i) => i.kind === 'cluster') && one.root.items.every((i) => i.kind !== 'cluster' || i.child.items.every((c) => c.kind !== 'cluster')));
  console.log('ok - open depth: all =', full.stats.depth, ', 1 =', one.stats.depth, ', 0 =', none.stats.depth);
}

// ---- a signal keeps one net number from the outside of a chip to the gates inside it
{
  const p = { format: 1, name: 'top.map', width: 40, height: 20, nodes: [], wires: [], nextId: 1 };
  p.nodes.push({ id: 'n1', type: 'INPUT', x: 0, y: 0, props: { label: 'A', value: 1 } }, { id: 'n2', type: 'INPUT', x: 0, y: 40, props: { label: 'B', value: 0 } },
    { id: 'n3', type: 'PLATE', x: 100, y: 0, props: { ref: 'Half adder' } }, { id: 'n4', type: 'OUTPUT', x: 300, y: 0, props: { label: 'S' } });
  const ports = D.portsOf(B.get('Half adder')), A = ports.inputs[0].id, S = ports.outputs[0].id;
  p.wires.push({ id: 'w1', from: { node: 'n1', pin: 'q' }, to: { node: 'n3', pin: A } }, { id: 'w2', from: { node: 'n2', pin: 'q' }, to: { node: 'n3', pin: ports.inputs[1].id } }, { id: 'w3', from: { node: 'n3', pin: S }, to: { node: 'n4', pin: 'd' } });
  const r = M.layout(p, lib, {}), top = r.root, chip = top.items.find((i) => i.id === 'n3');
  assert.strictEqual(chip.kind, 'cluster');
  const outer = top.wires.find((w) => w.id === 'w1').net, inner = chip.child.wires.filter((w) => w.fnode === A);
  assert.ok(inner.length >= 2, 'input A fans out to the XOR and the AND inside');
  assert.ok(inner.every((w) => w.net === outer), 'same net inside and outside the chip');
  assert.notStrictEqual(top.wires.find((w) => w.id === 'w2').net, outer, 'a different signal has a different net');
  assert.strictEqual(chip.stubs.length, 4, 'two inputs and two outputs enter the frame');
  console.log('ok - nets run through chip borders');
}

// ---- a plate that contains itself is not opened forever; a missing plate stays a plain (red) chip
{
  const loop = { format: 1, name: 'loop', width: 20, height: 20, nodes: [{ id: 'n1', type: 'PLATE', x: 0, y: 0, props: { ref: 'loop' } }], wires: [], nextId: 2 };
  const miss = { format: 1, name: 'miss', width: 20, height: 20, nodes: [{ id: 'n1', type: 'PLATE', x: 0, y: 0, props: { ref: 'nope' } }], wires: [], nextId: 2 };
  const l2 = { get: (n) => (n === 'loop' ? loop : null) };
  assert.strictEqual(M.layout(loop, l2, {}).root.items[0].why, 'loop');
  assert.strictEqual(M.layout(miss, l2, {}).root.items[0].why, 'missing');
  console.log('ok - loops and missing plates are safe');
}

// ---- the example projects, with feedback loops and buses
for (const proj of ['Adders', 'Series', 'Screen', 'RenderMap']) {
  const dir = path.join(__dirname, '..', 'examples', proj, 'plates'), plates = new Map();
  for (const f of fs.readdirSync(dir)) plates.set(f.replace('.plate.json', ''), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const pl = { get: (n) => B.get(n) || plates.get(n) || null };
  for (const [name, plate] of plates) {
    const nl = compile(plate, pl), r = M.layout(plate, pl, {});
    if (!nl.errors.length) assert.strictEqual(r.stats.gates, nl.gates.length, `${proj}/${name}: gate count`);
    assert.ok(r.root.w > 0 && r.root.h > 0);
  }
}
console.log('ok - example projects lay out');
