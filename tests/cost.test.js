import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costFromUsage, sumUsage, modelPrice, totalTokens } from '../src/cost.js';
import { normalize } from '../src/policy.js';

const policy = normalize({}); // opus 5/25, sonnet 3/15; cache 0.1x / 1.25x

test('sumUsage adds every bucket, including nested cache_creation', () => {
  const s = sumUsage([
    { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200 },
    { input_tokens: 100, output_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 10 } }
  ]);
  assert.equal(s.input_tokens, 200);
  assert.equal(s.output_tokens, 100);
  assert.equal(s.cache_read_input_tokens, 200);
  assert.equal(s.cache_creation_input_tokens, 50);
});

test('costFromUsage applies cache multipliers', () => {
  // 1M input + 1M output at opus (5/25) = 5 + 25 = 30; + 1M cache_read * 5 * 0.1 = 0.5
  const usage = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 0 };
  const cost = costFromUsage(usage, policy.pricing.opus, policy);
  assert.ok(Math.abs(cost - 30.5) < 1e-6, `got ${cost}`);
});

test('modelPrice resolves aliases and dated ids', () => {
  assert.deepEqual(modelPrice('claude-opus-4-8', policy), policy.pricing.opus);
  assert.deepEqual(modelPrice('claude-sonnet-4-6-20250929', policy), policy.pricing.sonnet);
  assert.deepEqual(modelPrice('weird-unknown', policy), policy.pricing.opus); // default
});

test('totalTokens sums all buckets', () => {
  assert.equal(totalTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }), 10);
});
