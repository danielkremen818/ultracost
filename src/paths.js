import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = homedir();
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Claude Code can relocate its config via CLAUDE_CONFIG_DIR; everything below
// hangs off it. ~/.claude/CLAUDE.md is the canonical global — ~/CLAUDE.md is not.
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR
  ? resolve(process.env.CLAUDE_CONFIG_DIR)
  : join(HOME, '.claude');
export const CLAUDE_MD = join(CLAUDE_DIR, 'CLAUDE.md');
export const SETTINGS = join(CLAUDE_DIR, 'settings.json');
export const SETTINGS_LOCAL = join(CLAUDE_DIR, 'settings.local.json');
export const ULTRACOST_DIR = join(CLAUDE_DIR, 'ultracost');
export const POLICY_PATH = join(ULTRACOST_DIR, 'policy.json');
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

// Local data the closed-loop commands persist (calibration priors + savings ledger).
export const CALIBRATION_PATH = join(ULTRACOST_DIR, 'calibration.json');
export const LEDGER_PATH = join(ULTRACOST_DIR, 'ledger.jsonl');

// Plugin delivery: Claude Code caches the plugin under plugins/cache/<owner>/<name>/<version>/.
export const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins');
export const PLUGIN_CACHE_DIR = join(PLUGINS_DIR, 'cache', 'ultracost', 'ultracost');
export const PLUGIN_ID = 'ultracost@ultracost';

export const HUD_STATE_DIR = join(tmpdir(), 'ultracost-hud');   // per-session HUD animation frame counters (ephemeral)
export const STATUSLINE_BACKUP = join(ULTRACOST_DIR, 'statusline-backup.json');  // prior statusLine saved on install, restored on uninstall

export const HOOK_PATH = join(ULTRACOST_DIR, 'reinject.mjs');

export const DEFAULT_POLICY = join(ROOT, 'templates', 'policy.default.json');
export const HOOK_SRC = join(ROOT, 'templates', 'hooks', 'reinject.mjs');
// The Stop autorun hook imports sibling src/, so the CLI path points at the package
// copy directly (it can't be relocated to ~/.claude/ultracost like reinject.mjs).
export const LOOP_AUTORUN_SRC = join(ROOT, 'templates', 'hooks', 'loop-autorun.mjs');

export const MARKER_START = '<!-- ultracost:start -->';
export const MARKER_END = '<!-- ultracost:end -->';

export const tilde = (p) => (p.startsWith(HOME) ? p.replace(HOME, '~') : p);

// Canonicalize a user-supplied filesystem path before it reaches any fs call.
// Rejects NUL-byte injection and resolves to an absolute, normalized path so any
// `..` segments are collapsed up front. The invoking user is the trust boundary for
// a local CLI, but routing every user-supplied path through this single choke point
// removes traversal ambiguity and keeps the fs surface auditable.
export function safePath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new Error('invalid path argument');
  }
  return resolve(input);
}
