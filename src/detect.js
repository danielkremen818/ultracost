import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLAUDE_MD, SETTINGS, SETTINGS_LOCAL, HOOK_PATH, POLICY_PATH,
  PLUGIN_CACHE_DIR, PLUGIN_ID, MARKER_START
} from './paths.js';

// How ultracost is actually wired into Claude Code. The plugin ships its hooks via
// plugins/cache/<owner>/<name>/<version>/hooks/hooks.json (resolved with
// ${CLAUDE_PLUGIN_ROOT}); the legacy npm CLI writes ~/.claude/CLAUDE.md + a
// SessionStart hook in settings.json. status/doctor/init read this so they stop
// reporting the plugin as "off" and refuse to double-install.

const BYPASS_MODES = new Set(['bypassPermissions', 'dontAsk']);

// null = file absent; undefined = present but invalid JSON.
function readJson(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return undefined; }
}

const pluginEnabledIn = (s) => !!(s && s.enabledPlugins && s.enabledPlugins[PLUGIN_ID]);

const hookHasUltracost = (s) =>
  Array.isArray(s?.hooks?.SessionStart) &&
  s.hooks.SessionStart.some((h) => h.hooks?.some((hh) => typeof hh.command === 'string' && hh.command.includes('ultracost')));

function pluginCache() {
  if (!existsSync(PLUGIN_CACHE_DIR)) return { cacheDir: null, version: null, hooks: { sessionStart: false, preToolUse: false } };
  let versions;
  try { versions = readdirSync(PLUGIN_CACHE_DIR).filter((v) => !v.startsWith('.')); } catch { versions = []; }
  if (!versions.length) return { cacheDir: null, version: null, hooks: { sessionStart: false, preToolUse: false } };
  const version = versions.sort().at(-1);
  const cacheDir = join(PLUGIN_CACHE_DIR, version);
  const hj = readJson(join(cacheDir, 'hooks', 'hooks.json'));
  return {
    cacheDir,
    version,
    hooks: { sessionStart: !!hj?.hooks?.SessionStart, preToolUse: !!hj?.hooks?.PreToolUse }
  };
}

export function detectDelivery(env = process.env) {
  const settings = readJson(SETTINGS);
  const local = readJson(SETTINGS_LOCAL);

  const enabledIn = [];
  if (pluginEnabledIn(settings)) enabledIn.push('settings.json');
  if (pluginEnabledIn(local)) enabledIn.push('settings.local.json');

  const cache = pluginCache();
  const plugin = {
    enabled: enabledIn.length > 0,
    enabledIn,
    cacheDir: cache.cacheDir,
    version: cache.version,
    hooks: cache.hooks,
    // Require BOTH enablement and the cached hooks — a stale cache after /plugin
    // uninstall must not read as active.
    ok: enabledIn.length > 0 && cache.hooks.sessionStart && cache.hooks.preToolUse
  };

  const rules = existsSync(CLAUDE_MD) && readFileSync(CLAUDE_MD, 'utf8').includes(MARKER_START);
  const settingsHook = hookHasUltracost(settings) || hookHasUltracost(local);
  const cli = {
    rules,
    hook: existsSync(HOOK_PATH),
    settingsHook,
    policy: existsSync(POLICY_PATH),
    ok: rules && settingsHook
  };

  const perm = { ...(settings?.permissions || {}), ...(local?.permissions || {}) };
  const permissionMode = perm.defaultMode;
  const skipDangerous = !!(
    perm.skipDangerousModePermissionPrompt ??
    settings?.skipDangerousModePermissionPrompt ??
    local?.skipDangerousModePermissionPrompt
  );

  const verdict = plugin.ok && cli.ok ? 'both' : plugin.ok ? 'plugin' : cli.ok ? 'cli' : 'none';

  return {
    verdict,
    plugin,
    cli,
    permissionMode,
    skipDangerous,
    bypass: BYPASS_MODES.has(permissionMode) || skipDangerous,
    gateEnv: env.ULTRACOST_GATE,
    settingsInvalid: settings === undefined || local === undefined
  };
}
