// Sandbox a fake ~/.claude via CLAUDE_CONFIG_DIR, then mutate it between calls to
// exercise every delivery verdict. Env must be set before importing detect.js (paths
// resolve CLAUDE_DIR at load), so the module is imported dynamically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'uc-detect-'));
process.env.CLAUDE_CONFIG_DIR = tmp;
process.env.NO_COLOR = '1';
const { detectDelivery } = await import('../src/detect.js');

const MARKER = '<!-- ultracost:start -->';
const SETTINGS = join(tmp, 'settings.json');
const CLAUDE_MD = join(tmp, 'CLAUDE.md');
const CACHE = join(tmp, 'plugins', 'cache', 'ultracost', 'ultracost', '0.3.0', 'hooks');

function reset() {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
}
const writeJson = (p, o) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(o)); };

const cliState = () => {
  writeFileSync(CLAUDE_MD, `# stuff\n${MARKER}\nrules\n<!-- ultracost:end -->\n`);
  writeJson(SETTINGS, { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node ~/.claude/ultracost/reinject.mjs' }] }] } });
};
const pluginState = (extra = {}) => {
  writeJson(SETTINGS, { enabledPlugins: { 'ultracost@ultracost': true }, ...extra });
  mkdirSync(CACHE, { recursive: true });
  writeJson(join(CACHE, 'hooks.json'), { hooks: { SessionStart: [{}], PreToolUse: [{}] } });
};

test('verdict none on an empty config dir', () => {
  reset();
  assert.equal(detectDelivery().verdict, 'none');
});

test('verdict cli when CLAUDE.md block + settings hook present', () => {
  reset();
  cliState();
  assert.equal(detectDelivery().verdict, 'cli');
});

test('verdict plugin when enabled + cache hooks present', () => {
  reset();
  pluginState();
  const d = detectDelivery();
  assert.equal(d.verdict, 'plugin');
  assert.equal(d.plugin.version, '0.3.0');
});

test('verdict both when plugin and cli are both active', () => {
  reset();
  // a single settings.json carrying BOTH the CLI hook and the plugin enablement
  writeFileSync(CLAUDE_MD, `# stuff\n${MARKER}\nrules\n<!-- ultracost:end -->\n`);
  writeJson(SETTINGS, {
    enabledPlugins: { 'ultracost@ultracost': true },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node ~/.claude/ultracost/reinject.mjs' }] }] }
  });
  mkdirSync(CACHE, { recursive: true });
  writeJson(join(CACHE, 'hooks.json'), { hooks: { SessionStart: [{}], PreToolUse: [{}] } });
  assert.equal(detectDelivery().verdict, 'both');
});

test('a stale cache without the enablement flag is NOT plugin', () => {
  reset();
  mkdirSync(CACHE, { recursive: true });
  writeJson(join(CACHE, 'hooks.json'), { hooks: { SessionStart: [{}], PreToolUse: [{}] } });
  assert.equal(detectDelivery().verdict, 'none');
});

test('bypass permission mode is surfaced', () => {
  reset();
  pluginState({ permissions: { defaultMode: 'bypassPermissions' } });
  const d = detectDelivery();
  assert.equal(d.bypass, true);
  assert.equal(d.permissionMode, 'bypassPermissions');
});

test('enablement via settings.local.json counts', () => {
  reset();
  writeJson(join(tmp, 'settings.local.json'), { enabledPlugins: { 'ultracost@ultracost': true } });
  mkdirSync(CACHE, { recursive: true });
  writeJson(join(CACHE, 'hooks.json'), { hooks: { SessionStart: [{}], PreToolUse: [{}] } });
  assert.equal(detectDelivery().verdict, 'plugin');
});
