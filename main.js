const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const pty = require('node-pty');
const { autoUpdater } = require('electron-updater');

app.setPath('userData', path.join(app.getPath('appData'), 'claude-sessions'));
const storePath = path.join(app.getPath('userData'), 'sessions.json');
const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
const claudeExecutableName = process.platform === 'win32' ? 'claude.exe' : 'claude';
const nativeInstallPath = path.join(os.homedir(), '.local', 'bin', claudeExecutableName);
const claudeExecutable = fs.existsSync(nativeInstallPath) ? nativeInstallPath : claudeExecutableName;
const curlExecutable =
  process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'curl.exe') : 'curl';
const imagePasteKey = process.platform === 'win32' ? '\x1bv' : '\x16';
const hookToken = crypto.randomUUID();
const autoNameLength = 40;
const ptys = new Map();
const busyIds = new Set();
let hookUrlBase;
let store;
let win;

function loadStore() {
  if (!fs.existsSync(storePath)) return { defaultCwd: os.homedir(), sessions: [] };
  const loaded = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  loaded.sessions.forEach((session) => (session.claudeSessionId ??= session.id));
  return loaded;
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

function sessionEnv() {
  const { CLAUDE_CODE_CHILD_SESSION, ...env } = process.env;
  return env;
}

function hookSettings(entryId) {
  const forwardToTool = {
    type: 'command',
    command: curlExecutable,
    args: ['-s', '-H', 'Content-Type: application/json', '--data-binary', '@-', `${hookUrlBase}/${entryId}`],
  };
  const forward = (matcher) => [{ ...(matcher && { matcher }), hooks: [forwardToTool] }];
  return JSON.stringify({
    hooks: {
      SessionStart: forward(),
      UserPromptSubmit: forward(),
      PostToolUse: forward(),
      Stop: forward(),
      Notification: forward('permission_prompt|elicitation_dialog'),
    },
  });
}

function claudeArgs(session) {
  const { claudeSessionId } = session;
  const sessionArgs = transcriptExists(claudeSessionId)
    ? ['--resume', claudeSessionId]
    : session.forkOf
      ? ['--resume', session.forkOf, '--fork-session']
      : ['--session-id', claudeSessionId, ...(session.autoNamed ? [] : ['-n', session.name])];
  return [...sessionArgs, '--settings', hookSettings(session.id)];
}

function setBusy(id, busy) {
  if (busy === busyIds.has(id)) return;
  if (busy) busyIds.add(id);
  else busyIds.delete(id);
  send('busy-changed', [...busyIds]);
}

function applyNameFromPrompt(session, prompt) {
  if (!session.autoNamed) return;
  const text = (prompt ?? '').replace(/\s+/g, ' ').trim();
  // Slash commands like /clear or /model say nothing about the session's topic.
  if (!text || text.startsWith('/')) return;
  session.name = text.length > autoNameLength ? `${text.slice(0, autoNameLength).trimEnd()}…` : text;
  session.autoNamed = false;
}

function handleHookEvent(entryId, body) {
  const session = findSession(entryId);
  if (!session) return;
  let event;
  try {
    event = JSON.parse(body);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.warn(`Hook mit ungültigem JSON für Eintrag ${entryId} ignoriert`);
    return;
  }
  switch (event.hook_event_name) {
    case 'SessionStart':
      setBusy(entryId, false);
      if (!event.session_id || event.session_id === session.claudeSessionId) return;
      session.claudeSessionId = event.session_id;
      saveStore();
      return;
    case 'UserPromptSubmit':
      session.lastPromptAt = new Date().toISOString();
      applyNameFromPrompt(session, event.prompt);
      saveStore();
      setBusy(entryId, true);
      return;
    case 'PostToolUse':
      setBusy(entryId, true);
      return;
    case 'Stop':
    case 'Notification':
      setBusy(entryId, false);
      return;
  }
}

function startHookServer() {
  const prefix = `/${hookToken}/`;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.end();
      if (req.url.startsWith(prefix)) handleHookEvent(req.url.slice(prefix.length), body);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      hookUrlBase = `http://127.0.0.1:${server.address().port}/${hookToken}`;
      resolve();
    }),
  );
}

function isDirectory(cwd) {
  return path.isAbsolute(cwd) && Boolean(fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory());
}

function attach(id, cols, rows) {
  if (ptys.has(id)) return;
  const session = findSession(id);
  if (!isDirectory(session.cwd)) {
    send('pty-data', id, `\x1b[31mPfad nicht gefunden: ${session.cwd}\x1b[0m\r\n`);
    send('pty-exit', id);
    return;
  }
  const proc = pty.spawn(claudeExecutable, claudeArgs(session), {
    name: 'xterm-256color',
    cwd: session.cwd,
    cols,
    rows,
    env: sessionEnv(),
  });
  proc.onData((data) => send('pty-data', id, data));
  proc.onExit(() => {
    const isCurrentProcess = ptys.get(id) === proc;
    if (!isCurrentProcess) return;
    ptys.delete(id);
    setBusy(id, false);
    send('pty-exit', id);
  });
  ptys.set(id, proc);
}

function kill(id) {
  ptys.get(id)?.kill();
  ptys.delete(id);
  setBusy(id, false);
}

