// Tri-state buffers, splitter / merger buses and the pixel screen. Run with: npm test
const assert = require('assert');
const D = require('../src/js/gates.js');
const { compile, Sim } = require('../src/js/sim.js');

function plate(name, w = 120, h = 80) { return { format: 1, name, width: w, height: h, nodes: [], wires: [], nextId: 1 }; }
function add(p, type, props) {
  const id = 'n' + p.nextId++;
  p.nodes.push({ id, type, x: 0, y: 0, props: D.fixProps(type, Object.assign(D.defaultProps(type), props || {})) });
  return id;
}
function wire(p, a, apin, b, bpin) { p.wires.push({ id: 'w' + p.nextId++, from: { node: a, pin: apin }, to: { node: b, pin: bpin } }); }
const LIB = { get: () => null };
function start(p) {
  const nl = compile(p, LIB);
  assert.deepStrictEqual(nl.errors, []);
  const sim = new Sim(nl); sim.settle(); return sim;
}

// ---------- tri-state: two drivers share one bus through tunnels ----------
{
  const p = plate('tri');
  const a = add(p, 'INPUT'), b = add(p, 'INPUT'), ea = add(p, 'INPUT'), eb = add(p, 'INPUT');
  const ta = add(p, 'TRI'), tb = add(p, 'TRI');
  const ia = add(p, 'TUNNEL_IN', { name: 'BUS' }), ib = add(p, 'TUNNEL_IN', { name: 'BUS' });
  const rd = add(p, 'TUNNEL_OUT', { name: 'BUS' }), led = add(p, 'OUTPUT');
  wire(p, a, 'q', ta, 'd'); wire(p, ea, 'q', ta, 'en'); wire(p, b, 'q', tb, 'd'); wire(p, eb, 'q', tb, 'en');
  wire(p, ta, 'y', ia, 'd'); wire(p, tb, 'y', ib, 'd'); wire(p, rd, 'q', led, 'd');
  const nl = compile(p, LIB), sim = new Sim(nl);
  const set = (o) => { for (const [k, v] of Object.entries(o)) sim.set(k, v); sim.settle(); };
  set({ [a]: 1, [b]: 0, [ea]: 0, [eb]: 0 });
  assert.strictEqual(sim.isZ(led + '.d'), true, 'nobody drives: floating');
  assert.strictEqual(sim.pin(led + '.d'), 0, 'floating reads 0');
  set({ [ea]: 1 });
  assert.strictEqual(sim.isZ(led + '.d'), false);
  assert.strictEqual(sim.pin(led + '.d'), 1, 'A drives 1');
  set({ [ea]: 0, [eb]: 1 });
  assert.strictEqual(sim.pin(led + '.d'), 0, 'B drives 0');
  set({ [b]: 1 });
  assert.strictEqual(sim.pin(led + '.d'), 1, 'B drives 1');
  assert.strictEqual(sim.conflicts, 0);
  set({ [ea]: 1, [a]: 0 });                 // both drive, different values
  assert.strictEqual(sim.conflicts, 1, 'contention is reported');
  set({ [a]: 1 });                          // both drive 1: fine
  assert.strictEqual(sim.conflicts, 0);
}

// ---------- splitter / merger: 4-bit bus ----------
{
  const p = plate('bus');
  const ins = [0, 1, 2, 3].map(() => add(p, 'INPUT'));
  const m = add(p, 'MERGE', { bits: 4 }), s = add(p, 'SPLIT', { bits: 4 });
  ins.forEach((id, i) => wire(p, id, 'q', m, 'i' + i));
  wire(p, m, 'bus', s, 'bus');
  const outs = [0, 1, 2, 3].map(() => add(p, 'OUTPUT'));
  outs.forEach((id, i) => wire(p, s, 'o' + i, id, 'd'));
  const nl = compile(p, LIB), sim = new Sim(nl);
  for (let v = 0; v < 16; v++) {
    ins.forEach((id, i) => sim.set(id, (v >> i) & 1)); sim.settle();
    outs.forEach((id, i) => assert.strictEqual(sim.pin(id + '.d'), (v >> i) & 1, 'bit ' + i + ' of ' + v));
    assert.strictEqual(sim.bus(m + '.bus', 4), v, 'bus value');
  }
  // width mismatch is an error, not a silent mis-wire
  const q = plate('bad'); const m2 = add(q, 'MERGE', { bits: 4 }), s2 = add(q, 'SPLIT', { bits: 8 });
  wire(q, m2, 'bus', s2, 'bus');
  assert.ok(compile(q, LIB).errors[0].includes('Bus width mismatch'));
}

