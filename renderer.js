const terminals = new Map();
const running = new Set();
let busyIds = new Set();
const attentionIds = new Set();
let store;
let selectedId = null;
let editingId = null;

const $ = (id) => document.getElementById(id);

const lastActivity = (session) => session.lastPromptAt ?? session.createdAt;

function matchesFilter(session, terms) {
  const tags = (session.tags ?? []).map((tag) => tag.toLowerCase());
  const text = [session.name, session.cwd, ...tags].join('\n').toLowerCase();
  return terms.every((term) =>
    term.startsWith('#') ? tags.some((tag) => tag.startsWith(term.slice(1))) : text.includes(term),
  );
}

function renderList() {
  // Rebuilding the list during an in-place edit would destroy the edited element and discard the input.
  if (editingId) return;
  const query = $('list-filter').value.trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const matching = store.sessions.filter((s) => matchesFilter(s, terms));
  const active = matching
    .filter((s) => !s.archived)
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
  const archived = matching.filter((s) => s.archived);
  $('sessions').replaceChildren(...active.map(listItem));
  $('archived-sessions').replaceChildren(...archived.map(listItem));
  $('archive').hidden = archived.length === 0;
  if (query) $('archive').open = true;
  $('archive').querySelector('summary').textContent = `Archiv (${archived.length})`;
  showAttentionCount();
}

let shownAttentionCount = 0;

function showAttentionCount() {
  const count = attentionIds.size;
  if (count === shownAttentionCount) return;
  shownAttentionCount = count;
  window.api.setAttentionCount(count, count ? badgeImage(count) : null);
}

const STATE_LABELS = {
  busy: 'Claude arbeitet',
  attention: 'Wartet auf dich',
  running: 'Läuft',
  stopped: 'Nicht gestartet',
};

function sessionState(id) {
  if (!running.has(id)) return null;
  if (busyIds.has(id)) return 'busy';
  if (attentionIds.has(id)) return 'attention';
  return 'running';
}

const isInView = (id) => id === selectedId && document.hasFocus();

function onBusyChanged(ids) {
  const nowBusy = new Set(ids);
  const finished = [...busyIds].filter((id) => !nowBusy.has(id) && running.has(id) && !isInView(id));
  finished.forEach((id) => attentionIds.add(id));
  nowBusy.forEach((id) => attentionIds.delete(id));
  busyIds = nowBusy;
  renderList();
}

function badgeImage(count) {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c4314b';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
  ctx.fill();
  const label = count > 9 ? '9+' : String(count);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${label.length > 1 ? 17 : 22}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 1);
  return canvas.toDataURL();
}

function clearAttention(id) {
  if (attentionIds.delete(id)) renderList();
}

function listItem(session) {
  const li = document.createElement('li');
  li.dataset.id = session.id;
  li.classList.toggle('selected', session.id === selectedId);
  const state = sessionState(session.id);
  if (state) li.classList.add(state);
  li.title = session.archived ? session.cwd : `${STATE_LABELS[state ?? 'stopped']}\n${session.cwd}`;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = session.name;
  li.append(name, tagLine(session.tags ?? []));
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

function tagLine(tags) {
  const line = document.createElement('small');
  line.className = 'tags';
  line.hidden = tags.length === 0;
  line.append(...tags.map(tagChip));
  return line;
}

function tagChip(tag) {
  const chip = document.createElement('span');
  chip.className = 'tag';
  chip.textContent = `#${tag}`;
  chip.title = `Nach #${tag} filtern`;
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    $('list-filter').value = `#${tag}`;
    renderList();
  });
  return chip;
}

function editInPlace(id, element, onSubmit) {
  const li = element.closest('li');
  editingId = id;
  li.classList.add('editing');
  element.hidden = false;
  element.contentEditable = 'plaintext-only';
  element.focus();
  getSelection().selectAllChildren(element);
  const finish = (submitted) => {
    if (editingId !== id) return;
    editingId = null;
    if (submitted) onSubmit(element.textContent.trim());
    renderList();
  };
  element.addEventListener('click', (e) => e.stopPropagation());
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') finish(false);
    if (e.key !== 'Enter') return;
    e.preventDefault();
    finish(true);
  });
  element.addEventListener('blur', () => finish(false));
}

function startRename(id) {
  const name = document.querySelector(`li[data-id="${id}"] .name`);
  editInPlace(id, name, (newName) => {
    const session = store.sessions.find((s) => s.id === id);
    if (newName && session && newName !== session.name) window.api.rename(id, newName);
  });
}

