const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  list: () => ipcRenderer.invoke('list'),
  setDefaultCwd: (cwd) => ipcRenderer.invoke('set-default-cwd', cwd),
  create: (session) => ipcRenderer.invoke('create', session),
  rename: (id, name) => ipcRenderer.invoke('rename', id, name),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  pickFolder: (startPath) => ipcRenderer.invoke('pick-folder', startPath),
  showContextMenu: (id) => ipcRenderer.send('context-menu', id),
  attach: (id, cols, rows) => ipcRenderer.send('attach', id, cols, rows),
  write: (id, data) => ipcRenderer.send('write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('resize', id, cols, rows),
  onData: (callback) => ipcRenderer.on('pty-data', (_e, id, data) => callback(id, data)),
  onExit: (callback) => ipcRenderer.on('pty-exit', (_e, id) => callback(id)),
  onListChanged: (callback) => ipcRenderer.on('list-changed', (_e, store) => callback(store)),
  onRenameRequested: (callback) => ipcRenderer.on('rename-requested', (_e, id) => callback(id)),
});
