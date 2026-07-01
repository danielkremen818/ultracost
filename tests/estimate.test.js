import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/policy.js';
import { estimateText, priceKey } from '../src/estimate.js';
import { parsePrices, refreshPricing } from '../src/pricing.js';

const policy = normalize({});

// opus@xhigh  = 2000/1e6*5 + (1200*3   /1e6)*25 = 0.10
// sonnet@high = 2000/1e6*3 + (1200*1.8 /1e6)*15 = 0.0384
// opus@low    = 2000/1e6*5 + (1200*0.4 /1e6)*25 = 0.022

const MIXED = `
phase('Plan');
const a = await agent('plan', { model: 'opus', effort: 'xhigh' });
const b = await agent('list files', { model: 'sonnet' });
const c = await parallel(items.map(x => agent('scan ' + x, { model: 'sonnet' })));
const d = await agent('consolidate', { model: 'opus' });
`;

test('counts fixed stages and fan-out groups', () => {
  const e = estimateText(MIXED, policy);
  assert.equal(e.agents.known, 3);
  assert.equal(e.agents.fanoutGroups, 1);
  assert.equal(e.agents.assumedTotal, 3 + 5);
});

test('model mix weights fan-out by assumed item count', () => {
  const e = estimateText(MIXED, policy);
  assert.equal(e.modelMix.opus, 2);
  assert.equal(e.modelMix.sonnet, 6); // 1 fixed + 5 fan-out
});

test('computes baseline, tiered, savings deterministically', () => {
  const e = estimateText(MIXED, policy);
  assert.equal(e.cost.baseline, 0.8); // 8 agents x opus@xhigh 0.10
  assert.equal(e.cost.tiered, 0.4304); // 0.10 + 0.0384 + 5*0.0384 + 0.10
  assert.equal(e.cost.savings, 0.3696);
  assert.equal(e.cost.savingsPct, 46);
});

test('unpinned stages inherit the session model and save nothing', () => {
  const e = estimateText(`agent('x', { label: 'y' }); agent('z');`, policy);
  assert.equal(e.cost.savings, 0);
  assert.equal(e.cost.savingsPct, 0);
  assert.equal(e.modelMix.opus, 2);
});

test('lower effort lowers the tiered cost', () => {
  const e = estimateText(`agent('x', { model: 'opus', effort: 'low' });`, policy);
  assert.equal(e.cost.tiered, 0.022);
  assert.ok(e.cost.tiered < e.cost.baseline);
});

test('fan-out scales with assumedFanout option', () => {
  const e = estimateText(MIXED, policy, { assumedFanout: 10 });
  assert.equal(e.agents.assumedTotal, 3 + 10);
  assert.equal(e.modelMix.sonnet, 1 + 10);
});

test('a banned (haiku) pin is priced with haiku rates', () => {
  const e = estimateText(`agent('x', { model: 'haiku' });`, policy);
  assert.equal(e.modelMix.haiku, 1);
  assert.equal(priceKey('claude-haiku-4-5'), 'haiku');
});

test('agent( inside a prompt string is not counted', () => {
  const e = estimateText(`agent('you must call agent( with a model', { model: 'opus' });`, policy);
  assert.equal(e.agents.known, 1);
});

test('nested parallel array of thunks counts each as a fixed stage', () => {
  const e = estimateText(`await parallel([() => agent('a', {model:'opus'}), () => agent('b', {model:'sonnet'})]);`, policy);
  assert.equal(e.agents.known, 2);
  assert.equal(e.agents.fanoutGroups, 0);
});

test('pipeline(items, ...stages) counts each stage as a per-item fan-out', () => {
  const src = `
const out = await pipeline(
  UTILS,
  (u) => agent('build ' + u, { model: 'opus' }),
  (b, u) => agent('verify ' + u, { model: 'opus' }).then((v) => ({ b, v })),
  async ({ b, v }, u) => { return agent('fix ' + u, { model: 'opus' }); },
);`;
  const e = estimateText(src, policy);
  assert.equal(e.agents.known, 0); // none are fixed — all run per item
  assert.equal(e.agents.fanoutGroups, 3); // build, verify, fix
  assert.equal(e.agents.assumedTotal, 3 * 5); // 3 stages x assumedFanout
  assert.equal(e.modelMix.opus, 15);
});

test('zero stages yields zero cost', () => {
  const e = estimateText(`const x = 1; log('no agents here');`, policy);
  assert.equal(e.agents.known, 0);
  assert.equal(e.cost.baseline, 0);
  assert.equal(e.cost.savingsPct, 0);
});

// ---- pricing ----

const PAGE = [
  '| Claude Opus 4.8 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |',
  '| Claude Opus 4.8 (long context >200K) | $10 / MTok | $50 / MTok |',
  '| Claude Sonnet 4.6 | $3 / MTok | $3.75 | $6 | $0.30 | $15 / MTok |',
  '| Claude Haiku 4.5 | $1 / MTok | $1.25 | $2 | $0.10 | $5 / MTok |'
].join('\n');

test('parsePrices picks the standard rate row (most figures), not long-context', () => {
  const p = parsePrices(PAGE);
  assert.deepEqual(p.opus, { input: 5, output: 25 });
  assert.deepEqual(p.sonnet, { input: 3, output: 15 });
  assert.deepEqual(p.haiku, { input: 1, output: 5 });
});

test('refreshPricing uses injected fetch and stamps provenance', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => PAGE });
  const updated = await refreshPricing(policy, { url: 'https://example/pricing', fetchImpl });
  assert.deepEqual(updated.opus, { input: 5, output: 25 });
  assert.equal(updated._source, 'https://example/pricing');
  assert.match(updated._asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('refreshPricing throws on HTTP error (old prices kept by caller)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => refreshPricing(policy, { fetchImpl }));
});

test('refreshPricing throws if a model cannot be parsed', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => '| Claude Opus 4.8 | $5 | $25 |' });
  await assert.rejects(() => refreshPricing(policy, { fetchImpl }), /could not parse/);
});

test('refreshPricing rejects an implausible all-equal parse (bad HTML scrape)', async () => {
  const garbage = [
    '| Claude Opus 4.8 | $1 | $11 |',
    '| Claude Sonnet 4.6 | $1 | $11 |',
    '| Claude Haiku 4.5 | $1 | $11 |'
  ].join('\n');
  const fetchImpl = async () => ({ ok: true, text: async () => garbage });
  await assert.rejects(() => refreshPricing(policy, { fetchImpl }), /same price|implausible/);
});

test('refreshPricing rejects output <= input', async () => {
  const bad = [
    '| Claude Opus 4.8 | $25 | $5 |',
    '| Claude Sonnet 4.6 | $15 | $3 |',
    '| Claude Haiku 4.5 | $5 | $1 |'
  ].join('\n');
  const fetchImpl = async () => ({ ok: true, text: async () => bad });
  await assert.rejects(() => refreshPricing(policy, { fetchImpl }), /implausible/);
});
