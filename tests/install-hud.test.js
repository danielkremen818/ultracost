// setStatusLine/restoreStatusLine against a sandbox CLAUDE_CONFIG_DIR. paths.js
// resolves CLAUDE_DIR from env at import time, so set the env BEFORE the dynamic
// import. Never touches the real ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SB = mkdtempSync(join(tmpdir(), 'uc-hud-'));
process.env.CLAUDE_CONFIG_DIR = SB;
process.env.NO_COLOR = '1';
mkdirSync(join(SB, 'ultracost'), { recursive: true });

const { setStatusLine, restoreStatusLine } = await import('../src/install.js');
const { SETTINGS, STATUSLINE_BACKUP } = await import('../src/paths.js');

const readSettings = () => JSON.parse(readFileSync(SETTINGS, 'utf8'));
const writeSettings = (obj) => writeFileSync(SETTINGS, JSON.stringify(obj, null, 2) + '\n');
const isOurs = (sl) => sl?.command?.includes(' hud') && sl.command.includes('cli.js');

test('seeds a prior statusLine: set backs it up + writes ours, restore brings it back', () => {
  const prior = { type: 'command', command: 'echo my-old-statusline' };
  writeSettings({ statusLine: prior });

  assert.equal(setStatusLine(), 'replaced');
  assert.ok(existsSync(STATUSLINE_BACKUP), 'backup file written');
  assert.deepEqual(JSON.parse(readFileSync(STATUSLINE_BACKUP, 'utf8')).previous, prior);
  assert.ok(isOurs(readSettings().statusLine), 'settings.statusLine is ours');

  assert.equal(restoreStatusLine(), 'restored');
  assert.deepEqual(readSettings().statusLine, prior, 'prior restored');
  assert.ok(!existsSync(STATUSLINE_BACKUP), 'backup removed');
});

test('no prior statusLine: set then restore deletes statusLine', () => {
  writeSettings({});

  assert.equal(setStatusLine(), 'set');
  assert.ok(!existsSync(STATUSLINE_BACKUP), 'no backup when nothing to back up');
  assert.ok(isOurs(readSettings().statusLine), 'settings.statusLine is ours');

  assert.equal(restoreStatusLine(), 'removed');
  assert.ok(!('statusLine' in readSettings()), 'statusLine deleted');
});

test('user replaces statusLine after install: restore leaves it (kept)', () => {
  writeSettings({});
  assert.equal(setStatusLine(), 'set');

  // User swaps in their own statusLine post-install.
  const userSl = { type: 'command', command: 'echo user-took-over' };
  const s = readSettings();
  s.statusLine = userSl;
  writeSettings(s);

  assert.equal(restoreStatusLine(), 'kept');
  assert.deepEqual(readSettings().statusLine, userSl, 'user statusLine untouched');
});
