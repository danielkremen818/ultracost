import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync
} from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, CLAUDE_DIR, CLAUDE_MD, SETTINGS, ULTRACOST_DIR, POLICY_PATH,
  HOOK_PATH, HOOK_SRC, LOOP_AUTORUN_SRC, DEFAULT_POLICY, STATUSLINE_BACKUP
} from './paths.js';
import { compileRules, replaceBlock, stripBlock } from './rules.js';

// Invoked via `node` so it needs no shebang, +x bit, or PATH entry.
const HOOK_COMMAND = `node "${HOOK_PATH}"`;
// The Stop autorun hook depends on sibling src/, so the CLI path runs it from the
// package directory rather than a relocated copy.
const LOOP_COMMAND = `node "${LOOP_AUTORUN_SRC}"`;

// null = file missing; undefined = present but invalid JSON.
export function readSettings() {
  if (!existsSync(SETTINGS)) return null;
  try {
    return JSON.parse(readFileSync(SETTINGS, 'utf8'));
  } catch {
    return undefined;
  }
}

const HOOK_MARKERS = ['ultracost', 'reinject.mjs', 'workflow-gate.mjs', 'loop-autorun.mjs', 'hud-setup.mjs'];
const isUltracostHook = (h) =>
  h.hooks?.some((hh) => typeof hh.command === 'string' && HOOK_MARKERS.some((m) => hh.command.includes(m)));

