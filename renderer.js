const terminals = new Map();
const running = new Set();
let store;
let selectedId = null;

const $ = (id) => document.getElementById(id);

function renderList() {
  const active = store.sessions.filter((s) => !s.archived);
  const archived = store.sessions.filter((s) => s.archived);
  $('sessions').replaceChildren(...active.map(listItem));
  $('archived-sessions').replaceChildren(...archived.map(listItem));
  $('archive').hidden = archived.length === 0;
  $('archive').querySelector('summary').textContent = `Archiv (${archived.length})`;
}

function listItem(session) {
  const li = document.createElement('li');
  li.dataset.id = session.id;
  li.title = session.cwd;
  li.classList.toggle('selected', session.id === selectedId);
  li.classList.toggle('running', running.has(session.id));
  li.append(session.name);
  const cwd = document.createElement('small');
  cwd.textContent = session.cwd;
  li.append(cwd);
  if (!session.archived) li.addEventListener('click', () => select(session.id));
  li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.api.showContextMenu(session.id);
  });
  return li;
}

function startRename(id) {
  const li = document.querySelector(`li[data-id="${id}"]`);
  const session = store.sessions.find((s) => s.id === id);
  const input = document.createElement('input');
  input.value = session.name;
  li.replaceChildren(input);
  input.focus();
  input.select();
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    const newName = input.value.trim();
    if (e.key === 'Enter' && newName) window.api.rename(id, newName);
    if (e.key === 'Escape') renderList();
  });
  input.addEventListener('blur', renderList);
}

function createTerminal(id) {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Cascadia Mono, Consolas, monospace',
    fontSize: 13,
    scrollback: 10000,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  const host = document.createElement('div');
  host.className = 'terminal-host';
  $('terminals').append(host);
  term.open(host);
  term.attachCustomKeyEventHandler((e) => {
    const isPaste = e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'v';
    if (!isPaste) return true;
    e.preventDefault();
    if (e.type === 'keydown') paste(id, term);
    return false;
  });
  term.onData((data) => {
    if (running.has(id)) window.api.write(id, data);
    else if (data === '\r') start(id);
  });
  term.onResize(({ cols, rows }) => window.api.resize(id, cols, rows));
  const entry = { term, fit, host };
  terminals.set(id, entry);
  return entry;
}

async function paste(id, term) {
  const { text, hasImage } = await window.api.readClipboard();
  if (text) term.paste(text);
  else if (hasImage) window.api.write(id, '\x1bv');
}

function start(id) {
  const { term } = terminals.get(id);
  running.add(id);
  window.api.attach(id, term.cols, term.rows);
  renderList();
}

function disposeTerminal(id) {
  const entry = terminals.get(id);
  if (!entry) return;
  entry.term.dispose();
  entry.host.remove();
  terminals.delete(id);
  running.delete(id);
}

function select(id) {
  selectedId = id;
  $('placeholder').hidden = true;
  const entry = terminals.get(id) ?? createTerminal(id);
  terminals.forEach((other) => (other.host.hidden = other !== entry));
  entry.fit.fit();
  entry.term.focus();
  if (!running.has(id)) start(id);
  renderList();
}

function deselect() {
  selectedId = null;
  $('placeholder').hidden = false;
}

function onStoreChanged(newStore) {
  store = newStore;
  const visibleIds = new Set(store.sessions.filter((s) => !s.archived).map((s) => s.id));
  [...terminals.keys()].filter((id) => !visibleIds.has(id)).forEach(disposeTerminal);
  if (selectedId && !visibleIds.has(selectedId)) deselect();
  $('default-cwd').value = store.defaultCwd;
  renderList();
}

async function pickInto(input) {
  const folder = await window.api.pickFolder(input.value);
  if (folder) input.value = folder;
  return folder;
}

window.api.onData((id, data) => terminals.get(id)?.term.write(data));
window.api.onExit((id) => {
  running.delete(id);
  terminals.get(id)?.term.write('\r\n\x1b[33m[Session beendet, Enter startet neu]\x1b[0m\r\n');
  renderList();
});
window.api.onListChanged(onStoreChanged);
window.api.onRenameRequested(startRename);

$('default-cwd').addEventListener('change', (e) => window.api.setDefaultCwd(e.target.value.trim()));
$('pick-default').addEventListener('click', async () => {
  const folder = await pickInto($('default-cwd'));
  if (folder) window.api.setDefaultCwd(folder);
});

$('new-session').addEventListener('click', () => {
  $('new-form').hidden = false;
  $('new-name').value = '';
  $('new-cwd').value = store.defaultCwd;
  $('new-name').focus();
});
$('pick-new').addEventListener('click', () => pickInto($('new-cwd')));
$('cancel-new').addEventListener('click', () => ($('new-form').hidden = true));
$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('new-form').hidden = true;
  const id = await window.api.create({ name: $('new-name').value.trim(), cwd: $('new-cwd').value.trim() });
  select(id);
});

new ResizeObserver(() => {
  if (selectedId) terminals.get(selectedId)?.fit.fit();
}).observe($('terminals'));

window.api.list().then(onStoreChanged);
