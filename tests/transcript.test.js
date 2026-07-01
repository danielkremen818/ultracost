import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscripts, locateWorkflowRuns, parseUsageLine, dedupe, classifyTranscriptFile } from '../src/transcript.js';

const root = mkdtempSync(join(tmpdir(), 'uc-transcript-'));

const asst = (id, req, out, model = 'claude-opus-4-8') => JSON.stringify({
  type: 'assistant', requestId: req, isSidechain: false, timestamp: '2026-06-14T10:00:00Z',
  message: { role: 'assistant', id, model, usage: { input_tokens: 100, output_tokens: out } }
});

// main session, with a duplicate of msg_01 (higher output should win)
mkdirSync(join(root, 'proj'), { recursive: true });
writeFileSync(join(root, 'proj', 'sess1.jsonl'),
  [asst('msg_01', 'req1', 50), asst('msg_01', 'req1', 60), '{"type":"user"}'].join('\n') + '\n');

// a dynamic-workflow run: two stage files + a journal mapping agentId -> stage key
const wf = join(root, 'proj', '2c16fbc3', 'subagents', 'workflows', 'wf_test');
mkdirSync(wf, { recursive: true });
writeFileSync(join(wf, 'agent-aaa.jsonl'), asst('msg_a', 'rA', 200, 'claude-sonnet-4-6') + '\n');
writeFileSync(join(wf, 'agent-bbb.jsonl'), asst('msg_b', 'rB', 300, 'claude-opus-4-8') + '\n');
writeFileSync(join(wf, 'agent-aaa.meta.json'), JSON.stringify({ agentType: 'workflow-subagent' }));
writeFileSync(join(wf, 'journal.jsonl'),
  [JSON.stringify({ type: 'started', key: 'v2:hash1', agentId: 'aaa' }),
   JSON.stringify({ type: 'started', key: 'v2:hash2', agentId: 'bbb' })].join('\n') + '\n');

test('parseUsageLine accepts assistant usage lines, rejects others', () => {
  assert.ok(parseUsageLine(asst('m', 'r', 1)));
  assert.equal(parseUsageLine('{"type":"user"}'), null);
  assert.equal(parseUsageLine('not json'), null);
});

test('dedupe collapses same id+requestId, keeping the higher-output copy', () => {
  const kept = dedupe([
    { id: 'm', requestId: 'r', usage: { output_tokens: 5 } },
    { id: 'm', requestId: 'r', usage: { output_tokens: 9 } },
    { id: null, usage: { output_tokens: 1 } }
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].usage.output_tokens, 9);
});

test('classifyTranscriptFile separates main / workflow-stage by path', () => {
  const main = classifyTranscriptFile(join(root, 'proj', 'sess1.jsonl'), root);
  assert.equal(main.kind, 'main');
  const stage = classifyTranscriptFile(join(wf, 'agent-aaa.jsonl'), root);
  assert.equal(stage.kind, 'workflow-stage');
  assert.equal(stage.wfId, 'wf_test');
  assert.equal(stage.agentId, 'aaa');
});

test('readTranscripts classifies and globally dedupes', () => {
  const recs = readTranscripts({ root });
  const main = recs.filter((r) => r.kind === 'main');
  const stages = recs.filter((r) => r.kind === 'workflow-stage');
  assert.equal(main.length, 1); // duplicate collapsed
  assert.equal(main[0].usage.output_tokens, 60);
  assert.equal(stages.length, 2);
});

test('locateWorkflowRuns groups stages with journal stage keys', () => {
  const runs = locateWorkflowRuns({ root });
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.equal(run.wfId, 'wf_test');
  assert.equal(run.stages.length, 2);
  const aaa = run.stages.find((s) => s.agentId === 'aaa');
  assert.equal(aaa.stageKey, 'v2:hash1');
  assert.equal(aaa.model, 'claude-sonnet-4-6');
  assert.equal(aaa.usage.output_tokens, 200);
});
