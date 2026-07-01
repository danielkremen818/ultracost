// Remaining install branches against a sandbox CLAUDE_CONFIG_DIR: writeRules' append
// path (CLAUDE.md exists but has no ultracost block) and uninstall's invalid-settings
// path. Never touches the real ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SB = mkdtempSync(join(tmpdir(), 'uc-install-'));
process.env.CLAUDE_CONFIG_DIR = SB;
process.env.NO_COLOR = '1';

const { install, uninstall } = await import('../src/install.js');
const { normalize } = await import('../src/policy.js');
const { CLAUDE_MD } = await import('../src/paths.js');

const policy = normalize({});

test('writeRules appends when CLAUDE.md exists without an ultracost block', () => {
  mkdirSync(SB, { recursive: true });
  writeFileSync(CLAUDE_MD, '# my personal notes\nkeep this\n');
  const r = install(policy, {});
  assert.equal(r.rules, 'appended');
  const md = readFileSync(CLAUDE_MD, 'utf8');
  assert.ok(md.includes('# my personal notes'), 'preserves existing content');
  assert.ok(md.includes('ultracost:start'), 'appends the managed block');
});

test('install registers a Stop closed-loop hook; uninstall removes it', () => {
  mkdirSync(SB, { recursive: true });
  writeFileSync(join(SB, 'settings.json'), JSON.stringify({}));

  const r = install(policy, {});
  assert.ok(['created', 'registered'].includes(r.stop), 'install reports the stop hook');
  const s = JSON.parse(readFileSync(join(SB, 'settings.json'), 'utf8'));
  assert.ok(
    s.hooks.Stop.some((h) => h.hooks.some((hh) => hh.command.includes('loop-autorun.mjs'))),
    'Stop hook registered in settings.json'
  );

  const u = uninstall();
  assert.equal(u.register, 'removed');
  const after = JSON.parse(readFileSync(join(SB, 'settings.json'), 'utf8'));
  assert.ok(!after.hooks || !after.hooks.Stop, 'Stop hook removed on uninstall');
});

test('uninstall reports register=invalid when settings.json is broken JSON', () => {
  writeFileSync(join(SB, 'settings.json'), '{ broken json');
  const r = uninstall();
  assert.equal(r.register, 'invalid');
});