function ensureDirs() {
  for (const d of [CLAUDE_DIR, ULTRACOST_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function writePolicyFile(force) {
  if (existsSync(POLICY_PATH) && !force) return 'kept';
  copyFileSync(DEFAULT_POLICY, POLICY_PATH);
  return existsSync(POLICY_PATH) ? 'written' : 'failed';
}

function writeRules(policy) {
  const block = compileRules(policy);
  if (!existsSync(CLAUDE_MD)) {
    writeFileSync(CLAUDE_MD, block + '\n');
    return 'created';
  }
  const existing = readFileSync(CLAUDE_MD, 'utf8');
  const replaced = replaceBlock(existing, block);
  if (replaced !== null) {
    writeFileSync(CLAUDE_MD, replaced);
    return 'updated';
  }
  writeFileSync(CLAUDE_MD, existing.trimEnd() + '\n\n' + block + '\n');
  return 'appended';
}

function writeHook() {
  copyFileSync(HOOK_SRC, HOOK_PATH);
}

// Register both ultracost hooks (SessionStart policy injection + Stop closed-loop
// autorun) in a single settings read/write. Each is independent and idempotent.
function registerHooks() {
  const settings = readSettings();
  if (settings === undefined) return { session: 'invalid', stop: 'invalid' };
  const conf = settings ?? {};
  conf.hooks ??= {};
  conf.hooks.SessionStart ??= [];
  conf.hooks.Stop ??= [];
  const verb = settings === null ? 'created' : 'registered';
  const res = { session: 'present', stop: 'present' };
  let changed = false;
  if (!conf.hooks.SessionStart.some(isUltracostHook)) {
    conf.hooks.SessionStart.push({
      matcher: 'startup|resume|clear|compact',
      hooks: [{ type: 'command', command: HOOK_COMMAND }]
    });
    res.session = verb;
    changed = true;
  }
  if (!conf.hooks.Stop.some(isUltracostHook)) {
    conf.hooks.Stop.push({ hooks: [{ type: 'command', command: LOOP_COMMAND }] });
    res.stop = verb;
    changed = true;
  }
  if (changed) writeFileSync(SETTINGS, JSON.stringify(conf, null, 2) + '\n');
  return res;
}

// The statusLine command runs `hud` off either an absolute CLI path (cli/npx install)
// or a version-agnostic plugin-cache locator that survives plugin version bumps.
// FORCE_COLOR=3 (+ clearing any ambient NO_COLOR) is REQUIRED: Claude Code captures the
// statusline command's stdout into a pipe (not a TTY), so without it colorDepth() falls to
// 1 and the HUD renders as a gray monochrome silhouette instead of the truecolor mark.
function hudCommand(plugin) {
  const COLOR = 'env -u NO_COLOR FORCE_COLOR=3 ';
  if (plugin) {
    // Resolve the newest plugin-cache cli.js at render time so the statusLine survives
    // version bumps. If the plugin was uninstalled the glob is empty — guard with `[ -n ]`
    // so the statusLine prints nothing instead of erroring (no broken HUD after uninstall).
    return 'f=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/ultracost/ultracost/*/bin/cli.js 2>/dev/null | sort -V | tail -1); [ -n "$f" ] && ' + COLOR + 'node "$f" hud';
  }
  return `${COLOR}node "${join(ROOT, 'bin', 'cli.js')}" hud`;
}

// A statusLine is "ours" if its command both renders the HUD and runs our cli.
const isOurStatusLine = (sl) =>
  typeof sl?.command === 'string' && sl.command.includes(' hud') && sl.command.includes('cli.js');

export function setStatusLine({ plugin = false } = {}) {
  const settings = readSettings();
  if (settings === undefined) return 'invalid';
  const conf = settings ?? {};
  const command = hudCommand(plugin);
  const prior = conf.statusLine;

  let verdict;
  if (isOurStatusLine(prior)) {
    verdict = 'kept';
  } else if (prior) {
    // Back up a foreign statusLine so uninstall can restore exactly what was there.
    writeFileSync(STATUSLINE_BACKUP, JSON.stringify(
      { previous: prior, ours: command, ts: new Date().toISOString() }, null, 2
    ) + '\n');
    verdict = 'replaced';
  } else {
    verdict = 'set';
  }

  // refreshInterval re-runs the command ~1×/sec even when the session is idle, so the idle
  // logo animation keeps moving (event-driven triggers alone go quiet between messages).
  conf.statusLine = { type: 'command', command, padding: 0, refreshInterval: 1 };
  writeFileSync(SETTINGS, JSON.stringify(conf, null, 2) + '\n');
  return verdict;
}

export function restoreStatusLine() {
  const settings = readSettings();
  if (settings === undefined) return 'invalid';
  if (!settings?.statusLine) return 'absent';
  if (!isOurStatusLine(settings.statusLine)) return 'kept';

  const backup = existsSync(STATUSLINE_BACKUP) ? (() => {
    try { return JSON.parse(readFileSync(STATUSLINE_BACKUP, 'utf8')); } catch { return null; }
  })() : null;

  let verdict;
  if (backup?.previous) {
    settings.statusLine = backup.previous;
    verdict = 'restored';
  } else {
    delete settings.statusLine;
    verdict = 'removed';
  }
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  if (existsSync(STATUSLINE_BACKUP)) rmSync(STATUSLINE_BACKUP);
  return verdict;
}

export function install(policy, { force = false } = {}) {
  ensureDirs();
  const reg = registerHooks();
  return {
    policy: writePolicyFile(force),
    rules: writeRules(policy),
    hook: (writeHook(), 'installed'),
    register: reg.session,
    stop: reg.stop,
    statusLine: setStatusLine()
  };
}

export function uninstall() {
  const result = { rules: 'absent', hook: 'absent', register: 'absent', policy: 'absent', statusLine: 'absent' };

  if (existsSync(CLAUDE_MD)) {
    const content = readFileSync(CLAUDE_MD, 'utf8');
    if (content.includes('ultracost:start')) {
      const stripped = stripBlock(content);
      if (stripped) writeFileSync(CLAUDE_MD, stripped + '\n');
      else rmSync(CLAUDE_MD);
      result.rules = 'removed';
    }
  }
  if (existsSync(HOOK_PATH)) {
    rmSync(HOOK_PATH);
    result.hook = 'removed';
  }
  const settings = readSettings();
  if (settings === undefined) {
    result.register = 'invalid';
  } else if (settings?.hooks) {
    let changed = false;
    for (const evt of ['SessionStart', 'Stop']) {
      if (!Array.isArray(settings.hooks[evt])) continue;
      const before = settings.hooks[evt].length;
      settings.hooks[evt] = settings.hooks[evt].filter((h) => !isUltracostHook(h));
      if (settings.hooks[evt].length !== before) changed = true;
      if (settings.hooks[evt].length === 0) delete settings.hooks[evt];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    if (changed) {
      writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
      result.register = 'removed';
    }
  }
  // Restore the prior statusLine before removing ULTRACOST_DIR (the backup lives there).
  result.statusLine = restoreStatusLine();
  if (existsSync(ULTRACOST_DIR)) {
    rmSync(ULTRACOST_DIR, { recursive: true, force: true });
    result.policy = 'removed';
  }
  return result;
}
