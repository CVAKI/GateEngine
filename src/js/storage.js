/* Project storage. Desktop app: real folders on disk through the Electron bridge.
 * Plain browser (for quick UI testing): localStorage. */
const Store = (function () {
  const api = window.gateAPI;
  const unwrap = async (p) => { const r = await p; if (r && r.error) throw new Error(r.error); return r; };

  if (api) {
    return {
      desktop: true,
      list: () => unwrap(api.list()),
      create: (name) => unwrap(api.create(name)),
      openDialog: () => unwrap(api.openDialog()),
      load: (ref) => unwrap(api.load(ref)),
      reveal: (ref) => unwrap(api.reveal(ref)),
      saveMeta: (ref, patch) => unwrap(api.saveMeta(ref, patch)),
      savePlate: (ref, name, plate) => unwrap(api.savePlate(ref, name, plate)),
      deletePlate: (ref, name) => unwrap(api.deletePlate(ref, name)),
      renamePlate: (ref, a, b) => unwrap(api.renamePlate(ref, a, b)),
      newWindow: (info) => unwrap(api.newWindow(info ? { path: info.path } : null)),
      openExternal: (url) => unwrap(api.openExternal(url)),
    };
  }

  const KEY = 'gateengine.projects.v1';
  const db = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const put = (o) => localStorage.setItem(KEY, JSON.stringify(o));
  const need = (d, ref) => { if (!d[ref]) throw new Error('Project not found.'); return d[ref]; };
  return {
    desktop: false,
    async list() { return Object.values(db()).map((p) => ({ name: p.meta.name, path: p.meta.name, modified: p.meta.modified || 0 })); },
    async create(name) {
      const d = db();
      if (d[name]) throw new Error('A project with this name already exists.');
      const meta = { name, format: 1, created: Date.now(), modified: Date.now(), main: 'main' };
      d[name] = { meta, plates: {} };
      put(d);
      return { name, path: name, modified: meta.modified };
    },
    async openDialog() { return null; },
    async openExternal(url) { window.open(url, '_blank', 'noopener'); return true; },
    async newWindow(info) {
      const u = new URL(location.href); u.search = '';
      if (info) { u.searchParams.set('project', info.path); u.searchParams.set('name', info.name); }
      window.open(u.toString(), '_blank');
      return true;
    },
    async load(ref) { const p = need(db(), ref); return { meta: p.meta, plates: p.plates }; },
    async reveal() { return true; },
    async saveMeta(ref, patch) { const d = db(); const p = need(d, ref); for (const k of ['folders', 'placement']) if (patch && patch[k] !== undefined) p.meta[k] = patch[k]; put(d); return true; },
    async savePlate(ref, name, plate) { const d = db(); const p = need(d, ref); p.plates[name] = plate; p.meta.modified = Date.now(); put(d); return true; },
    async deletePlate(ref, name) { const d = db(); delete need(d, ref).plates[name]; put(d); return true; },
    async renamePlate(ref, a, b) {
      const d = db(); const p = need(d, ref);
      if (p.plates[b]) throw new Error('A plate with this name already exists.');
      p.plates[b] = p.plates[a]; delete p.plates[a]; put(d); return true;
    },
  };
})();
