import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'bin', 'cli.js');

function run(args, env = {}, expectFail = false) {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...env } });
    return { out, code: 0 };
  } catch (e) {
    if (!expectFail) throw e;
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status };
  }
}

test('check exits 0 on the clean fixture, 1 on the bad fixture', () => {
  assert.equal(run(['check', join('examples', 'workflow.good.js')]).code, 0);
  const bad = run(['check', join('examples', 'workflow.bad.js')], {}, true);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /UC003/);
});

test('init refuses (does not write ~/.claude) when the plugin is already active', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'uc-cli-plugin-'));
  writeFileSync(join(tmp, 'settings.json'), JSON.stringify({ enabledPlugins: { 'ultracost@ultracost': true } }));
  const cache = join(tmp, 'plugins', 'cache', 'ultracost', 'ultracost', '0.3.0', 'hooks');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{}], PreToolUse: [{}] } }));

  const { out } = run(['init'], { CLAUDE_CONFIG_DIR: tmp });
  assert.match(out, /init skipped|already delivered/i);
  assert.ok(!existsSync(join(tmp, 'CLAUDE.md')), 'init must not write CLAUDE.md when the plugin delivers it');
});

test('init installs the CLI path on a clean config dir', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'uc-cli-clean-'));
  const { out } = run(['init'], { CLAUDE_CONFIG_DIR: tmp });
  assert.match(out, /ultracost init/);
  assert.ok(existsSync(join(tmp, 'CLAUDE.md')));
});

test('diff --ci emits a markdown cost table', () => {
  const a = join(tmpdir(), 'uc_a_' + Date.now() + '.js');
  const b = join(tmpdir(), 'uc_b_' + Date.now() + '.js');
  writeFileSync(a, "export default async ({agent}) => agent('plan', { model: 'opus' });");
  writeFileSync(b, "export default async ({agent}) => { await agent('plan', { model: 'opus' }); return agent('review', { model: 'opus' }); };");
  const { out } = run(['diff', a, b, '--ci']);
  assert.match(out, /## ultracost cost diff/);
  assert.match(out, /Δ tiered cost/);
});

test('explain prints a per-stage table', () => {
  const { out } = run(['explain', join('examples', 'workflow.good.js')]);
  assert.match(out, /reads-like/);
});
