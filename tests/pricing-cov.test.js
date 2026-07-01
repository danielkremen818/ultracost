// pricing.js: parser, plausibility guard, refreshPricing (with an injected fetch so it
// never hits the network), and writePricingToPolicy against a temp policy file.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePrices, assertPlausible, refreshPricing, writePricingToPolicy } from '../src/pricing.js';
import { normalize } from '../src/policy.js';

const policy = normalize({});
const PAGE = [
  '| Model | Input | Cache write | Cache read | Output |',
  '| Claude Opus 4.8 | $5 | $6.25 | $0.50 | $25 |',
  '| Claude Sonnet 4.6 | $3 | $3.75 | $0.30 | $15 |',
  '| Claude Haiku 4.5 | $1 | $1.25 | $0.10 | $5 |'
].join('\n');
const fetchOf = (text = PAGE, status = 200, ok = true) => async () => ({ ok, status, text: async () => text });

test('parsePrices picks input (first) and output (last) from the richest row', () => {
  const p = parsePrices(PAGE);
  assert.deepEqual(p.opus, { input: 5, output: 25 });
  assert.deepEqual(p.sonnet, { input: 3, output: 15 });
  assert.deepEqual(p.haiku, { input: 1, output: 5 });
});

test('assertPlausible rejects output<=input and all-identical prices', () => {
  assert.throws(() => assertPlausible({ opus: { input: 25, output: 5 } }), /implausible/);
  assert.throws(() => assertPlausible({ a: { input: 1, output: 2 }, b: { input: 1, output: 2 } }), /same price/);
  // a single plausible model passes
  assert.doesNotThrow(() => assertPlausible({ opus: { input: 5, output: 25 } }));
});

test('refreshPricing returns a refreshed pricing block on success', async () => {
  const out = await refreshPricing(policy, { fetchImpl: fetchOf() });
  assert.equal(out.opus.input, 5);
  assert.equal(out.opus.output, 25);
  assert.match(out._asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('refreshPricing throws on an HTTP error', async () => {
  await assert.rejects(refreshPricing(policy, { fetchImpl: fetchOf('x', 503, false) }), /HTTP 503/);
});

test('refreshPricing throws when a model cannot be parsed', async () => {
  await assert.rejects(refreshPricing(policy, { fetchImpl: fetchOf('no prices here') }), /could not parse/);
});

test('refreshPricing refuses an oversized page', async () => {
  const huge = 'x'.repeat(2 * 1024 * 1024 + 1);
  await assert.rejects(refreshPricing(policy, { fetchImpl: fetchOf(huge) }), /too large/);
});

test('refreshPricing errors when no fetch implementation is available', async () => {
  await assert.rejects(refreshPricing(policy, { fetchImpl: null }), /no fetch available/);
});

test('refreshPricing arms an abort timer that fires on timeout', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let aborted = false;
    const fetchImpl = async (_url, opts) => {
      opts.signal.addEventListener('abort', () => { aborted = true; });
      mock.timers.tick(10_000); // trip the timeout → controller.abort()
      return { ok: true, status: 200, text: async () => PAGE };
    };
    const out = await refreshPricing(policy, { fetchImpl });
    assert.equal(aborted, true);
    assert.equal(out.opus.input, 5);
  } finally {
    mock.timers.reset();
  }
});

test('writePricingToPolicy writes the block and rejects a missing policy file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-price-'));
  const pf = join(dir, 'policy.json');
  writeFileSync(pf, JSON.stringify({ pricing: {} }));
  const written = writePricingToPolicy({ opus: { input: 5, output: 25 } }, pf);
  assert.equal(written, pf);
  assert.ok(JSON.parse(readFileSync(pf, 'utf8')).pricing.opus);
  assert.throws(() => writePricingToPolicy({}, join(dir, 'nope.json')), /no installed policy/);
});