// ---------- pixel screen (framebuffer) ----------
{
  const p = plate('scr');
  const X = [0, 1, 2].map(() => add(p, 'INPUT')), Y = [0, 1, 2].map(() => add(p, 'INPUT'));
  const mx = add(p, 'MERGE', { bits: 3 }), my = add(p, 'MERGE', { bits: 3 });
  X.forEach((id, i) => wire(p, id, 'q', mx, 'i' + i)); Y.forEach((id, i) => wire(p, id, 'q', my, 'i' + i));
  const d = add(p, 'INPUT'), we = add(p, 'INPUT'), clr = add(p, 'INPUT');
  const scr = add(p, 'SCREEN', { w: 8, h: 8 });
  assert.strictEqual(D.describe(p.nodes.find((n) => n.id === scr), LIB).inputs.find((q) => q.name === 'x').bits, 3);
  wire(p, mx, 'bus', scr, 'x'); wire(p, my, 'bus', scr, 'y');
  wire(p, d, 'q', scr, 'd'); wire(p, we, 'q', scr, 'we'); wire(p, clr, 'q', scr, 'clr');
  const nl = compile(p, LIB), sim = new Sim(nl);
  const setXY = (x, y) => { X.forEach((id, i) => sim.set(id, (x >> i) & 1)); Y.forEach((id, i) => sim.set(id, (y >> i) & 1)); };
  const fb = () => sim.screens.get(scr).fb;
  sim.settle();
  setXY(5, 2); sim.set(d, 1); sim.settle();
  assert.strictEqual(fb()[2 * 8 + 5], 0, 'nothing written before WE');
  sim.set(we, 1); sim.settle();
  assert.strictEqual(fb()[2 * 8 + 5], 1, 'pixel (5,2) written on WE rising edge');
  setXY(1, 1); sim.settle();
  assert.strictEqual(fb()[1 * 8 + 1], 0, 'edge mode: WE held high does not keep drawing');
  sim.set(we, 0); sim.settle(); sim.set(we, 1); sim.settle();
  assert.strictEqual(fb()[1 * 8 + 1], 1);
  assert.strictEqual(fb().reduce((a, b) => a + b, 0), 2);
  sim.set(clr, 1); sim.settle();
  assert.strictEqual(fb().reduce((a, b) => a + b, 0), 0, 'CLR wipes the screen');
  // a rebuilt simulator (Live mode edit) keeps what is on the screen
  sim.set(clr, 0); sim.set(we, 0); sim.settle(); setXY(3, 3); sim.set(we, 1); sim.settle();
  const sim2 = new Sim(compile(p, LIB), sim); sim2.settle();
  assert.strictEqual(sim2.screens.get(scr).fb[3 * 8 + 3], 1, 'screen content survives a recompile');
}

