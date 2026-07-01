// Sandbox CLAUDE_CONFIG_DIR so calibration.json / ledger.jsonl write into a temp dir,
// never the real ~/.claude. Dynamic import after setting the env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'uc-loop-'));
process.env.CLAUDE_CONFIG_DIR = tmp;
process.env.NO_COLOR = '1';

const { reconcileRun, calibrationFromRuns, ledgerSync, ledgerRead, spentToday } = await import('../src/loop.js');
const { normalize } = await import('../src/policy.js');

const policy = normalize({});
const stage = (model, inT, outT) => ({ model, usage: { input_tokens: inT, output_tokens: outT } });
const run = (wfId, model, n, when) => ({
  wfId, mtime: when ?? Date.now(), project: 'p',
  stages: Array.from({ length: n }, () => stage(model, 5000, 1000))
});

test('reconcileRun: a sonnet run costs less than the all-opus baseline', () => {
  const rec = reconcileRun(run('wf_a', 'claude-sonnet-4-6', 4), policy);
  assert.equal(rec.stages.length, 4);
  assert.ok(rec.totals.actual < rec.totals.allOpus);
  assert.ok(rec.totals.savedPct > 0);
});

test('calibrationFromRuns drops outliers before taking medians', () => {
  const runs = [run('wf_a', 'claude-opus-4-8', 6)];
  // inject a giant and a tiny stage as outliers
  runs[0].stages.push(stage('claude-opus-4-8', 5_000_000, 1_000_000));
  runs[0].stages.push(stage('claude-opus-4-8', 1, 0));
  const cal = calibrationFromRuns(runs, policy);
  assert.ok(cal);
  assert.ok(cal.droppedOutliers >= 1);
  assert.ok(cal.tokensPerStage.input > 0 && cal.tokensPerStage.output > 0);
});

test('ledgerSync is idempotent per wfId and persists', () => {
  const runs = [run('wf_a', 'claude-sonnet-4-6', 3, Date.parse('2026-06-14T00:00:00Z')), run('wf_b', 'claude-opus-4-8', 2, Date.parse('2026-06-10T00:00:00Z'))];
  const first = ledgerSync(runs, policy);
  const second = ledgerSync(runs, policy); // re-run must not double-count
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(ledgerRead().length, 2);
});

test('spentToday only counts entries dated today', () => {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [{ ts: today + 'T01:00:00Z', actual: 2.5 }, { ts: '2020-01-01T00:00:00Z', actual: 99 }];
  assert.equal(spentToday(entries), 2.5);
});
