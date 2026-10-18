// UI smoke test (drag, double-click, right-click delete, Live mode, bus, screen) in a fake browser.
// Not part of `npm test` because it needs jsdom:  npm i jsdom --no-save && node tests/ui-smoke.js
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'src');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="([^"]+)"><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
w.SVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
w.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return this; } };
w.HTMLCanvasElement.prototype.getContext = function () {
  const c = this; return { createImageData: (a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() { c._puts = (c._puts || 0) + 1; }, clearRect() {} };
};
const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));
const EDITOR_PARTS = ['helpers', 'core', 'lifecycle', 'history', 'geometry', 'render', 'simulation', 'pointer', 'wiring', 'editing', 'selection', 'fill', 'view'].map((m) => 'editor/' + m);
for (const f of ['gates', 'builtins', 'sim', 'storage'].concat(EDITOR_PARTS, ['maplayout', 'mapview', 'app'])) { const sc = w.document.createElement('script'); sc.textContent = fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'); w.document.body.appendChild(sc); }
const $ = (s) => w.document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (el, type, x, y, extra) => el.dispatchEvent(new w.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }, extra)));
const assert = require('assert');
(async () => {
  // new project
  $('[data-act=new-project]').click(); await sleep(20);
  $('.modal input').value = 'Smoke'; $('.modal').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(100);
  const g = w.__gate, ed = g.editor;
  assert.ok(ed.plate, 'plate open');
  ed.addNode('PLATE', 200, 200, { ref: 'MUX 2:1' });
  const mux = ed.plate.nodes.find((n) => n.type === 'PLATE');
  const hit = () => $(`[data-node="${mux.id}"] .node-hit`);
  // ---- drag with left button
  const x0 = mux.x, y0 = mux.y;
  ev(hit(), 'pointerdown', mux.x + 40, mux.y + 20);
  ev(w, 'pointermove', mux.x + 40 + 63, mux.y + 20 + 38);
  ev(w, 'pointerup', mux.x + 103, mux.y + 58);
  assert.strictEqual(mux.x, x0 + 60); assert.strictEqual(mux.y, y0 + 40);
  console.log('drag ok ->', mux.x, mux.y);
  // ---- double-click opens the MUX internals (re-queried each time, as the DOM is rebuilt)
  await sleep(450);
  ev(hit(), 'pointerdown', mux.x + 40, mux.y + 20); ev(w, 'pointerup', 0, 0);
  ev(hit(), 'pointerdown', mux.x + 41, mux.y + 21); ev(w, 'pointerup', 0, 0);
  assert.strictEqual(ed.stack.length, 1, 'entered chip'); assert.ok(ed.plate.builtin);
  console.log('double-click opened:', ed.plate.name, 'with', ed.plate.nodes.length, 'parts');
  ed.exit();
  assert.strictEqual(ed.stack.length, 0);
  // ---- right click -> custom popup -> cancel keeps, confirm deletes
  const n0 = ed.plate.nodes.length;
  ev(hit(), 'contextmenu', 0, 0, { button: 2 }); await sleep(20);
  assert.ok($('#modalRoot .modal'), 'popup shown'); console.log('popup:', $('#modalRoot h3').textContent, '|', $('#modalRoot p').textContent);
  [...w.document.querySelectorAll('#modalRoot button')].find((b) => /Cancel/.test(b.textContent)).click(); await sleep(20);
  assert.strictEqual(ed.plate.nodes.length, n0, 'cancel keeps');
  ev(hit(), 'contextmenu', 0, 0, { button: 2 }); await sleep(20);
  [...w.document.querySelectorAll('#modalRoot button')].find((b) => /Yes, delete/.test(b.textContent)).click(); await sleep(20);
  assert.strictEqual(ed.plate.nodes.length, n0 - 1, 'confirm deletes');
  console.log('right-click delete ok');
  // ---- Live mode
  ed.addNode('INPUT', 100, 100); const inp = ed.plate.nodes.find((n) => n.type === 'INPUT');
  ed.addNode('OUTPUT', 300, 100); const out = ed.plate.nodes.find((n) => n.type === 'OUTPUT');
  ed.connect({ node: inp.id, pin: 'q', dir: 'out' }, { node: out.id, pin: 'd', dir: 'in' }, []);
  $('[data-act=live]').click(); await sleep(20);
  assert.ok(ed.running && ed.auto, 'live on');
  const ih = () => $(`[data-node="${inp.id}"] .node-hit`);
  ev(ih(), 'pointerdown', inp.x + 5, inp.y + 5); ev(w, 'pointerup', inp.x + 5, inp.y + 5);
  assert.strictEqual(ed.sim.pin(out.id + '.d'), 1, 'click toggled switch, LED on');
  // edit while running: add a gate + wire; switch stays 1
  ed.addNode('NOT', 200, 300); const not = ed.plate.nodes.find((n) => n.type === 'NOT');
  ed.connect({ node: inp.id, pin: 'q', dir: 'out' }, { node: not.id, pin: 'i0', dir: 'in' }, []);
  assert.strictEqual(ed.sim.pin(inp.id + '.q'), 1, 'switch state kept after edit');
  assert.strictEqual(ed.sim.pin(not.id + '.y'), 0, 'new NOT gate simulated');
  console.log('live mode ok: toggle + edit while running');
  // drag while live
  const ox = inp.x;
  ev(ih(), 'pointerdown', inp.x + 5, inp.y + 5); ev(w, 'pointermove', inp.x + 5 + 40, inp.y + 5); ev(w, 'pointerup', 0, 0);
  assert.strictEqual(inp.x, ox + 40); assert.strictEqual(ed.sim.pin(out.id + '.d'), 1, 'drag did not toggle');
  // ---- screen + bus while live
  ed.addNode('SCREEN', 500, 100); const scr = ed.plate.nodes.find((n) => n.type === 'SCREEN');
  assert.ok($(`[data-node="${scr.id}"] .px-fo canvas`), 'canvas attached');
  ed.updateProps(scr.id, { w: 1000, h: 1000, color: 'rgb' });
  const c = $(`[data-node="${scr.id}"] .px-fo canvas`); assert.strictEqual(c.width, 1000);
  ed.addNode('SPLIT', 100, 400); ed.addNode('TRI', 300, 400); ed.addNode('MERGE', 400, 400);
  const sp = ed.plate.nodes.find((n) => n.type === 'SPLIT'), mg = ed.plate.nodes.find((n) => n.type === 'MERGE');
  const before = ed.plate.wires.length;
  ed.connect({ node: mg.id, pin: 'bus', dir: 'out' }, { node: sp.id, pin: 'bus', dir: 'in' }, []);
  assert.strictEqual(ed.plate.wires.length, before + 1, 'bus 8 to bus 8 connects');
  assert.ok($('.wire.bus'), 'bus wire is drawn thick');
  ed.connect({ node: mg.id, pin: 'bus', dir: 'out' }, { node: scr.id, pin: 'x', dir: 'in' }, []);
  assert.strictEqual(ed.plate.wires.length, before + 1 + 0, 'X is 10 bits: 8-bit bus refused (replaced nothing)');
  console.log('screen/bus ok');
  // ---- inspector renders for every new part
  for (const n of [scr, sp, mg, not]) { ed.select({ type: 'node', id: n.id }); assert.ok($('#inspector').innerHTML.length > 20); }
  ed.select({ type: 'node', id: scr.id }); assert.ok(/Framebuffer/.test($('#inspector').innerHTML));
  // direct mode
  ed.updateProps(scr.id, { mode: 'direct', w: 4, h: 4 });
  assert.strictEqual(w.document.querySelectorAll(`[data-node="${scr.id}"] .pin-hit`).length, 16);
  // one button: Live starts (button reads Stop, editing stays open), the same button stops
  assert.ok(!$('.toolbar [data-act=run]'), 'no separate Run button');
  assert.ok(ed.running && !ed.editLocked && /Stop/.test($('[data-act=live]').textContent), 'while running: button reads Stop, editing is open');
  assert.ok([...w.document.querySelectorAll('.pal-item')].every((x) => w.getComputedStyle(x).pointerEvents !== 'none'), 'components are not locked while running');
  $('[data-act=live]').click(); await sleep(10); assert.ok(!ed.running && /Live/.test($('[data-act=live]').textContent), 'the same button stops it');
  ed.stop();
  // palette
  const pal = $('#paletteList').textContent; assert.ok(/Tri-state buffer/.test(pal) && /Pixel screen/.test(pal) && /Splitter/.test(pal) && !/Coming soon/.test(pal));
  // ---- Map: every plate has the Map button, it opens, Esc closes it
  assert.ok($('.toolbar [data-act=render-map]') && /Map/.test($('.toolbar [data-act=render-map]').textContent) && !/Render/.test($('.toolbar [data-act=render-map]').textContent), 'Map button on every plate');
  $('[data-act=new-plate]').click(); await sleep(20);
  $('.modal input[name=name]').value = 'gpu'; $('.modal').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(100);
  assert.ok(g.state.plates.has('gpu'));
  g.editor.addNode('PLATE', 200, 100, { ref: 'Full adder' });
  $('.toolbar [data-act=render-map]').click(); await sleep(50);
  assert.ok($('.mapview'), 'map opened'); assert.strictEqual(w.document.querySelectorAll('.mapview g.mg').length, 5, 'the 5 gates of a full adder are drawn');
  assert.strictEqual(w.document.querySelectorAll('.mapview .mc').length, 3, 'full adder + its two half adders are opened');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(20);
  assert.ok(!$('.mapview'), 'Esc closes the map');
  $('[data-act=new-plate]').click(); await sleep(20);
  $('.modal input[name=name]').value = '.bad.'; $('.modal').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(20);
  assert.ok($('.modal-error').textContent.length > 0, 'a name that starts or ends with a dot is refused');
  [...w.document.querySelectorAll('#modalRoot button')].find((b) => /Cancel/.test(b.textContent)).click(); await sleep(20);
  console.log('map ok');

  // ---- Boxes (folders in the Explorer): create, file a plate into it, survives reload from storage, delete keeps the plates
  $('[data-act=new-folder]').click(); await sleep(20);
  $('.modal input[name=name]').value = 'parts'; $('.modal').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(60);
  assert.strictEqual(g.state.folders.length, 1, 'folder created');
  const fid = g.state.folders[0].id;
  assert.ok($('.tree-row.folder'), 'folder row shown');
  g.state.curFolder = null;
  const mv = [...g.state.plates.keys()][0];
  const drag = (el, type, extra) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = { setData() {}, getData() { return ''; }, dropEffect: '', effectAllowed: '' }; el.dispatchEvent(e); return e; };
  drag($(`.tree-row.plate[data-plate="${mv}"]`), 'dragstart');
  drag($(`.tree-row.folder[data-folder="${fid}"]`), 'dragover'); drag($(`.tree-row.folder[data-folder="${fid}"]`), 'drop');
  assert.strictEqual(g.state.placement[mv], fid, 'plate filed into the folder');
  const saved = await w.eval('Store').load(g.state.project.path);
  assert.strictEqual(saved.meta.placement[mv], fid, 'placement saved in the project');
  assert.ok(saved.plates[mv], 'the plate keeps its own file name');
  drag($('.tree-row.plate'), 'dragstart'); 
  const rootRow = $('.tree-row.root'); drag(rootRow, 'dragover'); drag(rootRow, 'drop');
  [...w.document.querySelectorAll('.tree-row.plate')].forEach(() => {});
  g.state.placement[mv] = fid;
  $(`.tree-row.folder[data-folder="${fid}"] [data-act=delete-folder]`).click(); await sleep(20);
  [...w.document.querySelectorAll('#modalRoot button')].find((b) => /Delete box/.test(b.textContent)).click(); await sleep(60);
  assert.strictEqual(g.state.folders.length, 0, 'folder deleted'); assert.ok(g.state.plates.has(mv) && !g.state.placement[mv], 'plates survive and move up');
  console.log('boxes ok');
  // ---- v0.7.1 top bar: no New plate button up there (the Explorer has it), tidy Clock pill, project menu
  assert.ok(!$('.toolbar [data-act=new-plate]'), 'New plate is not in the top toolbar');
  assert.ok($('#explorerActions [data-act=new-plate]'), 'New plate stays in the Explorer');
  assert.ok($('.toolbar .clock #hzInput') && /Clock/.test($('.toolbar .clock').textContent) && /Hz/.test($('.toolbar .clock').textContent), 'Clock is one pill');
  assert.ok(!$('#hzReal'), 'the real speed is no longer squeezed into the top bar');
  assert.ok($('#zoomBar #zoomRead') && $('#zoomBar [data-act=fit]'), 'zoom group');
  const Store_ = w.eval('Store'); let opened = null;
  w.open = (u) => { opened = u; return null; };
  await Store_.create('Other');
  $('#projectChip').click(); await sleep(60);
  assert.ok($('.menu') && $('#projectChip').getAttribute('aria-expanded') === 'true', 'project menu opens');
  const names = [...w.document.querySelectorAll('.menu-item .mi-name')].map((x) => x.textContent);
  assert.ok(names.includes('Smoke') && names.includes('Other') && names.some((n) => /New project/.test(n)), 'menu lists current + other projects + New project');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(20);
  assert.ok(!$('.menu'), 'Esc closes the menu');
  const pick = () => [...w.document.querySelectorAll('.menu-item')].find((b) => /Other/.test(b.textContent));
  // cancel keeps everything
  $('#projectChip').click(); await sleep(60); pick().click(); await sleep(40);
  assert.ok(/Open project/.test($('#modalRoot h3').textContent) && /This window/.test($('#modalRoot').textContent) && /New window/.test($('#modalRoot').textContent), 'asks this window or new window');
  [...w.document.querySelectorAll('#modalRoot button')].find((b) => /Cancel/.test(b.textContent)).click(); await sleep(20);
  assert.strictEqual(g.state.project.name, 'Smoke', 'cancel stays on the current project');
  // new window
  $('#projectChip').click(); await sleep(60); pick().click(); await sleep(40);
  [...w.document.querySelectorAll('#modalRoot button')].find((b) => /New window/.test(b.textContent)).click(); await sleep(40);
  assert.ok(opened && /project=Other/.test(opened), 'New window opens the project in a second window'); assert.strictEqual(g.state.project.name, 'Smoke');
  // this window (unsaved plates are asked about first)
  assert.ok(g.state.dirty.size > 0, 'there are unsaved plates');
  $('#projectChip').click(); await sleep(60); pick().click(); await sleep(40);
  [...w.document.querySelectorAll('#modalRoot button')].find((b) => /This window/.test(b.textContent)).click(); await sleep(40);
  assert.ok(/Unsaved plates/.test($('#modalRoot h3').textContent), 'unsaved plates are asked about before leaving');
  [...w.document.querySelectorAll('#modalRoot button')].find((b) => /Don't save/.test(b.textContent)).click(); await sleep(120);
  assert.strictEqual(g.state.project.name, 'Other', 'This window switches the project');
  assert.strictEqual($('#projectName').textContent, 'Other'); assert.ok(/Other/.test(w.document.title));
  console.log('top bar + project switch ok');
  // ---- "Dev CVAKI" opens the developer's LinkedIn
  opened = null;
  $('.statusbar .credit').click(); await sleep(30);
  assert.ok(opened === 'https://www.linkedin.com/in/cvaki-', 'the credit opens the LinkedIn page');
  console.log('credit link ok');
  assert.deepStrictEqual(errors, []);
  console.log('ALL SMOKE CHECKS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
