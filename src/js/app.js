/* Gate Engine UI: launcher, explorer, tabs, palette, inspector, toolbar. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clampN = (v, a, b, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };

  const ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>',
    saveall: '<path d="M7 3h9l3 3v11H7z"/><path d="M4 7v14h12"/><path d="M10 3v5h5V3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    reset: '<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    plate: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    home: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
    reveal: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5H5V6h5"/>',
    bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
    folderplus: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    map: '<path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  };
  const ic = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ''}</svg>`;

  const state = { project: null, plates: new Map(), dirty: new Set(), tabs: [], active: null, folders: [], placement: {}, closed: new Set(), curFolder: null, drag: null };
  // built-in parts first, so the parts inside built-ins can never be shadowed by a project plate
const lib = { get: (n) => Builtins.get(n) || state.plates.get(n) || null };
  let editor = null;
  let mapView = null;   // the Render map window (plates named *.map)
  let gpu = { ok: false, text: 'Checking GPU…' };
  let realHz = 0;   // the clock speed this PC really reaches (shown in the status bar)

  // ---------- toast + dialog ----------
  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  function dialog({ title, message = '', fields = [], buttons = [{ label: 'OK', value: 'ok', primary: true }], validate }) {
    return new Promise((resolve) => {
      const root = $('#modalRoot');
      const fh = fields.map((f) => `<label class="field"><span>${esc(f.label)}</span><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value == null ? '' : f.value)}"` +
        `${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''} autocomplete="off" spellcheck="false"></label>`).join('');
      const bh = buttons.map((b, i) => `<button type="${b.primary ? 'submit' : 'button'}" class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('');
      root.innerHTML = `<div class="modal-backdrop"><form class="modal" novalidate><h3>${esc(title)}</h3>${message ? `<p>${message}</p>` : ''}${fh}<div class="modal-error"></div><div class="modal-actions">${bh}</div></form></div>`;
      const form = $('form', root), err = $('.modal-error', root);
      const read = () => { const v = {}; form.querySelectorAll('input').forEach((i) => { v[i.name] = i.value; }); return v; };
      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        finish((buttons.find((b) => b.cancel) || buttons[buttons.length - 1]).value);
      };
      const finish = (value) => { const values = read(); document.removeEventListener('keydown', onKey, true); root.innerHTML = ''; resolve({ value, values }); };
      const submit = (b) => {
        if (!b.cancel && validate) { const m = validate(read()); if (m) { err.textContent = m; return; } }
        finish(b.value);
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(buttons.find((b) => b.primary) || buttons[0]); });
      form.querySelectorAll('button[data-i]').forEach((el) => {
        if (el.type === 'button') el.addEventListener('click', () => submit(buttons[+el.dataset.i]));
      });
      document.addEventListener('keydown', onKey, true);
      const first = form.querySelector('input');
      if (first) { first.focus(); first.select(); } else { const p = form.querySelector('.btn.primary'); if (p) p.focus(); }
    });
  }

  // ---------- helpers ----------
  const NAME_RE = /^[A-Za-z0-9_\- ]{1,40}$/;
  // plate names may also hold dots (name a plate "gpu.map" to get the Render map button); no dot at the start or end
  const PLATE_RE = /^[\w-](?:[\w\-. ]{0,38}[\w-])?$/;
  function validateName(name, taken, except) {
    const n = name.trim();
    if (!PLATE_RE.test(n)) return 'Use 1 to 40 letters, numbers, spaces, - _ or . (not at the start or end).';
    for (const k of taken) if (k !== except && k.toLowerCase() === n.toLowerCase()) return 'That name is already used.';
    return null;
  }
  function normalizePlate(p, name) {
    p = p && typeof p === 'object' ? p : {};
    const out = {
      format: 1, name,
      width: clampN(p.width, 10, 500, 80), height: clampN(p.height, 10, 500, 50),
      nodes: Array.isArray(p.nodes) ? p.nodes : [], wires: Array.isArray(p.wires) ? p.wires : [], nextId: 1,
    };
    out.nodes.forEach((n) => { n.props = n.props || {}; });
    let max = 0;
    for (const x of out.nodes.concat(out.wires)) { const m = /^[nw](\d+)$/.exec(x.id || ''); if (m) max = Math.max(max, +m[1]); }
    out.nextId = Math.max(Number(p.nextId) || 1, max + 1);
    return out;
  }
  const newPlateObj = (name, w, h) => normalizePlate({ width: w, height: h }, name);
  function uses(plateName, target, seen = new Set()) {
    if (seen.has(plateName)) return false;
    seen.add(plateName);
    const p = state.plates.get(plateName);
    if (!p) return false;
    for (const n of p.nodes) {
      if (n.type !== 'PLATE') continue;
      const r = n.props && n.props.ref;
      if (r === target || (r && uses(r, target, seen))) return true;
    }
    return false;
  }
  const canUse = (ref) => !!ref && (Builtins.has(ref) || (ref !== state.active && state.plates.has(ref) && !uses(ref, state.active)));
  const takenNames = () => [...state.plates.keys(), ...Builtins.names()];
  const usedBy = (name) => [...state.plates.values()].filter((p) => p.nodes.some((n) => n.type === 'PLATE' && n.props.ref === name)).map((p) => p.name);

  const RECENT_KEY = 'gateengine.recent';
  const getRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
  function pushRecent(info) {
    const list = getRecent().filter((r) => r.path !== info.path);
    list.unshift({ name: info.name, path: info.path, modified: info.modified || Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  }
  function dropRecent(path) { localStorage.setItem(RECENT_KEY, JSON.stringify(getRecent().filter((r) => r.path !== path))); }

  // ---------- launcher ----------
  async function showWelcome() {
    if (editor) editor.clear();
    state.project = null;
    $('#ide').classList.add('hidden');
    $('#welcome').classList.remove('hidden');
    document.title = 'Gate Engine';
    let list = [];
    try { list = await Store.list(); } catch { /* ignore */ }
    const seen = new Set(list.map((p) => p.path));
    for (const r of getRecent()) if (!seen.has(r.path)) list.push(r);
    $('#recentList').innerHTML = list.length
      ? list.map((p) => `<div class="recent-item" data-path="${esc(p.path)}" data-name="${esc(p.name)}" tabindex="0">${ic('folder', 20)}<div><div class="nm">${esc(p.name)}</div><div class="pth">${esc(Store.desktop ? p.path : 'Saved in this browser')}</div></div></div>`).join('')
      : '<div class="recent-empty">No projects yet. Create one to start building.</div>';
  }

  async function newProject() {
    const r = await dialog({
      title: 'New project', message: 'A project holds all your plates in one folder.',
      fields: [{ name: 'name', label: 'Project name', value: 'MyGPU' }],
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Create project', value: 'ok', primary: true }],
      validate: (v) => (NAME_RE.test(v.name.trim()) ? null : 'Use 1 to 40 letters, numbers, spaces, - or _.'),
    });
    if (r.value !== 'ok') return;
    try { openInto(await Store.create(r.values.name.trim())); } catch (e) { toast(e.message, 'error'); }
  }
  async function openProjectDialog() {
    if (!Store.desktop) { toast('Opening a folder works in the desktop app.', 'warn'); return; }
    try { const info = await Store.openDialog(); if (info) openInto(info); } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- boxes (folders): the Explorer's file structure. Only for tidiness; chips still find plates by name ----------
  function loadFolders(meta) {
    const fs = (Array.isArray(meta.folders) ? meta.folders : []).filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({ id: f.id, name: f.name.slice(0, 30), parent: typeof f.parent === 'string' ? f.parent : null }));
    const ids = new Set(fs.map((f) => f.id));
    for (const f of fs) { if (f.parent && !ids.has(f.parent)) f.parent = null; }
    for (const f of fs) { let g = f, n = 0; while (g && g.parent && n++ < 100) g = fs.find((x) => x.id === g.parent); if (n >= 100) f.parent = null; }
    state.folders = fs;
    state.placement = {};
    const pl = meta.placement && typeof meta.placement === 'object' ? meta.placement : {};
    for (const k of Object.keys(pl)) if (state.plates.has(k) && ids.has(pl[k])) state.placement[k] = pl[k];
    state.closed = new Set(); state.curFolder = null;
  }
  const saveFolders = () => { if (state.project) Store.saveMeta(state.project.path, { folders: state.folders, placement: state.placement }).catch((e) => toast(e.message, 'error')); };
  const folderById = (id) => state.folders.find((f) => f.id === id) || null;
  const isInside = (id, anc) => { for (let f = folderById(id), n = 0; f && n < 100; f = folderById(f.parent), n++) if (f.id === anc) return true; return false; };
  function movePlate(name, folderId) {
    if (!state.plates.has(name)) return;
    if (folderId) state.placement[name] = folderId; else delete state.placement[name];
    saveFolders(); renderTree();
  }
  function moveFolder(id, parentId) {
    const f = folderById(id);
    if (!f || id === parentId || (parentId && isInside(parentId, id))) return;
    f.parent = parentId || null;
    saveFolders(); renderTree();
  }
  const folderNameOk = (parent, except) => (v) => {
    const n = v.name.trim();
    if (!n || n.length > 30) return 'Use 1 to 30 characters.';
    if (state.folders.some((f) => f.id !== except && f.parent === (parent || null) && f.name.toLowerCase() === n.toLowerCase())) return 'A box with that name is already here.';
    return null;
  };
  async function newFolder(parentId) {
    parentId = parentId === undefined ? state.curFolder : parentId;
    if (parentId && !folderById(parentId)) parentId = null;
    const r = await dialog({
      title: 'New box', message: parentId ? `Inside "${esc(folderById(parentId).name)}". Boxes only organize the list; chips are not affected.` : 'Boxes only organize the list; chips are not affected. Drag plates into it.',
      fields: [{ name: 'name', label: 'Box name', value: 'parts' }],
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Create box', value: 'ok', primary: true }],
      validate: folderNameOk(parentId),
    });
    if (r.value !== 'ok') return;
    const f = { id: 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), name: r.values.name.trim(), parent: parentId || null };
    state.folders.push(f);
    if (parentId) state.closed.delete(parentId);
    state.curFolder = f.id;
    saveFolders(); renderTree();
  }
  async function renameFolder(id) {
    const f = folderById(id); if (!f) return;
    const r = await dialog({
      title: 'Rename box', fields: [{ name: 'name', label: 'Box name', value: f.name }],
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Rename', value: 'ok', primary: true }],
      validate: folderNameOk(f.parent, id),
    });
    if (r.value !== 'ok') return;
    f.name = r.values.name.trim(); saveFolders(); renderTree();
  }
  async function deleteFolder(id) {
    const f = folderById(id); if (!f) return;
    const r = await dialog({
      title: `Delete box "${f.name}"?`, message: 'Only the box goes. The plates and boxes inside move up one level, nothing else is deleted.',
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Delete box', value: 'ok', primary: true, danger: true }],
    });
    if (r.value !== 'ok') return;
    for (const g of state.folders) if (g.parent === id) g.parent = f.parent;
    for (const k of Object.keys(state.placement)) if (state.placement[k] === id) { if (f.parent) state.placement[k] = f.parent; else delete state.placement[k]; }
    state.folders = state.folders.filter((g) => g.id !== id);
    if (state.curFolder === id) state.curFolder = f.parent;
    saveFolders(); renderTree();
  }

  async function openProject(info, preloaded) {
    try {
      const data = preloaded || await Store.load(info.path);
      state.project = { name: info.name, path: info.path };
      state.plates = new Map(Object.keys(data.plates).sort().map((k) => [k, normalizePlate(data.plates[k], k)]));
      state.dirty.clear(); state.tabs = []; state.active = null;
      loadFolders(data.meta || {});
      if (!state.plates.size) {
        const p = newPlateObj("main", 80, 50);
        state.plates.set('main', p);
        await Store.savePlate(info.path, 'main', p);
      }
      pushRecent(info);
      $('#welcome').classList.add('hidden');
      $('#ide').classList.remove('hidden');
      $('#projectName').textContent = info.name;
      $('#projectChip').title = `${info.name}${Store.desktop ? '\n' + info.path : ''}\nSwitch project`;
      document.title = `${info.name} \u2013 Gate Engine`;
      const meta = data.meta || {};
      openPlate(state.plates.has(meta.main) ? meta.main : (state.plates.has('main') ? 'main' : [...state.plates.keys()][0]));
    } catch (e) {
      dropRecent(info.path);
      toast(e.message, 'error');
      showWelcome();
    }
  }

  // ---------- plates ----------
  function openPlate(name) {
    if (!state.plates.has(name)) return;
    if (mapView) mapView.close();
    if (!state.tabs.includes(name)) state.tabs.push(name);
    state.active = name;
    editor.load(state.plates.get(name), lib);
    renderAll();
  }
  function showNoPlate() { state.active = null; editor.clear(); renderAll(); }

  async function savePlate(name, quiet) {
    const p = state.plates.get(name);
    if (!p) return;
    try { await Store.savePlate(state.project.path, name, p); state.dirty.delete(name); renderChrome(); if (!quiet) toast(`Saved ${name}`); }
    catch (e) { toast(`Could not save ${name}: ${e.message}`, 'error'); }
  }
  async function saveAll() {
    const names = [...state.dirty];
    for (const n of names) await savePlate(n, true);
    toast(names.length ? `Saved ${names.length} plate${names.length > 1 ? 's' : ''}` : 'Nothing to save');
  }

  async function newPlate() {
    const r = await dialog({
      title: 'New plate', message: 'A plate is the board you build a circuit on. Size is in grid units (1 unit = 10 px).',
      fields: [{ name: 'name', label: 'Plate name', value: 'alu' }, { name: 'w', label: 'Width (units)', type: "number", value: 80, min: 10, max: 500 }, { name: 'h', label: 'Height (units)', type: "number", value: 50, min: 10, max: 500 }],
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Create plate', value: 'ok', primary: true }],
      validate: (v) => validateName(v.name, takenNames()),
    });
    if (r.value !== 'ok') return;
    const name = r.values.name.trim();
    const p = newPlateObj(name, clampN(r.values.w, 10, 500, 80), clampN(r.values.h, 10, 500, 50));
    state.plates.set(name, p);
    if (state.curFolder && folderById(state.curFolder)) { state.placement[name] = state.curFolder; saveFolders(); }
    await savePlate(name, true);
    openPlate(name);
  }
  async function duplicatePlate(name) {
    const r = await dialog({
      title: 'Save plate as', fields: [{ name: 'name', label: 'New plate name', value: name + ' copy' }],
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Save copy', value: 'ok', primary: true }],
      validate: (v) => validateName(v.name, takenNames()),
    });
    if (r.value !== 'ok') return;
    const copy = normalizePlate(JSON.parse(JSON.stringify(state.plates.get(name))), r.values.name.trim());
    state.plates.set(copy.name, copy);
    if (state.placement[name]) { state.placement[copy.name] = state.placement[name]; saveFolders(); }
    await savePlate(copy.name, true);
    openPlate(copy.name);
  }
  async function renamePlate(name) {
    const r = await dialog({
      title: 'Rename plate', message: 'Every plate that uses it is updated too.',
      fields: [{ name: 'name', label: 'Plate name', value: name }],
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Rename', value: 'ok', primary: true }],
      validate: (v) => validateName(v.name, takenNames(), name),
    });
    if (r.value !== 'ok') return;
    const to = r.values.name.trim();
    if (to === name) return;
    try { await Store.renamePlate(state.project.path, name, to); } catch (e) { toast(e.message, 'error'); return; }
    const entries = [...state.plates.entries()].map(([k, v]) => (k === name ? [to, v] : [k, v]));
    state.plates = new Map(entries);
    const p = state.plates.get(to); p.name = to;
    if (state.placement[name]) { state.placement[to] = state.placement[name]; delete state.placement[name]; saveFolders(); }
    const touched = new Set([to]);
    for (const q of state.plates.values()) for (const n of q.nodes) if (n.type === 'PLATE' && n.props.ref === name) { n.props.ref = to; touched.add(q.name); }
    state.tabs = state.tabs.map((t) => (t === name ? to : t));
    if (state.active === name) state.active = to;
    if (state.dirty.delete(name)) state.dirty.add(to);
    for (const t of touched) await savePlate(t, true);
    if (state.active) editor.load(state.plates.get(state.active), lib);
    renderAll();
  }
  async function deletePlate(name) {
    const users = usedBy(name).filter((n) => n !== name);
    const r = await dialog({
      title: `Delete "${name}"?`,
      message: users.length ? `It is used inside: ${esc(users.join(', '))}. Those parts will show as missing.` : 'This removes the plate file from the project.',
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Delete plate', value: 'ok', primary: true, danger: true }],
    });
    if (r.value !== 'ok') return;
    try { await Store.deletePlate(state.project.path, name); } catch (e) { toast(e.message, 'error'); return; }
    state.plates.delete(name); state.dirty.delete(name);
    if (state.placement[name]) { delete state.placement[name]; saveFolders(); }
    const i = state.tabs.indexOf(name);
    if (i >= 0) state.tabs.splice(i, 1);
    if (state.active === name) {
      const next = state.tabs[Math.min(i, state.tabs.length - 1)] || [...state.plates.keys()][0];
      if (next) openPlate(next); else showNoPlate();
    } else renderAll();
  }
  async function closeTab(name) {
    if (state.dirty.has(name)) {
      const r = await dialog({
        title: `Save changes to "${name}"?`,
        buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
      });
      if (r.value === 'cancel') return;
      if (r.value === 'save') await savePlate(name, true);
      else {
        try { const d = await Store.load(state.project.path); if (d.plates[name]) state.plates.set(name, normalizePlate(d.plates[name], name)); } catch { /* keep memory copy */ }
        state.dirty.delete(name);
      }
    }
    const i = state.tabs.indexOf(name);
    state.tabs.splice(i, 1);
    if (state.active === name) {
      const next = state.tabs[Math.min(i, state.tabs.length - 1)];
      if (next) openPlate(next); else showNoPlate();
    } else renderAll();
  }
  // false = the user cancelled; true = nothing unsaved is left (saved or thrown away on purpose)
  async function confirmLeave() {
    if (state.dirty.size) {
      const r = await dialog({
        title: 'Unsaved plates', message: `${state.dirty.size} plate(s) have unsaved changes.`,
        buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save all', value: 'save', primary: true }],
      });
      if (r.value === 'cancel') return false;
      if (r.value === 'save') await saveAll();
    }
    state.dirty.clear();
    return true;
  }
  async function goHome() {
    if (!(await confirmLeave())) return;
    showWelcome();
  }

  // ---------- switching projects: like an IDE, ask "this window" or "new window" ----------
  const samePath = (a, b) => String(a).replace(/[\\/]+$/, '').toLowerCase() === String(b).replace(/[\\/]+$/, '').toLowerCase();
  async function openInto(info) {
    if (!state.project) return openProject(info);              // launcher: nothing to ask
    if (samePath(info.path, state.project.path)) { toast('That project is already open.'); return; }
    let data;
    try { data = await Store.load(info.path); }                 // check it first, so a broken project never replaces the one you are in
    catch (e) { dropRecent(info.path); toast(e.message, 'error'); return; }
    const r = await dialog({
      title: 'Open project', message: `Open <b>${esc(info.name)}</b> in:`,
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'New window', value: 'new' }, { label: 'This window', value: 'this', primary: true }],
    });
    if (r.value === 'new') {
      try { pushRecent(info); await Store.newWindow(info); } catch (e) { toast(e.message, 'error'); }
    } else if (r.value === 'this') {
      if (!(await confirmLeave())) return;
      openProject(info, data);
    }
  }

  // ---------- small popup menu (project switcher) ----------
  let menuState = null;
  function closeMenu() {
    if (!menuState) return;
    document.removeEventListener('keydown', menuState.onKey, true);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('resize', closeMenu);
    menuState.anchor.setAttribute('aria-expanded', 'false');
    $('#menuRoot').innerHTML = '';
    menuState = null;
  }
  function showMenu(anchor, items) {
    closeMenu();
    const root = $('#menuRoot');
    root.innerHTML = '<div class="menu-backdrop"></div><div class="menu" role="menu">' + items.map((it, i) =>
      it.sep ? '<div class="menu-sep"></div>'
        : it.head ? `<div class="menu-head">${esc(it.head)}</div>`
        : `<button type="button" role="menuitem" class="menu-item ${it.cur ? 'cur' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? ic(it.icon, 16) : '<span class="ic-sp"></span>'}` +
          `<span class="mi-text"><span class="mi-name">${esc(it.label)}</span>${it.sub ? `<span class="mi-sub">${esc(it.sub)}</span>` : ''}</span>${it.cur ? ic('check', 14) : ''}</button>`).join('') + '</div>';
    const menu = $('.menu', root), r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    const btns = () => [...menu.querySelectorAll('.menu-item:not([disabled])')];
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const b = btns(), i = b.indexOf(document.activeElement);
        b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus();
      }
    };
    menuState = { anchor, onKey };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    root.querySelector('.menu-backdrop').addEventListener('click', closeMenu);
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('.menu-item');
      if (!b || b.disabled) return;
      const it = items[+b.dataset.i];
      closeMenu();
      if (it && it.run) it.run();
    });
    const first = btns()[0]; if (first) first.focus();
  }

  async function projectMenu(anchor) {
    if (menuState && menuState.anchor === anchor) { closeMenu(); return; }
    const cur = state.project;
    if (!cur) return;
    let list = [];
    try { list = await Store.list(); } catch { /* ignore */ }
    const seen = new Set(), others = [];
    for (const p of getRecent().concat(list)) {            // most recently opened first, then the rest of the projects folder
      if (!p || !p.path || seen.has(p.path.toLowerCase()) || samePath(p.path, cur.path)) continue;
      seen.add(p.path.toLowerCase()); others.push(p);
    }
    const items = [
      { head: 'Current project' },
      { label: cur.name, sub: Store.desktop ? cur.path : 'Saved in this browser', icon: 'folder', cur: true, disabled: true },
      { sep: true }, { head: 'Open another project' },
      ...(others.length
        ? others.slice(0, 8).map((p) => ({ label: p.name, sub: Store.desktop ? p.path : 'Saved in this browser', icon: 'folder', run: () => openInto({ name: p.name, path: p.path }) }))
        : [{ label: 'No other projects yet', disabled: true }]),
      { sep: true },
      { label: 'New project\u2026', icon: 'folderplus', run: () => newProject() },
      ...(Store.desktop ? [{ label: 'Open project\u2026', icon: 'folder', run: () => openProjectDialog() }] : []),
      { sep: true },
      ...(Store.desktop ? [{ label: 'Show in folder', icon: 'reveal', run: () => Store.reveal(cur.path) }] : []),
      { label: 'New window', icon: 'window', run: () => Store.newWindow(null).catch((e) => toast(e.message, 'error')) },
      { label: 'Back to projects', icon: 'home', run: () => goHome() },
    ];
    showMenu(anchor, items);
  }

  async function copyBuiltin(src) {
    if (!src) return;
    const base = src.name.replace(/[^A-Za-z0-9_\- ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'part';
    const r = await dialog({
      title: 'Copy to project', message: 'Makes an editable copy of this built-in part in your project.',
      fields: [{ name: 'name', label: 'Plate name', value: base + ' copy' }],
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Create copy', value: 'ok', primary: true }],
      validate: (v) => validateName(v.name, takenNames()),
    });
    if (r.value !== 'ok') return;
    const copy = normalizePlate(JSON.parse(JSON.stringify(src)), r.values.name.trim());
    state.plates.set(copy.name, copy);
    await savePlate(copy.name, true);
    openPlate(copy.name);
  }

  // ---------- rendering ----------
  function renderAll() { renderChrome(); renderPalette(); renderInspector(); }
  function renderChrome() { renderTree(); renderTabs(); updateToolbar(); renderStatus(); }

  function renderTree() {
    $('#explorerActions').innerHTML =
      `<button class="icon-btn" data-act="new-plate" title="New plate${state.curFolder ? ' (in the selected box)' : ''}">${ic('plus')}</button>` +
      `<button class="icon-btn" data-act="new-folder" title="New box${state.curFolder ? ' (inside the selected box)' : ''}">${ic('folderplus')}</button>` +
      `<button class="icon-btn" data-act="reveal" title="Show project folder">${ic('reveal')}</button>` +
      `<button class="icon-btn" data-act="home" title="Back to projects">${ic('home')}</button>`;
    if (!state.project) { $('#tree').innerHTML = ''; return; }
    const kidsOf = (id) => state.folders.filter((f) => (f.parent || null) === id).sort((a, b) => a.name.localeCompare(b.name));
    const count = (id) => { let n = Object.keys(state.placement).filter((k) => state.placement[k] === id).length; for (const f of kidsOf(id)) n += count(f.id); return n; };
    const plateRow = (name, d) => `<div class="tree-row plate ${name === state.active ? 'active' : ''}" draggable="true" data-plate="${esc(name)}" style="--d:${d}" title="Drag onto a plate to use it as a chip, or onto a box to file it">${ic('plate')}<span class="nm">${esc(GateDefs.showName(name))}</span>` +
      `${state.dirty.has(name) ? '<span class="dirty-dot" title="Unsaved"></span>' : ''}` +
      `<span class="row-actions"><button class="icon-btn" data-act="render-map" data-plate="${esc(name)}" title="Map: open every chip down to its gates">${ic('map', 14)}</button><button class="icon-btn" data-act="rename" data-plate="${esc(name)}" title="Rename">${ic('edit', 14)}</button>` +
      `<button class="icon-btn" data-act="duplicate" data-plate="${esc(name)}" title="Save as copy">${ic('copy', 14)}</button>` +
      `<button class="icon-btn" data-act="delete-plate" data-plate="${esc(name)}" title="Delete">${ic('trash', 14)}</button></span></div>`;
    const walk = (parent, d) => {
      let h = '';
      for (const f of kidsOf(parent)) {
        const open = !state.closed.has(f.id);
        h += `<div class="tree-row folder ${state.curFolder === f.id ? 'cur' : ''}" draggable="true" data-folder="${f.id}" style="--d:${d}"><span class="chev ${open ? 'open' : ''}">${ic('chev', 12)}</span>${ic('folder')}<span class="nm">${esc(f.name)}</span><span class="cnt">${count(f.id) || ''}</span>` +
          `<span class="row-actions"><button class="icon-btn" data-act="new-folder" data-folder="${f.id}" title="New box inside">${ic('folderplus', 14)}</button><button class="icon-btn" data-act="rename-folder" data-folder="${f.id}" title="Rename box">${ic('edit', 14)}</button>` +
          `<button class="icon-btn" data-act="delete-folder" data-folder="${f.id}" title="Delete box (plates move up)">${ic('trash', 14)}</button></span></div>`;
        if (open) h += walk(f.id, d + 1);
      }
      for (const name of state.plates.keys()) if ((state.placement[name] || null) === parent) h += plateRow(name, d);
      return h;
    };
    let h = `<div class="tree-row root ${state.curFolder ? '' : 'cur'}">${ic('folder')}<span class="nm">${esc(state.project.name)}</span></div>`;
    h += walk(null, 0);
    h += '<p class="tree-hint">Drag a plate onto another plate to use it as a chip. Drag plates into boxes to organize them. Double-click a chip to open it.</p>';
    $('#tree').innerHTML = h;
  }

  function renderTabs() {
    $('#tabs').innerHTML = state.tabs.map((t) =>
      `<div class="tab ${t === state.active ? 'active' : ''}" data-plate="${esc(t)}">${esc(GateDefs.showName(t))}${state.dirty.has(t) ? '<span class="dirty-dot"></span>' : ''}` +
      `<button class="icon-btn" data-act="close-tab" data-plate="${esc(t)}" title="Close">${ic('close', 12)}</button></div>`).join('');
    $('#emptyState').classList.toggle('hidden', !!state.active);
  }

  function updateToolbar() {
    const has = !!(editor && editor.plate), run = !!(editor && editor.running), ro = !!(editor && editor.editLocked);
    const ib = (act, icon, title, dis, cls = '') => `<button class="icon-btn ${cls}" data-act="${act}" title="${title}" ${dis ? 'disabled' : ''}>${ic(icon)}</button>`;
    const lb = (t) => `<span class="lbl">${t}</span>`;     // the text of a button; it disappears first when the window gets narrow
    $('#toolbar').innerHTML =
      ib('save', 'save', 'Save plate (Ctrl+S)', !has || !state.dirty.has(state.active)) +
      ib('save-all', 'saveall', 'Save all (Ctrl+Shift+S)', !state.dirty.size, 'opt') +
      '<span class="sep"></span>' +
      ib('undo', 'undo', 'Undo (Ctrl+Z)', !has || ro || !editor.canUndo()) +
      ib('redo', 'redo', 'Redo (Ctrl+Y)', !has || ro || !editor.canRedo()) +
      '<span class="sep"></span>' +
      `<button class="btn live ${run ? 'on' : ''}" data-act="live" ${has ? '' : 'disabled'} title="${run ? 'Stop the simulation (F6)' : 'Live: start the simulation. You can keep editing, adding parts and clicking switches while it runs. (F6)'}">${ic(run ? 'stop' : 'bolt')}${lb(run ? 'Stop' : 'Live')}</button>` +
      (state.active ? `<button class="btn map ${mapView && mapView.isOpen ? 'on' : ''}" data-act="render-map" title="Map: open every chip down to its gates and follow the signal">${ic('map')}${lb('Map')}</button>` : '') +
      ib('reset', 'reset', 'Restart simulation (clears flip-flops and screens)', !run, 'opt') +
      '<span class="sep"></span>' +
      `<label class="clock" title="Clock speed. Any value you like; 0 = MAX (as fast as this PC can go). The speed you really get is shown in the status bar."><span class="clock-l">Clock</span><input type="number" id="hzInput" min="0" step="any" value="${editor ? editor.hz : 1}" aria-label="Clock speed in Hz"><span class="clock-u">Hz</span></label>`;
    $('#zoomBar').innerHTML =
      ib('zoom-out', 'minus', 'Zoom out', !has) + `<span class="zoom-read" id="zoomRead">${Math.round((editor ? editor.zoom : 1) * 100)}%</span>` +
      ib('zoom-in', 'plus', 'Zoom in', !has) + ib('fit', 'fit', 'Fit plate to window', !has, 'opt2');
  }

  const fmtHz = (hz) => (hz >= 1e6 ? (hz / 1e6).toFixed(2) + ' MHz' : hz >= 1e3 ? (hz / 1e3).toFixed(1) + ' kHz' : hz.toFixed(hz < 10 ? 1 : 0) + ' Hz');
  function paintHz() {
    const el = $('#stHz'); if (!el) return;
    const on = !!(editor && editor.running && realHz);
    el.classList.toggle('hidden', !on);
    el.textContent = on ? `Real speed ${fmtHz(realHz)}` : '';
  }

  function renderStatus() {
    const p = editor && editor.plate;
    $('#stProject').textContent = state.project ? state.project.name : '';
    $('#stPlate').textContent = p ? `${GateDefs.showName(p.name)}  ${p.width}×${p.height} units  ${p.nodes.length} parts  ${p.wires.length} wires` : 'No plate open';
    const run = editor && editor.running;
    const m = $('#stMode');
    m.textContent = run ? `Simulating  ${editor.sim.nl.gates.length} gates` : 'Editing';
    m.classList.toggle('run', !!run);
    if (!run) realHz = 0;
    paintHz();
    $('#stZoom').textContent = Math.round((editor ? editor.zoom : 1) * 100) + '%';
  }

  function renderPalette() {
    const q = $('#paletteSearch').value.trim().toLowerCase();
    const match = (s) => !q || s.toLowerCase().includes(q);
    const item = (type, ref, name) => `<div class="pal-item" draggable="true" data-type="${type}" ${ref ? `data-ref="${esc(ref)}"` : ''} title="Drag onto the plate, or double-click to add">${GateDefs.iconSVG(type, ref, lib)}<span>${esc(GateDefs.showName(name))}</span></div>`;
    let h = '';
    for (const g of GateDefs.GROUPS) {
      const items = g.items.filter((t) => match(GateDefs.NAMES[t]));
      if (items.length) h += `<div class="pal-group"><h4>${g.name}</h4><div class="pal-grid">${items.map((t) => item(t, null, GateDefs.NAMES[t])).join('')}</div></div>`;
    }
    const mine = state.active ? [...state.plates.keys()].filter((n) => canUse(n) && match(n)) : [];
    h += `<div class="pal-group"><h4>Your plates</h4>` + (mine.length
      ? `<div class="pal-grid">${mine.map((n) => item('PLATE', n, n)).join('')}</div>`
      : '<div class="pal-empty">Plates you save in this project appear here, ready to reuse.</div>') + '</div>';
    for (const g of Builtins.groups()) {
      const items = g.items.filter(match);
      if (items.length) h += `<details class="pal-group builtin" ${q ? 'open' : ''}><summary>${esc(g.name)}<span class="pal-tag">built-in</span></summary><div class="pal-grid">${items.map((n) => item('PLATE', n, n)).join('')}</div></details>`;
    }
    const planned = GateDefs.PLANNED.filter(match);
    if (planned.length) h += `<details class="pal-group"><summary>Coming soon</summary><div class="planned">${planned.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div></details>`;
    $('#paletteList').innerHTML = h;
  }

  function renderInspector() {
    const el = $('#inspector');
    if (!editor || !editor.plate) { el.innerHTML = ''; return; }
    if (editor.running && !editor.auto) {
      el.innerHTML = '<h4>Simulation</h4><p class="hint">Click an input switch or button to change it. Wires glow cyan when high. Double-click a chip to see its gates live. Stop to edit.</p>';
      return;
    }
    if (editor.readonly) {
      el.innerHTML = `<h4>Inside: ${esc(GateDefs.showName(editor.plate.name))}</h4><p class="hint">Read-only. Double-click a chip to go deeper, press Esc or use the breadcrumb to go back.</p>`;
      return;
    }
    const p = editor.plate, sel = editor.sel;
    let h = '';
    if (editor.multi.size > 1) {
      el.innerHTML = `<h4>${editor.multi.size} parts selected</h4><p class="hint">Move: drag inside the dashed box (or any picked part), or use the arrow buttons / arrow keys (Shift = 5 steps). Shift or Ctrl + click adds or removes a part. Ctrl + drag on empty plate draws a box. Ctrl+D copies the group, Delete removes it, Esc clears.</p><div class="move-pad"><span></span><button class="btn" data-act="nudge-up" title="Move up (arrow key)">↑</button><span></span><button class="btn" data-act="nudge-left" title="Move left (arrow key)">←</button><button class="btn" data-act="nudge-down" title="Move down (arrow key)">↓</button><button class="btn" data-act="nudge-right" title="Move right (arrow key)">→</button></div><div class="btns"><button class="btn" data-act="dup-group">Copy group</button><button class="btn danger" data-act="delete-sel">Delete group</button></div>`;
      return;
    }
    const n = sel && sel.type === 'node' ? p.nodes.find((x) => x.id === sel.id) : null;
    if (n) {
      h += `<h4>${esc(GateDefs.NAMES[n.type] || n.type)}</h4>`;
      if (n.props.label !== undefined) h += `<div class="row"><span>Label</span><input type="text" maxlength="${n.type === 'LABEL' ? 40 : 16}" data-prop="label" value="${esc(n.props.label)}"></div>`;
      if (['INPUT', 'OUTPUT', 'BUS_IN', 'BUS_OUT'].includes(n.type)) h += `<p class="hint">Give it a name (Enter to keep it, or double-click the part to rename). When this plate is used as a chip, ${n.type.endsWith('IN') || n.type === 'INPUT' ? 'this becomes the name of an input pin' : 'this becomes the name of an output pin'}. Pins are listed top to bottom by where the parts sit.</p>`;
      if (n.props.name !== undefined) h += `<div class="row"><span>Name</span><input type="text" maxlength="6" data-prop="name" value="${esc(n.props.name)}"></div><p class="hint">Tunnels with the same name on one plate are connected.</p>`;
      if (GateDefs.MULTI.includes(n.type)) h += `<div class="row"><span>Inputs</span><select data-prop="inputs">${[2, 3, 4, 5, 6, 7, 8].map((k) => `<option ${k === (n.props.inputs || 2) ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`;
      if (n.type === 'SPLIT' || n.type === 'MERGE') h += `<div class="row"><span>Width</span><select data-prop="bits" data-num="1">${[2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24, 32, 40, 46, 48, 56, 64].map((k) => `<option ${k === n.props.bits ? 'selected' : ''}>${k}</option>`).join('')}</select></div><div class="row"><span>Pins</span><select data-prop="group" data-num="1">${[1, 2, 3, 4, 6, 8, 16].filter((k) => n.props.bits % k === 0 && k < n.props.bits).map((k) => `<option value="${k}" ${k === n.props.group ? 'selected' : ''}>${k === 1 ? '1 bit each' : k + '-bit each (' + (n.props.bits / k) + ' pins)'}</option>`).join('')}</select></div><div class="row"><span>Order</span><select data-prop="flip" data-num="1"><option value="1" ${n.props.flip ? 'selected' : ''}>Top = 0 = highest bit</option><option value="0" ${n.props.flip ? '' : 'selected'}>Top = lowest bit (old style)</option></select></div><p class="hint">${n.type === 'SPLIT' ? 'One thick bus wire in, one wire per bit out.' : 'One wire per bit in, one thick bus wire out.'} Bus wires only connect to bus pins of the same width.</p>`;
      if (n.type === 'BUS_IN' || n.type === 'BUS_OUT') h += busInspector(n);
      if (n.type === 'TRI') h += '<p class="hint">Drives its output only while EN is 1; otherwise the output floats (grey wire). To share a bus, send several tri-state outputs into Tunnel in parts with the same name, and read it with a Tunnel out.</p>';
      if (n.type === 'SCREEN') h += screenInspector(n);
      if (n.type === 'MEM') h += memInspector(n);
      if (n.type === 'PLATE') h += `<div class="row"><span>${Builtins.has(n.props.ref) ? 'Built-in' : 'Plate'}</span><b>${esc(GateDefs.showName(n.props.ref))}</b></div><div class="btns"><button class="btn" data-act="open-ref">${Builtins.has(n.props.ref) ? 'Look inside' : 'Open plate'}</button></div>`;
      if (n.type !== 'LABEL') h += stackInspector();
      h += '<div class="btns"><button class="btn danger" data-act="delete-sel">Delete</button></div>';
    } else if (sel && sel.type === 'wire') {
      h += '<h4>Wire</h4><div class="btns"><button class="btn danger" data-act="delete-sel">Delete wire</button></div>';
    } else {
      h += `<h4>Plate: ${esc(GateDefs.showName(p.name))}</h4><div class="two"><label class="field"><span>Width</span><input type="number" data-size="w" min="10" max="500" value="${p.width}"></label><label class="field"><span>Height</span><input type="number" data-size="h" min="10" max="500" value="${p.height}"></label></div>` +
        '<p class="hint">Sizes are in grid units. A plate cannot shrink below its parts. Input and Output parts become the pins when you reuse this plate.</p>';
    }
    el.innerHTML = h;
  }

  // Bit input / Bit output: width, number format, start value
  function busInspector(n) {
    const p = GateDefs.fixProps(n.type, n.props), isIn = n.type === 'BUS_IN';
    let h = `<div class="row"><span>Width</span><select data-prop="bits" data-num="1">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 20, 24, 32, 40, 46, 48, 56, 64].map((k) => `<option ${k === p.bits ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`;
    h += `<div class="row"><span>Show as</span><select data-prop="fmt">${[['dec', 'Decimal'], ['hex', 'Hex'], ['bin', 'Binary'], ['signed', 'Signed']].map(([v, t]) => `<option value="${v}" ${p.fmt === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    if (isIn) h += `<div class="row"><span>Value</span><input type="text" data-prop="value" data-big="1" value="${esc(String(p.value))}" title="decimal or 0x hex, up to ${p.bits} bits"></div>`;
    h += `<p class="hint">${isIn ? 'One cell per bit, the top-left cell is the highest bit. Click a cell while the circuit runs to flip that bit. ' : 'One light per bit, the top-left light is the highest bit. '}It leaves as one thick ${p.bits}-bit bus wire. On a plate you reuse as a chip it becomes a ${p.bits}-bit bus pin${isIn ? '' : ' too'}.</p>`;
    return h;
  }
  function memInspector(n) {
    const m = GateDefs.fixProps('MEM', n.props), D = GateDefs;
    const sel = (prop, list, cur) => `<select data-prop="${prop}">${list.map(([v, t]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const bitsList = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24, 28, 32, 36, 40, 43, 44, 45, 46, 48, 56, 64].map((k) => [k, k]);
    let h = `<div class="row"><span>Kind</span>${sel('mode', [['ram', 'RAM (read and write)'], ['rom', 'ROM (read only)']], m.mode)}</div>`;
    h += `<div class="row"><span>Address bits</span><select data-prop="abits" data-num="1">${bitsList.map(([k]) => `<option ${k === m.abits ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`;
    h += `<div class="row"><span>Data bits</span><select data-prop="dbits" data-num="1">${bitsList.map(([k]) => `<option ${k === m.dbits ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`;
    if (m.mode === 'ram') h += `<div class="row"><span>Write</span>${sel('write', [['edge', 'When WE rises'], ['level', 'While WE is 1']], m.write)}</div>`;
    h += `<p class="hint">Size: <b>${D.capacityText(m.abits, m.dbits)}</b> (2^${m.abits} words of ${m.dbits} bits). Only words that were written use real memory, so even 64 TiB (46 address bits, 8 data bits) costs nothing until used. Unwritten words read 0. Pins: A (address), D (data in), WE (write), Q (data out, follows A all the time). Start contents live in the plate file under <code>props.init</code> as [address, value] pairs.</p>`;
    return h;
  }
  // Stack: copies of the selected part in a column or a row (same as dragging the little square at its corner)
  let stackCount = 8;
  function stackInspector() {
    return `<div class="row"><span>Stack</span><input type="number" id="stackN" data-stack="1" min="2" max="64" value="${stackCount}"></div>` +
      '<div class="btns"><button class="btn" data-act="stack-down">Column ↓</button><button class="btn" data-act="stack-right">Row →</button></div>' +
      '<p class="hint">Makes that many parts in all. Or drag the little square at the part\'s corner down or right, like the fill handle in Excel. Labels count up (IN1, IN2, ...). Ctrl+D copies once.</p>';
  }

  function screenInspector(n) {
    const p = GateDefs.fixProps('SCREEN', n.props), g = GateDefs.screenGeom(p);
    const sel = (prop, opts) => `<select data-prop="${prop}">${opts.map(([v, t]) => `<option value="${v}" ${p[prop] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const num = (prop, lo, hi) => `<input type="number" data-prop="${prop}" data-num="1" min="${lo}" max="${hi}" value="${p[prop]}">`;
    const max = p.mode === 'direct' ? 16 : 1000;
    let h = `<div class="row"><span>Mode</span>${sel('mode', [['addr', 'Framebuffer (X, Y, colour)'], ['direct', 'Direct (a pin per pixel)']])}</div>`;
    h += `<div class="two"><label class="field"><span>Width (px)</span>${num('w', 1, max)}</label><label class="field"><span>Height (px)</span>${num('h', 1, max)}</label></div>`;
    if (p.mode === 'addr') {
      h += `<div class="row"><span>Colour</span>${sel('color', [['mono', 'On / off (1 bit)'], ['rgb', 'RGB (3 bits)']])}</div>`;
      h += `<div class="row"><span>Write</span>${sel('write', [['edge', 'When WE rises'], ['level', 'While WE is 1']])}</div>`;
      h += `<div class="row"><span>View size</span>${num('view', 60, 400)}</div>`;
      h += `<p class="hint">${p.w}×${p.h} = ${(p.w * p.h).toLocaleString()} pixels. Pins: X (${g.xb} bits), Y (${g.yb} bits), ${g.cb > 1 ? 'RGB (3 bits: R, G, B)' : 'D (the pixel colour)'}, WE (write), CLR (wipe). Build X and Y with a Merger. Pixels outside the size are ignored.</p>`;
    } else {
      h += `<p class="hint">${p.w * p.h} pixels, each with its own pin on the pixel itself. Wire a signal to a pixel and it lights up. Up to 16×16.</p>`;
    }
    return h;
  }

  // ---------- actions ----------
  const KEEP_MAP = ['project-menu', 'render-map', 'save', 'save-all', 'reveal', 'zoom-in', 'zoom-out', 'fit', 'run', 'live', 'reset'];
  function renderMap(plateName) {
    const name = plateName || state.active;
    if (!name || !state.plates.has(name)) return;
    if (name !== state.active) openPlate(name);
    else if (mapView.isOpen) { mapView.close(); return; }
    const p = state.plates.get(name);
    if (!p) return;
    mapView.open(p, lib, { hz: editor.hz });
    updateToolbar();
  }

  function act(name, el) {
    const plate = el && el.dataset ? el.dataset.plate : null;
    if (mapView && mapView.isOpen && !KEEP_MAP.includes(name)) mapView.close();
    switch (name) {
      case 'render-map': return renderMap(plate);
      case 'new-folder': return newFolder(el && el.dataset && el.dataset.folder ? el.dataset.folder : undefined);
      case 'rename-folder': return renameFolder(el.dataset.folder);
      case 'delete-folder': return deleteFolder(el.dataset.folder);
      case 'project-menu': return projectMenu(el);
      case 'new-project': return newProject();
      case 'open-project': return openProjectDialog();
      case 'home': return goHome();
      case 'new-plate': return newPlate();
      case 'save': return state.active && savePlate(state.active);
      case 'save-all': return saveAll();
      case 'undo': editor.undo(); return updateToolbar();
      case 'redo': editor.redo(); return updateToolbar();
      case 'run': return toggleLive();      // old Run (F5) = the Live button
      case 'reset': editor.stop(); editor.run(); return;
      case 'live': return toggleLive();
      case 'zoom-in': return mapView.isOpen ? mapView.zoomAt(1.25) : editor.setZoom(editor.zoom * 1.2);
      case 'zoom-out': return mapView.isOpen ? mapView.zoomAt(1 / 1.25) : editor.setZoom(editor.zoom / 1.2);
      case 'fit': return mapView.isOpen ? mapView.fit(true) : editor.fit();
      case 'rename': return renamePlate(plate);
      case 'duplicate': return duplicatePlate(plate);
      case 'delete-plate': return deletePlate(plate);
      case 'close-tab': return closeTab(plate);
      case 'reveal': return state.project && Store.reveal(state.project.path);
      case 'delete-sel': return editor.deleteSelection();
      case 'dup-group': return editor.duplicateGroup();
      case 'nudge-up': return editor.nudge(0, -10);
      case 'nudge-down': return editor.nudge(0, 10);
      case 'nudge-left': return editor.nudge(-10, 0);
      case 'nudge-right': return editor.nudge(10, 0);
      case 'stack-down': case 'stack-right': {
        if (!editor.sel || editor.sel.type !== 'node') return;
        const made = editor.fillCopies(editor.sel.id, stackCount, name === 'stack-down' ? 'down' : 'right');
        if (made) toast(`Stacked ${made + 1} parts`);
        return;
      }
      case 'open-ref': {
        const n = editor.sel && editor.plate.nodes.find((x) => x.id === editor.sel.id);
        if (!n || !n.props.ref) return;
        editor.openNode(n);
        return;
      }
    }
  }

  // ---------- Live mode ----------
  const LIVE_KEY = 'gateengine.live';
  function syncRunClass() {
    const on = !!(editor && editor.running);
    $('#ide').classList.toggle('running', on && !editor.auto);   // frozen look only in classic Run
    $('#ide').classList.toggle('live', on && editor.auto);
  }
  // one button: starts the simulation (Live) or stops it. Parts can be added and edited either way.
  function toggleLive() {
    const on = !editor.running;
    editor.setAuto(on);
    if (on && !editor.running) editor.run();
    try { localStorage.setItem(LIVE_KEY, editor.auto ? '1' : '0'); } catch { /* ignore */ }
    syncRunClass(); renderChrome(); renderInspector();
    toast(on ? 'Live is on: the circuit runs while you edit. Click a switch any time.' : 'Stopped.');
  }

  // ---------- name a part: double-click an input / output ----------
  async function renamePart(n) {
    const isOut = n.type === 'OUTPUT' || n.type === 'BUS_OUT', isPin = ['INPUT', 'OUTPUT', 'BUS_IN', 'BUS_OUT'].includes(n.type);
    const r = await dialog({
      title: 'Name this part',
      message: isPin ? `This becomes the name of an ${isOut ? 'output' : 'input'} pin when the plate is used as a chip.` : 'The name shown above the part.',
      fields: [{ name: 'name', label: 'Name', value: n.props.label || '' }],
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Save name', value: 'ok', primary: true }],
      validate: (v) => (v.name.trim().length < 1 ? 'Type a name.' : v.name.trim().length > 16 ? 'Up to 16 characters.' : null),
    });
    if (r.value === 'ok') editor.updateProps(n.id, { label: r.values.name.trim() });
  }

  // ---------- right-click delete ----------
  async function askDelete(sel) {
    if (!sel || !editor.plate || editor.editLocked) return false;
    let what = 'this wire';
    if (sel.type === 'multi') what = `these ${sel.count} parts`;
    else if (sel.type === 'node') {
      const n = editor.plate.nodes.find((x) => x.id === sel.id);
      if (!n) return false;
      what = n.type === 'PLATE' ? `the chip "${n.props.ref}"` : `the ${GateDefs.NAMES[n.type] || n.type}`;
    }
    const r = await dialog({
      title: 'Delete it?',
      message: `Do you want to delete ${esc(what)}?${sel.type === 'node' ? ' Its wires are removed too.' : ''} You can bring it back with Undo (Ctrl+Z).`,
      buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'Yes, delete', value: 'ok', primary: true, danger: true }],
    });
    if (r.value !== 'ok') return false;
    editor.deleteSelection();
    return false;     // already deleted here
  }

  function setup() {
    editor = new Editor($('#canvas'), {
      onChange: () => { if (state.active) state.dirty.add(state.active); renderChrome(); },
      onSelect: () => renderInspector(),
      onToast: (m, t) => toast(m, t),
      onOpenPlate: (n) => openPlate(n),
      onNav: () => { renderInspector(); updateToolbar(); renderStatus(); },
      onCopyBuiltin: (p) => copyBuiltin(p),
      onRename: (n) => renamePart(n),
      canUse,
      confirmDelete: (sel) => askDelete(sel),
      onZoom: (z) => { const r = $('#zoomRead'); if (r) r.textContent = Math.round(z * 100) + '%'; $('#stZoom').textContent = Math.round(z * 100) + '%'; },
      onCursor: (x, y) => { $('#stCursor').textContent = `x ${x}  y ${y}`; },
      onRunState: () => { syncRunClass(); renderChrome(); renderInspector(); },
      onHz: (hz) => { realHz = hz; paintHz(); },
    });
    mapView = new MapView($('.canvas-wrap'), { onToast: (m, t) => toast(m, t), onClose: () => updateToolbar() });
    try { editor.auto = localStorage.getItem(LIVE_KEY) === '1'; } catch { /* ignore */ }

    // "Dev CVAKI": open the link in the browser
    const openExt = (el) => Store.openExternal(el.dataset.ext).catch((err) => toast(err.message, 'error'));
    document.addEventListener('keydown', (e) => { const x = e.target.closest && e.target.closest('[data-ext]'); if (x && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openExt(x); } });
    document.addEventListener('click', (e) => {
      const ext = e.target.closest('[data-ext]');
      if (ext) { openExt(ext); return; }
      const el = e.target.closest('[data-act]');
      if (el) { act(el.dataset.act, el); return; }
      const rec = e.target.closest('.recent-item');
      if (rec) openProject({ name: rec.dataset.name, path: rec.dataset.path });
    });
    $('#tree').addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      const row = e.target.closest('.tree-row.plate');
      if (row) { state.curFolder = state.placement[row.dataset.plate] || null; openPlate(row.dataset.plate); return; }
      const fr = e.target.closest('.tree-row.folder');
      if (fr) { const id = fr.dataset.folder; state.curFolder = id; if (state.closed.has(id)) state.closed.delete(id); else state.closed.add(id); renderTree(); return; }
      if (e.target.closest('.tree-row.root')) { state.curFolder = null; renderTree(); }
    });
    $('#tabs').addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      const t = e.target.closest('.tab');
      if (t && t.dataset.plate !== state.active) openPlate(t.dataset.plate);
    });
    // Explorer drag and drop: a plate onto a plate/canvas = chip; a plate or box onto a box (or the project name) = file it there
    const tree = $('#tree');
    const dropTarget = (e) => {
      const f = e.target.closest('.tree-row.folder'), r = e.target.closest('.tree-row.root'), p = e.target.closest('.tree-row.plate');
      if (f) return { id: f.dataset.folder, el: f };
      if (r) return { id: null, el: r };
      if (p) return { id: state.placement[p.dataset.plate] || null, el: null };
      return { id: null, el: null };
    };
    const clearDrop = () => tree.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    tree.addEventListener('dragstart', (e) => {
      const pr = e.target.closest('.tree-row.plate'), fr = e.target.closest('.tree-row.folder');
      if (pr) {
        state.drag = { kind: 'plate', name: pr.dataset.plate };
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('application/x-ge-move', pr.dataset.plate);
        if (!editor.editLocked && editor.plate) e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'PLATE', ref: pr.dataset.plate }));
      } else if (fr) {
        state.drag = { kind: 'folder', id: fr.dataset.folder };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-ge-move', fr.dataset.folder);
      } else e.preventDefault();
    });
    tree.addEventListener('dragover', (e) => {
      if (!state.drag) return;
      const t = dropTarget(e);
      if (state.drag.kind === 'folder' && t.id && (t.id === state.drag.id || isInside(t.id, state.drag.id))) { clearDrop(); return; }
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      clearDrop(); if (t.el) t.el.classList.add('drop');
    });
    tree.addEventListener('dragleave', (e) => { if (!tree.contains(e.relatedTarget)) clearDrop(); });
    tree.addEventListener('drop', (e) => {
      if (!state.drag) return;
      e.preventDefault(); clearDrop();
      const t = dropTarget(e), d = state.drag; state.drag = null;
      if (d.kind === 'plate') movePlate(d.name, t.id); else moveFolder(d.id, t.id);
    });
    tree.addEventListener('dragend', () => { state.drag = null; clearDrop(); });
    $('#paletteSearch').addEventListener('input', renderPalette);
    $('#paletteList').addEventListener('dragstart', (e) => {
      const it = e.target.closest('.pal-item');
      if (!it || editor.editLocked) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: it.dataset.type, ref: it.dataset.ref || null }));
      e.dataTransfer.effectAllowed = 'copy';
    });
    $('#paletteList').addEventListener('dblclick', (e) => {
      const it = e.target.closest('.pal-item');
      if (it && editor.plate && !editor.editLocked) editor.addAtCenter(it.dataset.type, it.dataset.ref || null);
    });
    $('#inspector').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.stack) { stackCount = clampN(t.value, 2, 64, 8); t.value = stackCount; return; }
      if (t.dataset.prop && editor.sel && editor.sel.type === 'node') {
        const v = t.dataset.big ? t.value.trim() : ((t.dataset.prop === 'inputs' || t.dataset.num) ? Number(t.value) : t.value.trim());
        editor.updateProps(editor.sel.id, { [t.dataset.prop]: v });
      } else if (t.dataset.size) {
        const w = Number($('[data-size=w]').value), h = Number($('[data-size=h]').value);
        const r = editor.resize(w, h);
        if (r) { $('[data-size=w]').value = r.w; $('[data-size=h]').value = r.h; }
      }
    });
    $('#toolbar').addEventListener('change', (e) => { if (e.target.id === 'hzInput') editor.setHz(e.target.value === '' ? 1 : Number(e.target.value)); });

    document.addEventListener('keydown', (e) => {
      if ($('#modalRoot').firstChild || $('#menuRoot').firstChild) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (!state.project) return;
      if (mod && k === 's') { e.preventDefault(); if (e.shiftKey) saveAll(); else if (state.active) savePlate(state.active); return; }
      if (mapView.isOpen) return;      // the map handles Esc itself; the editor shortcuts wait until it is closed
      if (e.key === 'F5') { e.preventDefault(); if (editor.plate) toggleLive(); return; }
      if (e.key === 'F6') { e.preventDefault(); if (editor.plate) toggleLive(); return; }
      if (typing) return;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); updateToolbar(); }
      else if (!mod && e.key.startsWith('Arrow') && !editor.wiring && (editor.multi.size > 1 || editor.sel)) {
        e.preventDefault(); const st = e.shiftKey ? 50 : 10;
        editor.nudge(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0);
      }
      else if (mod && k === 'a') { e.preventDefault(); editor.selectAll(); }
      else if (mod && k === 'd' && editor.multi.size > 1) { e.preventDefault(); editor.duplicateGroup(); }
      else if (mod && k === 'd') { e.preventDefault(); if (editor.sel && editor.sel.type === 'node') editor.fillCopies(editor.sel.id, 2, 'down'); }
      else if (mod && k === 'y') { e.preventDefault(); editor.redo(); updateToolbar(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (editor.wiring) editor.popCorner(); else editor.deleteSelection(); }
      else if (e.key === 'Escape') {
        if (editor.wiring) editor.cancelWire();
        else if (editor.stack.length) editor.exit();
        else if (editor.sel || editor.multi.size) editor.select(null);
      }
    });
    window.addEventListener('beforeunload', (e) => { if (state.dirty.size) { e.preventDefault(); e.returnValue = ''; } });

    detectGPU();
    updateToolbar();
    // a window opened with "New window" on a project comes with ?project=...&name=...
    const q = new URLSearchParams(location.search), startPath = q.get('project');
    if (startPath) openProject({ name: q.get('name') || startPath, path: startPath }); else showWelcome();
  }

  async function detectGPU() {
    const chip = $('#gpuChip'), txt = $('#gpuText');
    try {
      if (!navigator.gpu) throw new Error('none');
      const ad = await navigator.gpu.requestAdapter();
      if (!ad) throw new Error('none');
      let info = ad.info || {};
      if (!ad.info && ad.requestAdapterInfo) info = await ad.requestAdapterInfo();
      const name = [info.vendor, info.architecture || info.device || info.description].filter(Boolean).join(' ');
      gpu = { ok: true, text: 'GPU: ' + (name || 'adapter ready') };
      chip.classList.add('ok');
    } catch {
      gpu = { ok: false, text: 'GPU not found, using CPU sim' };
      chip.classList.add('off');
    }
    txt.textContent = gpu.text;
    chip.title = gpu.ok ? 'WebGPU adapter detected. The simulator runs on the CPU for now; the GPU engine comes next.' : 'WebGPU is unavailable on this machine.';
  }

  setup();
  window.__gate = { state, get editor() { return editor; }, get map() { return mapView; } };   // handy in DevTools
})();
