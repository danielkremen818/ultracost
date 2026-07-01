// Remaining hook branches (spawned, so the grandchild's coverage is captured via the
// inherited NODE_V8_COVERAGE): reinject's fail-open fallback, and the workflow-gate's
// unparseable-stdin exit, budget denials (perRun / perDay), and estimate-unavailable
// fallback. Each uses a sandbox CLAUDE_CONFIG_DIR so the real ~/.claude is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(ROOT, 'templates', 'hooks', 'reinject.mjs');
const GATE = join(ROOT, 'templates', 'hooks', 'workflow-gate.mjs');

function sandboxWithPolicy(content) {
  const dir = mkdtempSync(join(tmpdir(), 'uc-hookcov-'));
  mkdirSync(join(dir, 'ultracost'), { recursive: true });
  writeFileSync(join(dir, 'ultracost', 'policy.json'), content);
  return dir;
}
// The hooks always exit 0 (they write a decision or stay silent), so no failure path
// to handle here — let execFileSync throw and fail the test loudly if that changes.
function spawn(bin, input, env = {}) {
  return execFileSync('node', [bin], { input, encoding: 'utf8', env: { ...process.env, ...env } });
}

const WF = (script) => JSON.stringify({ tool_name: 'Workflow', tool_input: { script } });
const SCRIPT = "agent('plan', { model: 'opus' }); agent('apply', { model: 'sonnet' });";
const budgetPolicy = (budget) => JSON.stringify({
  default: 'opus',
  tiers: { opus: { model: 'opus', effort: 'xhigh' }, sonnet: { model: 'sonnet', effort: 'high' } },
  budget
});

test('reinject fails open with a minimal reminder when the policy is invalid', () => {
  const dir = sandboxWithPolicy('{ broken json');
  const o = JSON.parse(spawn(HOOK, '{"source":"startup"}', { CLAUDE_CONFIG_DIR: dir }));
  assert.match(o.hookSpecificOutput.additionalContext, /route every agent\(\) stage/i);
});

test('gate exits silently on unparseable stdin', () => {
  assert.equal(spawn(GATE, 'not json at all', { ULTRACOST_GATE: '' }), '');
});

test('gate denies when the per-run budget is exceeded', () => {
  const dir = sandboxWithPolicy(budgetPolicy({ perRun: 0.0000001 }));
  const o = JSON.parse(spawn(GATE, WF(SCRIPT), { CLAUDE_CONFIG_DIR: dir, ULTRACOST_GATE: '' }));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /budget\.perRun/);
});

test('gate denies when the per-day budget is exceeded', () => {
  const dir = sandboxWithPolicy(budgetPolicy({ perDay: 0.0000001 }));
  const o = JSON.parse(spawn(GATE, WF(SCRIPT), { CLAUDE_CONFIG_DIR: dir, ULTRACOST_GATE: '' }));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /budget\.perDay/);
});

test('gate falls back to ask when the estimate cannot be computed', () => {
  const dir = sandboxWithPolicy('{ broken json');
  const o = JSON.parse(spawn(GATE, WF(SCRIPT), { CLAUDE_CONFIG_DIR: dir, ULTRACOST_GATE: '' }));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /cost estimate unavailable/);
});