function startEditTags(id) {
  const tags = document.querySelector(`li[data-id="${id}"] .tags`);
  tags.textContent = [...tags.children].map((chip) => chip.textContent).join(' ');
  editInPlace(id, tags, (text) => window.api.setTags(id, text));
}

function createTerminal(id) {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Cascadia Mono, Consolas, monospace',
    fontSize: 13,
    scrollback: 10000,
    allowProposedApi: true,
  });
  const openLink = (event, url) => openLinkOnCtrlClick(term, event, url);
  term.options.linkHandler = { activate: openLink };
  // Claude Code lays out emoji such as ⏳ as two columns; xterm's default Unicode 6 table counts one, which shifts and overdraws its redraws.
  term.loadAddon(new Unicode11Addon.Unicode11Addon());
  term.unicode.activeVersion = '11';
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon(openLink));
  const host = document.createElement('div');
  host.className = 'terminal-host';
  $('terminals').append(host);
  term.open(host);
  host.addEventListener('contextmenu', (e) => e.preventDefault());
  host.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      copyOrPaste(id, term);
    },
    { capture: true },
  );
  host.addEventListener('mousedown', (e) => {
    if (e.button === 0 && term.modes.mouseTrackingMode !== 'none') watchAppSelection(id);
  });
  term.parser.registerOscHandler(52, copyFromOsc52);
  term.attachCustomKeyEventHandler((e) => {
    const isPaste = e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'v';
    const historyStep = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    const isHistoryRecall = e.altKey && !e.ctrlKey && !e.shiftKey && historyStep !== undefined;
    const isNewline = e.ctrlKey !== e.shiftKey && !e.altKey && e.key === 'Enter';
    if (!isPaste && !isHistoryRecall && !isNewline) return true;
    e.preventDefault();
    if (e.type !== 'keydown') return false;
    if (isPaste) paste(id, term);
    else if (isNewline) insertNewline(id);
    else queueRecall(id, historyStep);
    return false;
  });
  term.onData((data) => {
    Object.assign(terminals.get(id), { history: null, historyIndex: -1 });
    const isInterruptKey = data === '\x1b' || data === '\x03';
    if (running.has(id) && isInterruptKey) window.api.markWaiting(id);
    if (running.has(id)) window.api.write(id, data);
    else if (data === '\r') start(id);
  });
  term.onResize(({ cols, rows }) => window.api.resize(id, cols, rows));
  term.onSelectionChange(updateLaunchButton);
  const entry = { term, fit, host, history: null, historyIndex: -1, recall: Promise.resolve() };
  terminals.set(id, entry);
  return entry;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function queueRecall(id, step) {
  const entry = terminals.get(id);
  entry.recall = entry.recall.then(() => recallPrompt(id, step));
}

async function recallPrompt(id, step) {
  const canRecall = running.has(id) && !busyIds.has(id);
  if (!canRecall) return;
  const entry = terminals.get(id);
  entry.history ??= await window.api.promptHistory(id);
  const index = Math.max(-1, Math.min(entry.historyIndex + step, entry.history.length - 1));
  if (index === entry.historyIndex) return;
  entry.historyIndex = index;
  await replaceInput(id, entry.term, index === -1 ? '' : entry.history[index]);
}

const killLinePair = '\x0b\x15';
const killLinePairsPerChunk = 5;
const killChunks = 10;

async function replaceInput(id, term, text) {
  for (let chunk = 0; chunk < killChunks; chunk++) {
    window.api.write(id, killLinePair.repeat(killLinePairsPerChunk));
    await pause(15);
  }
  await pause(50);
  if (text && term.modes.bracketedPasteMode) window.api.write(id, `\x1b[200~${text}\x1b[201~`);
}

// xterm.js sends a plain CR for Ctrl+Enter, which Claude Code treats as submit; LF (Ctrl+J) inserts a line break.
function insertNewline(id) {
  if (running.has(id)) window.api.write(id, '\n');
}

function openLinkOnCtrlClick(term, event, url) {
  // With mouse tracking on, xterm also forwards the click and Claude Code opens the link itself, so opening here too gives a second tab.
  const claudeReceivesClicks = term.modes.mouseTrackingMode !== 'none';
  if (event.ctrlKey && !claudeReceivesClicks) window.api.openExternal(url);
}

const claudeCommandLine = /^\s*claude(\.exe)?(\s|$)/im;

let launchText = null;

function showLaunchButton(text) {
  launchText = text && claudeCommandLine.test(text) ? text : null;
  $('launch-selection').hidden = !launchText;
}

