import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanText, stageList, CODES } from '../src/guard.js';
import { normalize, loadPolicy } from '../src/policy.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const p = normalize({});
const full = loadPolicy(join(ROOT, 'templates', 'policy.default.json')).policy;
const codes = (s, pol = p) => scanText(s, pol).map((f) => f.code);

test('dynamic model value is UC005, not a silent pass', () => {
  assert.deepEqual(codes(`agent('x', { model: getModel() })`), [CODES.DYNAMIC]);
  assert.deepEqual(codes(`agent('x', { model: foo })`), [CODES.DYNAMIC]);
});

test('a plain template literal model resolves like a string', () => {
  assert.deepEqual(codes('agent("x", { model: `sonnet` })'), []);
  assert.deepEqual(codes('agent("x", { model: `haiku` })'), [CODES.BANNED]);
});

test('spread without a literal model cannot be verified (UC005)', () => {
  assert.deepEqual(codes(`agent('x', { ...opts })`), [CODES.DYNAMIC]);
  assert.deepEqual(codes(`agent('x', { ...opts, model: 'opus' })`), []);
});

test('optional-call agent?.() is still detected', () => {
  assert.deepEqual(codes(`agent?.('x')`), [CODES.NOOPTS]);
  assert.deepEqual(codes(`agent?.('x', { model: 'opus' })`), []);
});

test('widened fan-out: forEach, for-of, Promise.all(map)', () => {
  assert.equal(stageList(`items.forEach(i => agent('x', { model: 'sonnet' }))`)[0].fanout, true);
  assert.equal(stageList(`for (const i of items) { agent('x', { model: 'sonnet' }); }`)[0].fanout, true);
  assert.equal(stageList(`await Promise.all(items.map(i => agent('x', { model: 'sonnet' })))`)[0].fanout, true);
  assert.equal(stageList(`agent('x', { model: 'sonnet' })`)[0].fanout, false);
});

test('UC006 flags a pin that mismatches the work', () => {
  assert.ok(codes(`agent('Refactor the parser and fix the bug', { model: 'sonnet' })`, full).includes(CODES.WRONGTIER));
  assert.ok(!codes(`agent('List the files in the repo', { model: 'sonnet' })`, full).includes(CODES.WRONGTIER));
});

test('UC007 flags effort over the model cap', () => {
  assert.ok(codes(`agent('x', { model: 'sonnet', effort: 'xhigh' })`, full).includes(CODES.OVEREFFORT));
  assert.ok(!codes(`agent('x', { model: 'opus', effort: 'xhigh' })`, full).includes(CODES.OVEREFFORT));
});

test('UC008 flags an alwaysOpus role pinned off-opus', () => {
  assert.ok(codes(`agent('Act as the orchestrator', { model: 'sonnet' })`, full).includes(CODES.ALWAYSOPUS));
});

test('the good dogfood fixture stays clean under the full policy (no semantic false positives)', () => {
  const src = readFileSync(join(ROOT, 'examples', 'workflow.good.js'), 'utf8');
  assert.deepEqual(scanText(src, full), []);
});

test('the deep-audit showcase example is guard-clean (no findings, incl. semantic warnings)', () => {
  const src = readFileSync(join(ROOT, 'examples', 'deep-audit.workflow.js'), 'utf8');
  assert.deepEqual(scanText(src, full), []);
});

test('the bad fixture exercises UC001-UC008', () => {
  const src = readFileSync(join(ROOT, 'examples', 'workflow.bad.js'), 'utf8');
  const found = new Set(scanText(src, full).map((f) => f.code));
  for (const code of Object.values(CODES)) assert.ok(found.has(code), `expected ${code} in workflow.bad.js`);
});
