// classify.js edge: a custom alwaysOpus role (not in the built-in ROLE_SYNONYMS map)
// matches on its own long words, and the UC008 finding fires when such a role is
// pinned off the default tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semanticFindings } from '../src/classify.js';
import { normalize } from '../src/policy.js';
import { CODES } from '../src/guard.js';

test('a custom alwaysOpus role is matched by its own long words (UC008)', () => {
  const policy = normalize({ alwaysOpus: ['megablaster'] });
  const findings = semanticFindings(
    { model: 'sonnet', effort: null, prompt: 'run the megablaster stage now' },
    policy,
    CODES
  );
  assert.ok(findings.some((f) => f.code === CODES.ALWAYSOPUS));
});
