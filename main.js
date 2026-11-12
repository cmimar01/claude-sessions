const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const pty = require('node-pty');

const storePath = path.join(app.getPath('userData'), 'sessions.json');
const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
const ptys = new Map();
let store;
let win;

function loadStore() {
  if (!fs.existsSync(storePath)) return { defaultCwd: os.homedir(), sessions: [] };
  return JSON.parse(fs.readFileSync(storePath, 'utf8'));
}

function saveStore() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  send('list-changed', store);
}

function send(channel, ...args) {
  if (!win.isDestroyed()) win.webContents.send(channel, ...args);
}

function findSession(id) {
  return store.sessions.find((s) => s.id === id);
}

function transcriptExists(id) {
  if (!fs.existsSync(claudeProjectsDir)) return false;
  return fs
    .readdirSync(claudeProjectsDir)
    .some((dir) => fs.existsSync(path.join(claudeProjectsDir, dir, `${id}.jsonl`)));
}

function claudeArgs(session) {
  return transcriptExists(session.id)
    ? ['--resume', session.id]
    : ['--session-id', session.id, '-n', session.name];
}

function attach(id, cols, rows) {
  if (ptys.has(id)) return;
  const session = findSession(id);
  if (!fs.existsSync(session.cwd)) {
    send('pty-data', id, `\x1b[31mPfad nicht gefunden: ${session.cwd}\x1b[0m\r\n`);
    send('pty-exit', id);
    return;
  }
  const proc = pty.spawn('claude.exe', claudeArgs(session), {
    name: 'xterm-256color',
    cwd: session.cwd,
    cols,
    rows,
    env: process.env,
  });
  proc.onData((data) => send('pty-data', id, data));
  proc.onExit(() => {
    ptys.delete(id);
    send('pty-exit', id);
  });
  ptys.set(id, proc);
}

function kill(id) {
  ptys.get(id)?.kill();
  ptys.delete(id);
}

async function confirmRemove(session) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Entfernen', 'Abbrechen'],
    defaultId: 1,
    cancelId: 1,
    message: `Session "${session.name}" endgültig aus der Liste entfernen?`,
    detail: `Das Claude-Transcript bleibt erhalten und ist über "claude --resume ${session.id}" erreichbar.`,
  });
  return response === 0;
}

function remove(id) {
  kill(id);
  store.sessions = store.sessions.filter((s) => s.id !== id);
  saveStore();
}

function setArchived(id, archived) {
  if (archived) kill(id);
  findSession(id).archived = archived;
  saveStore();
}

function showContextMenu(id) {
  const session = findSession(id);
  Menu.buildFromTemplate([
    { label: 'Umbenennen', click: () => send('rename-requested', id) },
    session.archived
      ? { label: 'Wiederherstellen', click: () => setArchived(id, false) }
      : { label: 'Archivieren', click: () => setArchived(id, true) },
    { type: 'separator' },
    {
      label: 'Endgültig entfernen…',
      click: async () => {
        if (await confirmRemove(session)) remove(id);
      },
    },
  ]).popup({ window: win });
}

ipcMain.handle('list', () => store);
ipcMain.handle('set-default-cwd', (_e, cwd) => {
  store.defaultCwd = cwd;
  saveStore();
});
ipcMain.handle('create', (_e, { name, cwd }) => {
  const session = { id: crypto.randomUUID(), name, cwd, createdAt: new Date().toISOString(), archived: false };
  store.sessions.push(session);
  saveStore();
  return session.id;
});
ipcMain.handle('rename', (_e, id, name) => {
  findSession(id).name = name;
  saveStore();
});
ipcMain.handle('pick-folder', async (_e, startPath) => {
  const result = await dialog.showOpenDialog(win, { defaultPath: startPath, properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.on('context-menu', (_e, id) => showContextMenu(id));
ipcMain.on('attach', (_e, id, cols, rows) => attach(id, cols, rows));
ipcMain.on('write', (_e, id, data) => ptys.get(id)?.write(data));
ipcMain.on('resize', (_e, id, cols, rows) => ptys.get(id)?.resize(cols, rows));

app.whenReady().then(() => {
  store = loadStore();
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Claude Sessions',
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
});

app.on('before-quit', () => ptys.forEach((proc) => proc.kill()));
app.on('window-all-closed', () => app.quit());