async function confirmRemove(session) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Entfernen', 'Abbrechen'],
    defaultId: 1,
    cancelId: 1,
    message: `Session "${session.name}" endgültig aus der Liste entfernen?`,
    detail: `Das Claude-Transcript bleibt erhalten und ist über "claude --resume ${session.claudeSessionId}" erreichbar.`,
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

function promptText({ display, pastedContents = {} }) {
  return display.replace(/\[Pasted text #(\d+)[^\]]*\]/g, (placeholder, pasteId) => {
    const paste = pastedContents[pasteId];
    return paste?.type === 'text' ? paste.content : placeholder;
  });
}

function parseHistoryLine(line) {
  try {
    return [JSON.parse(line)];
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.warn('Unlesbare Zeile in history.jsonl übersprungen');
    return [];
  }
}

async function promptHistory(id) {
  const { claudeSessionId } = findSession(id);
  const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl');
  if (!fs.existsSync(historyPath)) return [];
  const lines = (await fs.promises.readFile(historyPath, 'utf8')).split('\n');
  return lines
    .filter((line) => line.includes(claudeSessionId))
    .flatMap(parseHistoryLine)
    .filter((entry) => entry.sessionId === claudeSessionId)
    .map(promptText)
    .reverse();
}

function resumeCommand(session) {
  const separator = process.platform === 'win32' ? ';' : ' &&';
  return `cd "${session.cwd}"${separator} claude --resume ${session.claudeSessionId}`;
}

function createSession(fields) {
  const id = crypto.randomUUID();
  const session = { id, claudeSessionId: id, createdAt: new Date().toISOString(), archived: false, ...fields };
  store.sessions.push(session);
  saveStore();
  return id;
}

function stop(id) {
  kill(id);
  send('pty-exit', id);
}

function restart(id) {
  kill(id);
  send('restart-requested', id);
}

async function changeWorkingDirectory(session) {
  const result = await dialog.showOpenDialog(win, { defaultPath: session.cwd, properties: ['openDirectory'] });
  if (result.canceled) return;
  session.cwd = result.filePaths[0];
  saveStore();
  if (ptys.has(session.id)) restart(session.id);
}

function fork(session) {
  const forkId = createSession({ name: `${session.name} (Fork)`, cwd: session.cwd, forkOf: session.claudeSessionId });
  send('select-requested', forkId);
}

function showContextMenu(id) {
  const session = findSession(id);
  const isActive = !session.archived;
  Menu.buildFromTemplate([
    { label: 'Umbenennen', click: () => send('rename-requested', id) },
    { label: 'Resume-Befehl kopieren', click: () => clipboard.writeText(resumeCommand(session)) },
    { label: 'Ordner öffnen', click: () => shell.openPath(session.cwd) },
    { type: 'separator' },
    { label: 'Neu starten', enabled: isActive, click: () => restart(id) },
    { label: 'Session beenden', enabled: ptys.has(id), click: () => stop(id) },
    { label: 'Arbeitsverzeichnis ändern…', click: () => changeWorkingDirectory(session) },
    { label: 'Als neue Session forken', enabled: isActive, click: () => fork(session) },
    { type: 'separator' },
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
  if (!isDirectory(cwd)) return null;
  return createSession(name ? { name, cwd } : { name: path.basename(cwd) || cwd, cwd, autoNamed: true });
});
ipcMain.handle('rename', (_e, id, name) => {
  const session = findSession(id);
  session.name = name;
  session.autoNamed = false;
  saveStore();
});
ipcMain.handle('read-clipboard', async () => ({
  text: await clipboard.readText(),
  hasImage: await clipboard.has('image/png'),
}));
ipcMain.handle('pick-folder', async (_e, startPath) => {
  const result = await dialog.showOpenDialog(win, { defaultPath: startPath, properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.on('context-menu', (_e, id) => showContextMenu(id));
ipcMain.on('attach', (_e, id, cols, rows) => attach(id, cols, rows));
ipcMain.on('mark-waiting', (_e, id) => setBusy(id, false));
ipcMain.on('write', (_e, id, data) => ptys.get(id)?.write(data));
ipcMain.on('paste-image', (_e, id) => ptys.get(id)?.write(imagePasteKey));
ipcMain.handle('prompt-history', (_e, id) => promptHistory(id));
ipcMain.on('write-clipboard', (_e, text) => clipboard.writeText(text));
ipcMain.on('open-external', (_e, url) => {
  const isWebUrl = URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol);
  if (isWebUrl) shell.openExternal(url);
});
ipcMain.on('resize', (_e, id, cols, rows) => ptys.get(id)?.resize(cols, rows));

const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

function checkForUpdates() {
  autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('Update-Prüfung fehlgeschlagen:', err.message));
}

if (!app.requestSingleInstanceLock()) app.exit(0);

app.on('second-instance', () => {
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  store = loadStore();
  await startHookServer();
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: `Claude Sessions ${app.getVersion()}`,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.on('page-title-updated', (event) => event.preventDefault());
  win.loadFile('index.html');
  checkForUpdates();
  setInterval(checkForUpdates, UPDATE_INTERVAL_MS);
});

app.on('before-quit', () => ptys.forEach((proc) => proc.kill()));
app.on('window-all-closed', () => app.quit());
