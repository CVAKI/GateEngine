const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('gateAPI', {
  list: () => call('projects:list'),
  create: (name) => call('projects:create', name),
  openDialog: () => call('projects:open-dialog'),
  load: (dir) => call('projects:load', dir),
  saveMeta: (dir, patch) => call('projects:save-meta', dir, patch),
  reveal: (dir) => call('projects:reveal', dir),
  savePlate: (dir, name, plate) => call('plates:save', dir, name, plate),
  deletePlate: (dir, name) => call('plates:delete', dir, name),
  renamePlate: (dir, oldName, newName) => call('plates:rename', dir, oldName, newName),
  newWindow: (project) => call('window:new', project),
  openExternal: (url) => call('app:open-external', url),
});
