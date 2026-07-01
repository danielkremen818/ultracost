import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, classifyModel } from '../src/policy.js';
import { scanText, fixText, analyze, CODES } from '../src/guard.js';
import { compileRules } from '../src/rules.js';

const policy = normalize({}); // quality-first defaults: never haiku, default opus

const codesOf = (text) => scanText(text, policy).map((f) => f.code);

test('flags a stage with no options object', () => {
  const f = scanText(`agent('refactor the parser')`, policy);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, CODES.NOOPTS);
  assert.equal(f[0].severity, 'error');
});

test('flags an options object that omits model', () => {
  assert.deepEqual(codesOf(`agent('x', { effort: 'high' })`), [CODES.MISSING]);
});

test('flags a banned model by alias and by full id', () => {
  assert.deepEqual(codesOf(`agent('x', { model: 'haiku' })`), [CODES.BANNED]);
  assert.deepEqual(codesOf(`agent('x', { model: 'claude-haiku-4-5' })`), [CODES.BANNED]);
});

test('flags inherit when allowInherit is false', () => {
  assert.deepEqual(codesOf(`agent('x', { model: 'inherit' })`), [CODES.INHERIT]);
});

test('passes stages that pin an allowed model', () => {
  assert.deepEqual(codesOf(`agent('x', { model: 'opus' })`), []);
  assert.deepEqual(codesOf(`agent('x', { model: 'sonnet', effort: 'high' })`), []);
});

test('warns (not errors) on dynamic options variable', () => {
  const f = scanText(`agent('x', opts)`, policy);
  assert.equal(f[0].code, CODES.DYNAMIC);
  assert.equal(f[0].severity, 'warn');
});

test('handles nested parens and multiline args', () => {
  const src = `await agent(\n  buildTask(file, ctx),\n  { model: 'sonnet' }\n)`;
  assert.deepEqual(scanText(src, policy), []);
});

test('does not match subagent / myagent / obj.agent', () => {
  assert.deepEqual(codesOf(`subagent('x'); myagent('y'); obj.agent('z')`), []);
});

test('reports correct line numbers across a script', () => {
  const src = [
    `const a = agent('plan', { model: 'opus' });`,
    `const b = agent('sweep');`
  ].join('\n');
  const f = scanText(src, policy);
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 2);
});

test('fixText inserts the default model into a model-less object', () => {
  const { text, count } = fixText(`agent('x', { effort: 'high' })`, policy);
  assert.equal(count, 1);
  assert.match(text, /model: 'opus'/);
  assert.deepEqual(scanText(text, policy), []);
});

test('fixText wraps a single-argument call', () => {
  const { text, count } = fixText(`agent('do the thing')`, policy);
  assert.equal(count, 1);
  assert.match(text, /\{ model: 'opus' \}/);
  assert.deepEqual(scanText(text, policy), []);
});

test('classifyModel respects neverUse and inherit', () => {
  assert.equal(classifyModel('haiku', policy), 'banned');
  assert.equal(classifyModel('inherit', policy), 'inherit');
  assert.equal(classifyModel('opus', policy), 'ok');
});

test('compileRules emits a marked block that bans haiku', () => {
  const block = compileRules(policy);
  assert.match(block, /ultracost:start/);
  assert.match(block, /ultracost:end/);
  assert.match(block, /haiku/);
  assert.match(block, /ultracode/i);
});

test('normalize rejects a default tier that is not defined', () => {
  assert.throws(() => normalize({ default: 'ghost', tiers: { opus: { model: 'opus' } } }));
});

test('normalize rejects a tier whose model is banned', () => {
  assert.throws(() => normalize({ neverUse: ['haiku'], tiers: { x: { model: 'haiku' }, opus: { model: 'opus' } }, default: 'opus' }));
});

test('thunk wrapper () => agent(...) is scanned', () => {
  assert.deepEqual(codesOf(`const t = () => agent('plan');`), [CODES.NOOPTS]);
  assert.deepEqual(codesOf(`const t = () => agent('plan', { model: 'opus' });`), []);
});

test('.map(x => agent(...)) fan-out is scanned per call', () => {
  assert.deepEqual(codesOf(`files.map((f) => agent('do ' + f, { model: 'sonnet' }))`), []);
  assert.deepEqual(codesOf(`files.map((f) => agent('do ' + f))`), [CODES.NOOPTS]);
});

test('pipeline(items, ...stages) agent stages are scanned and flagged when unpinned', () => {
  const src = `pipeline(items, (u) => agent('build ' + u), (b, u) => agent('verify ' + u, { model: 'opus' }))`;
  assert.deepEqual(codesOf(src), [CODES.NOOPTS]); // first stage unpinned, second pinned
});

test('agent(...).then(...) chain is scanned', () => {
  assert.deepEqual(codesOf(`agent('x', { model: 'opus' }).then((r) => r)`), []);
  assert.deepEqual(codesOf(`agent('x').then((r) => r)`), [CODES.NOOPTS]);
});

test('a prompt string that contains agent( is not flagged', () => {
  assert.deepEqual(codesOf(`const p = 'first call agent(foo) then stop';`), []);
  assert.deepEqual(codesOf(`const p = "wrap agent('x') in a tool";`), []);
  assert.deepEqual(codesOf('const p = `please call agent(x) now`;'), []);
});

test('agent( inside a comment is not flagged', () => {
  assert.deepEqual(codesOf(`// agent('x') is only a note`), []);
  assert.deepEqual(codesOf(`/* agent('x') */`), []);
});

test('a real call survives even when its own prompt mentions agent(', () => {
  assert.deepEqual(scanText(`agent('call agent( inside the prompt', { model: 'opus' })`, policy), []);
  assert.deepEqual(codesOf(`agent('call agent( inside the prompt')`), [CODES.NOOPTS]);
});

test('analyze counts real stages and ignores agent( in strings/comments', () => {
  const src = [
    `const p = 'mentions agent( here';   // agent('nope')`,
    `await agent('plan', { model: 'opus' });`,
    `await agent('apply');`,
    `/* agent('also nope') */`
  ].join('\n');
  const { stages, findings } = analyze(src, policy);
  assert.equal(stages, 2);
  assert.deepEqual(findings.map((f) => f.code), [CODES.NOOPTS]);
});

test('fixText leaves agent( inside a string untouched', () => {
  const src = `const p = 'see agent( here';\nagent('real', { effort: 'high' });`;
  const { text, count } = fixText(src, policy);
  assert.equal(count, 1);
  assert.match(text, /'see agent\( here'/);
  assert.deepEqual(scanText(text, policy), []);
});
