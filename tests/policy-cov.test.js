// loadPolicy resolution edge cases: the "nothing resolvable" guard and the invalid-JSON
// error. Injectable policyPath/defaultPolicy let us exercise the empty-candidate path
// without removing the shipped default policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPolicy } from '../src/policy.js';

test('loadPolicy throws when no candidate path exists', () => {
  const missing = join(tmpdir(), 'uc-no-such-policy-' + Date.now() + '.json');
  assert.throws(
    () => loadPolicy(missing, { policyPath: missing + '.b', defaultPolicy: missing + '.c' }),
    /No policy found and bundled default is missing/
  );
});

test('loadPolicy throws a clear error on invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-pol-'));
  const bad = join(dir, 'policy.json');
  writeFileSync(bad, '{ not valid json');
  assert.throws(() => loadPolicy(bad), /not valid JSON/);
});

test('loadPolicy returns a normalized policy from an explicit path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-pol-'));
  const p = join(dir, 'policy.json');
  writeFileSync(p, JSON.stringify({ default: 'opus', tiers: { opus: { model: 'opus' } } }));
  const { policy, source } = loadPolicy(p);
  assert.equal(source, p);
  assert.equal(policy.default, 'opus');
  assert.ok(Array.isArray(policy.neverUse));
});
