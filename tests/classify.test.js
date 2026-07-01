import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrompt, tierOfModel, semanticFindings } from '../src/classify.js';
import { normalize } from '../src/policy.js';
import { CODES } from '../src/guard.js';

const p = normalize({ alwaysOpus: ['orchestrator', 'consolidation'] });

test('leading imperative verb drives the tier', () => {
  assert.equal(classifyPrompt('List every file matching the plan glob', p).tier, 'sonnet');
  assert.equal(classifyPrompt('Design the migration architecture', p).tier, 'opus');
  assert.equal(classifyPrompt('Apply the planned edit to the file', p).tier, 'sonnet');
});

test('confidence is high only with a clear leading verb and margin', () => {
  assert.equal(classifyPrompt('Refactor the auth module', p).confidence, 'high');
  assert.equal(classifyPrompt('x', p).tier, null);
  assert.equal(classifyPrompt('x', p).confidence, 'none');
});

test('tierOfModel resolves aliases and dated ids', () => {
  assert.equal(tierOfModel('claude-opus-4-8'), 'opus');
  assert.equal(tierOfModel('claude-sonnet-4-6-20250929'), 'sonnet');
  assert.equal(tierOfModel('haiku'), 'haiku');
});

test('semanticFindings: wrong-tier, over-effort, alwaysOpus', () => {
  const wrong = semanticFindings({ model: 'sonnet', effort: null, prompt: 'Refactor and debug the parser' }, p, CODES);
  assert.ok(wrong.some((f) => f.code === CODES.WRONGTIER));

  const over = semanticFindings({ model: 'sonnet', effort: 'xhigh', prompt: 'List files' }, p, CODES);
  assert.ok(over.some((f) => f.code === CODES.OVEREFFORT));

  const role = semanticFindings({ model: 'sonnet', effort: null, prompt: 'Act as the orchestrator' }, p, CODES);
  assert.ok(role.some((f) => f.code === CODES.ALWAYSOPUS));
});

test('extra keywords from policy.classify are honored', () => {
  const pol = normalize({ classify: { keywords: { sonnet: ['frobnicate'] } } });
  assert.equal(classifyPrompt('Frobnicate the records', pol).tier, 'sonnet');
});

// "verify" (and validate/check/ensure/confirm/test) is ambiguous — its tier depends on what
// it acts on, resolved by the mechanical-vs-reasoning context, not a flat keyword.
test('ambiguous "verify" resolves to sonnet for mechanical work', () => {
  const c = classifyPrompt('Verify the tests pass and typecheck is clean', p);
  assert.equal(c.tier, 'sonnet');
  assert.equal(c.confidence, 'high');
});

test('ambiguous "verify" resolves to opus for reasoning work', () => {
  const c = classifyPrompt('Verify the new auth logic is correct and handles edge cases', p);
  assert.equal(c.tier, 'opus');
  assert.equal(c.confidence, 'high');
});

test('a context-free ambiguous verb stays low confidence (no false warning)', () => {
  const c = classifyPrompt('Verify the parser', p);
  assert.notEqual(c.confidence, 'high');
  // …so the guard does not flag a sonnet pin on it.
  const f = semanticFindings({ model: 'sonnet', effort: null, prompt: 'Verify the parser' }, p, CODES);
  assert.ok(!f.some((x) => x.code === CODES.WRONGTIER));
});

// The smarter classifier flags BOTH directions for verify stages: a mechanical verify pinned
// to opus is overpaying (→ sonnet), a correctness verify pinned to sonnet is underpowered (→ opus).
test('UC006 catches over- and under-powered verify pins', () => {
  const overpaid = semanticFindings(
    { model: 'opus', effort: null, prompt: 'Verify that the tests pass and lint is clean' }, p, CODES
  );
  assert.ok(overpaid.some((x) => x.code === CODES.WRONGTIER && /sonnet/.test(x.message)));

  const underpowered = semanticFindings(
    { model: 'sonnet', effort: null, prompt: 'Verify the refactor is correct and handles the edge cases' }, p, CODES
  );
  assert.ok(underpowered.some((x) => x.code === CODES.WRONGTIER && /opus/.test(x.message)));
});

// Multiword phrase signals catch context a bag-of-words misses.
test('phrase signals tip the tier (edge cases → opus, tests pass → sonnet)', () => {
  assert.equal(classifyPrompt('Confirm the change keeps backward-compat across edge cases', p).tier, 'opus');
  assert.equal(classifyPrompt('Make sure the tests pass after the rename', p).tier, 'sonnet');
});
