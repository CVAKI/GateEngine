const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Let the renderer see the real GPU through WebGPU (used for the GPU badge now, the sim engine later).
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const META = 'gate.project.json';
const rootDir = () => {
  const d = path.join(app.getPath('documents'), 'GateEngine');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
// keeps letters, digits, _ - space and dots (a plate called "gpu.map" must keep its ".map"); no leading or trailing dots, so ".." can never leave the folder
const safe = (s) => String(s).trim().replace(/[^\w\- .]+/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 64) || 'untitled';
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2));
const isProject = (dir) => !!dir && fs.existsSync(path.join(dir, META));
const platesDir = (dir) => path.join(dir, 'plates');
const plateFile = (dir, name) => path.join(platesDir(dir), safe(name) + '.plate.json');
// HowItsWork.md (file formats + components, written so an AI can build projects without the source code) goes into every project folder
const GUIDE = 'HowItsWork.md';
const putGuide = (dir) => {
  try {
    // The guide belongs to the app, so every project always holds the app's current version
    // (created with the project, restored if deleted, refreshed after an app update).
    const from = path.join(__dirname, GUIDE), to = path.join(dir, GUIDE);
    const src = fs.readFileSync(from);
    if (!fs.existsSync(to) || !fs.readFileSync(to).equals(src)) fs.writeFileSync(to, src);
  } catch { /* the guide is a convenience, never block a project because of it */ }
};
const info = (dir) => {
  const m = readJSON(path.join(dir, META));
  return { name: m.name, path: dir, modified: fs.statSync(path.join(dir, META)).mtimeMs };
};

// Every handler returns data or { error } so the renderer can show a readable message.
const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try { return await fn(...args); } catch (err) { return { error: err.message || String(err) }; }
    });

handle('projects:list', () => {
  const root = rootDir();
  return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isProject(path.join(root, d.name)))
      .map((d) => info(path.join(root, d.name)))
      .sort((a, b) => b.modified - a.modified);
});

handle('projects:create', (name) => {
  const n = safe(name);
  const dir = path.join(rootDir(), n);
  if (fs.existsSync(dir)) throw new Error('A project with this name already exists.');
  fs.mkdirSync(platesDir(dir), { recursive: true });
  writeJSON(path.join(dir, META), { name: n, format: 1, created: Date.now(), main: 'main' });
  putGuide(dir);
  return info(dir);
});

handle('projects:open-dialog', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Open Gate Engine project',
    defaultPath: rootDir(),
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  if (!isProject(dir)) throw new Error('That folder is not a Gate Engine project (gate.project.json missing).');
  putGuide(dir);
  return info(dir);
});

handle('projects:load', (dir) => {
  if (!isProject(dir)) throw new Error('Project not found.');
  putGuide(dir);   // older projects get it the first time they are opened
  const meta = readJSON(path.join(dir, META));
  const plates = {};
  const pd = platesDir(dir);
  if (fs.existsSync(pd)) {
    for (const f of fs.readdirSync(pd)) {
      if (!f.endsWith('.plate.json')) continue;
      try { plates[f.slice(0, -'.plate.json'.length)] = readJSON(path.join(pd, f)); } catch { /* skip broken file */ }
    }
  }
  return { meta, plates };
});

// folders in the Explorer live in the project file (plates keep their names, so chips never break)
handle('projects:save-meta', (dir, patch) => {
  if (!isProject(dir)) throw new Error('Project not found.');
  const m = readJSON(path.join(dir, META));
  for (const k of ['folders', 'placement']) if (patch && patch[k] !== undefined) m[k] = patch[k];
  writeJSON(path.join(dir, META), m);
  return true;
});

handle('projects:reveal', (dir) => { if (isProject(dir)) shell.openPath(dir); return true; });

handle('plates:save', (dir, name, plate) => {
  if (!isProject(dir)) throw new Error('Project not found.');
  fs.mkdirSync(platesDir(dir), { recursive: true });
  writeJSON(plateFile(dir, name), plate);
  return true;
});

handle('plates:delete', (dir, name) => {
  if (!isProject(dir)) throw new Error('Project not found.');
  fs.rmSync(plateFile(dir, name), { force: true });
  return true;
});

handle('plates:rename', (dir, oldName, newName) => {
  if (!isProject(dir)) throw new Error('Project not found.');
  const to = plateFile(dir, newName);
  if (fs.existsSync(to)) throw new Error('A plate with this name already exists.');
  fs.renameSync(plateFile(dir, oldName), to);
  return true;
});

// project (optional) = { path, name }: the new window opens that project straight away (File > open in a new window)
// the "Dev CVAKI" credit opens the developer's LinkedIn page in the default browser (nothing else is allowed through)
const EXTERNAL_OK = ['https://www.linkedin.com/in/cvaki-'];
handle('app:open-external', (url) => {
  if (!EXTERNAL_OK.includes(String(url))) throw new Error('That link is not allowed.');
  return shell.openExternal(String(url)).then(() => true);
});

// a second window, empty (project = null) or already on a project
handle('window:new', (proj) => {
  if (proj && proj.path) {
    if (!isProject(proj.path)) throw new Error('Project not found.');
    const i = info(proj.path);
    createWindow({ path: i.path, name: i.name });
  } else createWindow();
  return true;
});

function createWindow(project) {
  const from = BrowserWindow.getFocusedWindow();
  const copyShape = from && !from.isMaximized() && !from.isFullScreen();
  const [fw, fh] = copyShape ? from.getSize() : [1440, 900];
  const [fx, fy] = copyShape ? from.getPosition() : [undefined, undefined];
  const win = new BrowserWindow({
    width: fw,
    height: fh,
    ...(copyShape ? { x: fx + 32, y: fy + 32 } : {}),
    minWidth: 860,
    minHeight: 520,
    backgroundColor: '#070B14',
    title: 'Gate Engine',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    // No separate Windows title bar: our own top bar is the title bar, the window buttons sit on top of it.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#060A14', symbolColor: '#9AA8CC', height: 46 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // the app never navigates away from itself, and never opens extra windows by accident
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith('file:')) e.preventDefault(); });
  if (from && from.isMaximized()) win.maximize();
  win.loadFile(path.join(__dirname, 'src', 'index.html'), project ? { query: { project: project.path, name: project.name } } : undefined);
  // Shown when the renderer blocks closing because plates are unsaved.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Leave without saving', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved plates',
      message: 'Some plates have unsaved changes. Leave without saving?',
    });
    if (choice === 0) e.preventDefault();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'View', submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });