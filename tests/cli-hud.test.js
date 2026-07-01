// In-process tests for the `ultracost hud` statusline command (src/cli.js cmdHud()).
// Mirrors tests/cli-run.test.js: sandbox CLAUDE_CONFIG_DIR so loadPolicy/ledger never
// touch the real ~/.claude, force NO_COLOR for deterministic plain-text output, and
// drive run([...]) directly. The HUD writes to process.stdout.write (it IS the
// statusline), so we capture that rather than console.log. We never pipe fd 0 in-process
// — the bare `hud` path is exercised via its TTY/fallback guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SB = mkdtempSync(join(tmpdir(), 'uc-hud-'));
process.env.CLAUDE_CONFIG_DIR = SB;
process.env.NO_COLOR = '1';
delete process.env.ULTRACOST_GATE;

const { run } = await import('../src/cli.js');

// Capture both console.log (notices) and process.stdout.write (the rendered HUD).
async function cap(args) {
  const origLog = console.log;
  const origWrite = process.stdout.write;
  let out = '';
  console.log = (m = '') => { out += m + '\n'; };
  process.stdout.write = (m = '') => { out += m; return true; };
  let code;
  try { code = await run(args); } finally {
    console.log = origLog;
    process.stdout.write = origWrite;
  }
  return { code, out };
}

test('hud --preview: exit 0 with a non-empty multi-line render', async () => {
  const { code, out } = await cap(['hud', '--preview']);
  assert.equal(code, 0);
  assert.ok(out.length > 0, 'preview should produce output');
  assert.ok(out.split('\n').filter((l) => l.length).length > 1, 'render should be multi-line');
});

test('hud (bare): exit 0 and never throws with no piped input (TTY/fallback guard)', async () => {
  // The test runner gives process.stdin an isTTY-ish handle; either way the bare path
  // must NOT block on fd 0 and must always exit 0 with a non-empty line.
  const { code, out } = await cap(['hud']);
  assert.equal(code, 0);
  assert.ok(out.length > 0, 'bare hud should always emit a line (never blank)');
});