function updateLaunchButton() {
  const term = terminals.get(selectedId)?.term;
  showLaunchButton(term?.hasSelection() ? term.getSelection() : null);
}

// With mouse tracking on, Claude Code selects text itself and copies it on release; xterm never sees a selection.
async function watchAppSelection(id) {
  showLaunchButton(null);
  const released = new Promise((resolve) => window.addEventListener('mouseup', resolve, { once: true }));
  const { text: before } = await window.api.readClipboard();
  await released;
  await pause(300);
  const { text } = await window.api.readClipboard();
  if (id === selectedId && text !== before) showLaunchButton(text);
}

function copyFromOsc52(data) {
  const payload = data.slice(data.indexOf(';') + 1);
  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(payload);
  if (!isBase64) return true;
  const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  window.api.writeClipboard(new TextDecoder().decode(bytes));
  return true;
}

function launchSelection() {
  window.api.launchFromSelection(selectedId, launchText);
  terminals.get(selectedId)?.term.clearSelection();
  showLaunchButton(null);
}

function copyOrPaste(id, term) {
  if (!term.hasSelection()) return paste(id, term);
  window.api.writeClipboard(term.getSelection());
  term.clearSelection();
}

async function paste(id, term) {
  const { text, hasImage } = await window.api.readClipboard();
  if (text) term.paste(text);
  else if (hasImage) window.api.pasteImage(id);
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
  attentionIds.delete(id);
}

function select(id) {
  selectedId = id;
  $('placeholder').hidden = true;
  const entry = terminals.get(id) ?? createTerminal(id);
  terminals.forEach((other) => (other.host.hidden = other !== entry));
  entry.fit.fit();
  entry.term.focus();
  attentionIds.delete(id);
  if (!running.has(id)) start(id);
  updateLaunchButton();
  renderList();
}

function deselect() {
  selectedId = null;
  $('placeholder').hidden = false;
  updateLaunchButton();
}

function onStoreChanged(newStore) {
  store = newStore;
  const visibleIds = new Set(store.sessions.filter((s) => !s.archived).map((s) => s.id));
  [...terminals.keys()].filter((id) => !visibleIds.has(id)).forEach(disposeTerminal);
  if (selectedId && !visibleIds.has(selectedId)) deselect();
  $('default-cwd').value = store.defaultCwd;
  $('bypass-permissions').checked = Boolean(store.bypassPermissions);
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
  attentionIds.delete(id);
  terminals.get(id)?.term.write('\r\n\x1b[33m[Session beendet, Enter startet neu]\x1b[0m\r\n');
  renderList();
});
window.api.onListChanged(onStoreChanged);
window.api.onRenameRequested(startRename);
window.api.onEditTagsRequested(startEditTags);
window.api.onSelectRequested(select);
window.api.onRestartRequested((id) => {
  running.delete(id);
  select(id);
});
window.api.onBusyChanged(onBusyChanged);
window.addEventListener('focus', () => {
  if (selectedId) clearAttention(selectedId);
});

$('list-filter').addEventListener('input', renderList);
$('default-cwd').addEventListener('change', (e) => window.api.setDefaultCwd(e.target.value.trim()));
$('pick-default').addEventListener('click', async () => {
  const folder = await pickInto($('default-cwd'));
  if (folder) window.api.setDefaultCwd(folder);
});

$('launch-selection').addEventListener('click', launchSelection);

$('bypass-permissions').addEventListener('change', (e) => window.api.setBypassPermissions(e.target.checked));

$('new-session').addEventListener('click', () => {
  $('new-form').hidden = false;
  $('new-name').value = '';
  $('new-cwd').value = store.defaultCwd;
  $('new-cwd').setCustomValidity('');
  $('new-name').focus();
});
$('pick-new').addEventListener('click', async () => {
  if (await pickInto($('new-cwd'))) $('new-cwd').setCustomValidity('');
});
$('new-cwd').addEventListener('input', () => $('new-cwd').setCustomValidity(''));
$('cancel-new').addEventListener('click', () => {
  $('new-cwd').setCustomValidity('');
  $('new-form').hidden = true;
});
$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cwd = $('new-cwd').value.trim();
  const id = await window.api.create({ name: $('new-name').value.trim(), cwd });
  if (!id) {
    $('new-cwd').setCustomValidity(`Ordner nicht gefunden: ${cwd}`);
    $('new-cwd').reportValidity();
    return;
  }
  $('new-form').hidden = true;
  select(id);
});

new ResizeObserver(() => {
  if (selectedId) terminals.get(selectedId)?.fit.fit();
}).observe($('terminals'));

window.api.list().then(onStoreChanged);