// ---------- big screen + direct screen ----------
{
  const p = plate('big');
  const scr = add(p, 'SCREEN', { w: 1000, h: 1000, color: 'rgb' });
  const g = D.describe(p.nodes[0], LIB);
  assert.strictEqual(g.inputs.find((q) => q.name === 'x').bits, 10);
  assert.strictEqual(g.inputs.find((q) => q.name === 'd').bits, 3);
  assert.strictEqual(new Sim(compile(p, LIB)).screens.get(scr).fb.length, 1000 * 1000);
  assert.strictEqual(D.fixProps('SCREEN', { w: 5000, h: 0 }).w, 1000);

  const q = plate('direct');
  const ids = [0, 1, 2, 3].map(() => add(q, 'INPUT'));
  const ds = add(q, 'SCREEN', { mode: 'direct', w: 2, h: 2 });
  ids.forEach((id, i) => wire(q, id, 'q', ds, 'p' + i));
  const sim = new Sim(compile(q, LIB));
  sim.set(ids[1], 1); sim.set(ids[2], 1); sim.settle();
  assert.deepStrictEqual([...sim.screens.get(ds).fb], [0, 1, 1, 0], 'each pixel has its own pin');
  assert.strictEqual(D.fixProps('SCREEN', { mode: 'direct', w: 99, h: 99 }).w, 16);
}

console.log('All bus, tri-state and screen tests passed.');

// ---------- splitter / merger: highest bit on top (flip) gives the same bits ----------
{
  for (const flip of [false, true]) {
    const p = plate('flip');
    const ins = [0, 1, 2, 3].map(() => add(p, 'INPUT'));
    const m = add(p, 'MERGE', { bits: 4, flip }), s = add(p, 'SPLIT', { bits: 4, flip });
    ins.forEach((id, i) => wire(p, id, 'q', m, 'i' + i));
    wire(p, m, 'bus', s, 'bus');
    const outs = [0, 1, 2, 3].map(() => add(p, 'OUTPUT'));
    outs.forEach((id, i) => wire(p, s, 'o' + i, id, 'd'));
    const sim = new Sim(compile(p, LIB));
    for (let v = 0; v < 16; v++) {
      ins.forEach((id, i) => sim.set(id, (v >> i) & 1)); sim.settle();
      assert.strictEqual(sim.bus(m + '.bus', 4), v, 'flip ' + flip + ' bus value');
      outs.forEach((id, i) => assert.strictEqual(sim.pin(id + '.d'), (v >> i) & 1, 'flip bit'));
    }
  }
  console.log('splitter / merger bit order ok');
}

// ---------- splitter / merger with groups: 8-bit bus -> two 4-bit pins, swapped, merged back ----------
{
  for (const flip of [false, true]) {
    const d = D.describe({ type: 'SPLIT', props: { bits: 8, group: 4, flip } });
    assert.strictEqual(d.outputs.length, 2); assert.ok(d.outputs.every((q) => q.bits === 4));
    const p = plate('grp', 300, 200);
    const src = add(p, 'BUS_IN', { bits: 8, value: 0 }), s = add(p, 'SPLIT', { bits: 8, group: 4, flip }), m = add(p, 'MERGE', { bits: 8, group: 4, flip });
    const out = add(p, 'BUS_OUT', { bits: 8 });
    wire(p, src, D.describe(p.nodes[0]).outputs[0].name, s, 'bus');
    wire(p, s, 'o0', m, 'i1'); wire(p, s, 'o1', m, 'i0');   // swap the two nibbles
    wire(p, m, 'bus', out, D.describe(p.nodes[3]).inputs[0].name);
    const sim = new Sim(compile(p, LIB));
    for (const v of [0, 1, 0x0f, 0xf0, 0xa5, 0x3c, 255]) {
      sim.setBus(src, 8, v); sim.settle();
      assert.strictEqual(sim.bus(s + '.o0', 4), v & 15, 'low nibble pin');
      assert.strictEqual(sim.bus(s + '.o1', 4), v >> 4, 'high nibble pin');
      assert.strictEqual(sim.bus(m + '.bus', 8), ((v & 15) << 4) | (v >> 4), 'swapped nibbles');
    }
  }
  assert.strictEqual(D.fixProps('SPLIT', { bits: 6, group: 4 }).group, 1, 'bad group falls back to 1');
  console.log('splitter / merger groups ok');
}
