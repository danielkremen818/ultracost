// Remaining guard branches: readArgs EOF fallback (unterminated call), object
// shorthand options, single-statement loop fan-out, and the auditScripts per-code
// tally (banned / inherit / dynamic / wrong-tier / over-effort).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, stageList, auditScripts } from '../src/guard.js';
import { normalize } from '../src/policy.js';

const policy = normalize({});

test('analyze tolerates an unterminated agent() call (readArgs EOF fallback)', () => {
  const { stages } = analyze("agent('x', { model: 'opus' }", policy); // no closing ')'
  assert.equal(stages, 1);
});

test('object shorthand { model } reads as a dynamic pin (UC005)', () => {
  const { findings } = analyze('agent("x", { model })', policy);
  assert.ok(findings.some((f) => f.code === 'UC005'));
});

test('fixText inserts pins back-to-front across multiple fixable stages', async () => {
  const { fixText } = await import('../src/guard.js');
  const src = "agent('one');\nagent('two', {});\n"; // UC001 + UC002, two fixable sites
  const { text, count } = fixText(src, policy);
  assert.equal(count, 2);
  assert.equal((text.match(/model:/g) || []).length, 2);
});

test('a single-statement loop body marks the stage as fan-out', () => {
  const list = stageList("for (const x of items) agent('a', { model: 'opus' });");
  assert.equal(list.length, 1);
  assert.equal(list[0].fanout, true);
});

test('stageList flags an options-as-variable stage as dynamic (no literal pin)', () => {
  const list = stageList("agent('x', opts)"); // options passed as a bare variable
  assert.equal(list.length, 1);
  assert.equal(list[0].dynamicModel, true);
  assert.equal(list[0].model, null);
});

test('auditScripts tallies banned / inherit / dynamic / wrong-tier / over-effort', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-audit-'));
  const scripts = join(dir, 'workflows', 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'wf.js'), [
    "agent('a', { model: 'haiku' });",                                            // UC003 banned
    "agent('b', { model: 'inherit' });",                                          // UC004 inherit
    'agent("c", { model });',                                                     // UC005 dynamic
    "agent('design and architect the whole system carefully', { model: 'sonnet' });", // UC006 wrong-tier
    "agent('list files', { model: 'sonnet', effort: 'xhigh' });"                  // UC007 over-effort
  ].join('\n'));
  const { totals } = auditScripts(dir, policy);
  assert.ok(totals.banned >= 1, 'banned');
  assert.ok(totals.inherit >= 1, 'inherit');
  assert.ok(totals.dynamic >= 1, 'dynamic');
  assert.ok(totals.wrongTier >= 1, 'wrong-tier');
  assert.ok(totals.overEffort >= 1, 'over-effort');
});
