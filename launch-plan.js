const fs = require('fs');
const os = require('os');
const path = require('path');

const isWindows = process.platform === 'win32';
const cdCommands = new Set(['cd', 'chdir', 'pushd', 'set-location']);
const nameOptions = new Set(['-n', '--name']);
const pwshCmdlet = /^[A-Z][a-z]+-[A-Z][A-Za-z]+$/;

function tokenize(line) {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(([, double, single, plain]) => double ?? single ?? plain);
}

const isFile = (file) => Boolean(fs.statSync(file, { throwIfNoEntry: false })?.isFile());

function isOnPath(name) {
  if (path.isAbsolute(name)) return isFile(name);
  if (name.includes('/') || name.includes('\\')) return false;
  const extensions = isWindows ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => extensions.some((ext) => isFile(path.join(dir, name + ext))));
}

const isClaude = (word) => /^claude(\.exe)?$/i.test(path.basename(word));
const isCd = (word) => cdCommands.has(word.toLowerCase());

// Selections mix prose with commands; a line counts as a command only if its first word is something the shell can run.
function isCommandLine(line) {
  const [first] = tokenize(line);
  return isCd(first) || isClaude(first) || pwshCmdlet.test(first) || isOnPath(first);
}

function cdTarget(args) {
  const target = args.filter((arg) => !arg.startsWith('-') && arg.toLowerCase() !== '/d').at(-1);
  return target?.replace(/^~(?=$|[\\/])/, os.homedir());
}

function splitName(args) {
  const index = args.findIndex((arg) => nameOptions.has(arg));
  if (index === -1 || index === args.length - 1) return { name: null, args };
  return { name: args[index + 1], args: args.filter((_arg, i) => i !== index && i !== index + 1) };
}

function launchPlan(selection, startCwd) {
  const commands = selection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && isCommandLine(line));
  const claudeIndex = commands.findLastIndex((line) => isClaude(tokenize(line)[0]));
  if (claudeIndex === -1) return null;
  const setup = commands.slice(0, claudeIndex);
  let cwd = startCwd;
  for (const line of setup) {
    const [command, ...args] = tokenize(line);
    const target = isCd(command) && cdTarget(args);
    if (target) cwd = path.resolve(cwd, target);
  }
  const { name, args } = splitName(tokenize(commands[claudeIndex]).slice(1));
  const needsSetup = setup.some((line) => !isCd(tokenize(line)[0]));
  return { cwd, name, claudeArgs: args, setup: needsSetup ? setup : [], claudeLine: commands[claudeIndex] };
}

function setupShell(commands) {
  if (!isWindows) return ['sh', ['-c', ['set -e', ...commands].join('\n')]];
  // $? is false after a failing native command in both Windows PowerShell and pwsh, so this stops at the first failure.
  const script = commands.map((command) => `${command}\nif (-not $?) { exit 1 }`).join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const shell = isOnPath('pwsh') ? 'pwsh.exe' : 'powershell.exe';
  return [shell, ['-NoProfile', '-NoLogo', '-EncodedCommand', encoded]];
}

module.exports = { launchPlan, setupShell };
