import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runningAgents } from '../src/hud-agents.js';

const root = mkdtempSync(join(tmpdir(), 'uc-hud-agents-'));
const sid = 'sess1';
const parent = join(root, `${sid}.jsonl`);
const subDir = join(root, sid, 'subagents');
mkdirSync(subDir, { recursive: true });

const RUNNING_TID = 'toolu_running01';
const DONE_TID = 'toolu_done01';
const recent = () => new Date().toISOString();
const old = () => new Date(Date.now() - 600000).toISOString(); // 10 min ago

// Parent transcript: an assistant message with two Agent tool_use blocks, then a user
// message carrying a tool_result for only the completed one. The running Agent has no
// tool_result.
const asst = (blocks) => JSON.stringify({
  type: 'assistant', requestId: 'r1', timestamp: recent(),
  message: { role: 'assistant', id: 'm1', content: blocks }
});
const userResult = (tid) => JSON.stringify({
  type: 'user', timestamp: recent(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: 'ok' }] }
});
writeFileSync(parent, [
  asst([
    { type: 'tool_use', id: RUNNING_TID, name: 'Agent', input: {} },
    { type: 'tool_use', id: DONE_TID, name: 'Agent', input: {} }
  ]),
  userResult(DONE_TID)
].join('\n') + '\n');

// agent jsonl: first line carries the start timestamp; a later assistant line carries
// the model.
const agentLines = (ts, model) => [
  JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: 'go' } }),
  JSON.stringify({ type: 'assistant', timestamp: ts, message: { role: 'assistant', id: 'a1', model, usage: { input_tokens: 1, output_tokens: 1 } } })
].join('\n') + '\n';

// running regular subagent (no tool_result, recent)
writeFileSync(join(subDir, 'agent-run1.jsonl'), agentLines(recent(), 'claude-sonnet-4-6'));
writeFileSync(join(subDir, 'agent-run1.meta.json'),
  JSON.stringify({ agentType: 'general-purpose', description: 'Extract graph chunk', toolUseId: RUNNING_TID }));

// completed regular subagent (has tool_result -> not running)
writeFileSync(join(subDir, 'agent-done1.jsonl'), agentLines(recent(), 'claude-opus-4-8'));
writeFileSync(join(subDir, 'agent-done1.meta.json'),
  JSON.stringify({ agentType: 'general-purpose', description: 'Done work', toolUseId: DONE_TID }));

// stale regular subagent: running by signal (no tool_result) but old start -> dropped.
writeFileSync(join(subDir, 'agent-stale1.jsonl'), agentLines(old(), 'claude-opus-4-8'));
writeFileSync(join(subDir, 'agent-stale1.meta.json'),
  JSON.stringify({ agentType: 'general-purpose', description: 'Stale agent', toolUseId: 'toolu_stale01' }));

// workflow stage: journal has a started-without-result (running) and a started+result
// (completed). The running stage's agent jsonl is recent.
const wf = join(subDir, 'workflows', 'wf_x');
mkdirSync(wf, { recursive: true });
writeFileSync(join(wf, 'agent-wfrun.jsonl'), agentLines(recent(), 'claude-opus-4-8'));
writeFileSync(join(wf, 'agent-wfrun.meta.json'), JSON.stringify({ agentType: 'workflow-subagent' }));
writeFileSync(join(wf, 'agent-wfdone.jsonl'), agentLines(recent(), 'claude-sonnet-4-6'));
writeFileSync(join(wf, 'agent-wfdone.meta.json'), JSON.stringify({ agentType: 'workflow-subagent' }));
writeFileSync(join(wf, 'journal.jsonl'), [
  JSON.stringify({ type: 'started', key: 'v2:hashrun', agentId: 'wfrun' }),
  JSON.stringify({ type: 'started', key: 'v2:hashdone', agentId: 'wfdone' }),
  JSON.stringify({ type: 'result', key: 'v2:hashdone', agentId: 'wfdone', result: 'ok' })
].join('\n') + '\n');

test('runningAgents returns only the running subagent + running workflow stage', () => {
  const agents = runningAgents(parent, { now: Date.now() });
  const ids = agents.map((a) => `${a.kind}:${a.agentType}:${a.model}`).sort();
  assert.deepEqual(ids, [
    'subagent:general-purpose:claude-sonnet-4-6',
    'workflow-stage:workflow-subagent:claude-opus-4-8'
  ]);
});

test('running regular subagent has correct fields', () => {
  const agents = runningAgents(parent, { now: Date.now() });
  const a = agents.find((x) => x.kind === 'subagent');
  assert.equal(a.agentType, 'general-purpose');
  assert.equal(a.model, 'claude-sonnet-4-6');
  assert.equal(a.tier, 'sonnet');
  assert.equal(a.status, 'running');
  assert.equal(a.label, 'Extract graph');
  assert.ok(a.elapsedMs >= 0 && a.elapsedMs < 5000);
});

test('running workflow stage has correct fields', () => {
  const agents = runningAgents(parent, { now: Date.now() });
  const a = agents.find((x) => x.kind === 'workflow-stage');
  assert.equal(a.agentType, 'workflow-subagent');
  assert.equal(a.model, 'claude-opus-4-8');
  assert.equal(a.tier, 'opus');
  assert.equal(a.status, 'running');
});

test('completed agents (tool_result / journal result) are excluded', () => {
  const agents = runningAgents(parent, { now: Date.now() });
  assert.ok(!agents.some((a) => a.model === 'claude-opus-4-8' && a.kind === 'subagent')); // done1
  assert.ok(!agents.some((a) => a.model === 'claude-sonnet-4-6' && a.kind === 'workflow-stage')); // wfdone
});

test('stale agents past the age cutoff are dropped', () => {
  const agents = runningAgents(parent, { now: Date.now(), maxAgeMs: 120000 });
  assert.ok(!agents.some((a) => a.label === 'Stale agent'));
  // tighten the cutoff: even the recent ones drop
  assert.equal(runningAgents(parent, { now: Date.now(), maxAgeMs: 1 }).length, 0);
});

test('agents are sorted by start time descending', () => {
  // build a fresh fixture where two running subagents start at different times
  const r2 = mkdtempSync(join(tmpdir(), 'uc-hud-sort-'));
  const p2 = join(r2, 'sx.jsonl');
  const sd = join(r2, 'sx', 'subagents');
  mkdirSync(sd, { recursive: true });
  writeFileSync(p2, asst([
    { type: 'tool_use', id: 'tA', name: 'Agent', input: {} },
    { type: 'tool_use', id: 'tB', name: 'Agent', input: {} }
  ]) + '\n'); // no tool_results -> both running
  const tEarly = new Date(Date.now() - 30000).toISOString();
  const tLate = new Date(Date.now() - 2000).toISOString();
  writeFileSync(join(sd, 'agent-A.jsonl'), agentLines(tEarly, 'claude-opus-4-8'));
  writeFileSync(join(sd, 'agent-A.meta.json'), JSON.stringify({ agentType: 'early', toolUseId: 'tA' }));
  writeFileSync(join(sd, 'agent-B.jsonl'), agentLines(tLate, 'claude-sonnet-4-6'));
  writeFileSync(join(sd, 'agent-B.meta.json'), JSON.stringify({ agentType: 'late', toolUseId: 'tB' }));
  const agents = runningAgents(p2, { now: Date.now() });
  assert.equal(agents.length, 2);
  assert.equal(agents[0].agentType, 'late'); // newest first
  assert.equal(agents[1].agentType, 'early');
});

test('missing subagents dir -> []', () => {
  assert.deepEqual(runningAgents('/tmp/does-not-exist-xyz.jsonl', { now: Date.now() }), []);
  assert.deepEqual(runningAgents('', { now: Date.now() }), []);
});

// Workflow stages carry no description and a hashed journal key, so the label is derived from
// each stage's first prompt. Parallel stages share a long preamble (a frozen contract), so we
// strip the prefix shared with a sibling — what's left starts with the per-stage target file.
test('workflow stage labels are distinct: shared preamble stripped, file basename used', () => {
  const r = mkdtempSync(join(tmpdir(), 'uc-hud-wflabels-'));
  const p = join(r, 'wfs.jsonl');
  const sd = join(r, 'wfs', 'subagents');
  const wfd = join(sd, 'workflows', 'wf_y');
  mkdirSync(wfd, { recursive: true });
  writeFileSync(p, JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }) + '\n');

  // > MIN_SHARED_PREFIX (40) chars of identical preamble before the stages diverge.
  const preamble = 'CONTRACT — ALREADY DONE, do not modify activity-log.ts. HOW TO AUDIT: import addActivity. ';
  const mk = (id, content) => {
    writeFileSync(join(wfd, `agent-${id}.jsonl`), [
      JSON.stringify({ type: 'user', timestamp: recent(), message: { role: 'user', content } }),
      JSON.stringify({ type: 'assistant', timestamp: recent(), message: { role: 'assistant', model: 'claude-opus-4-8' } })
    ].join('\n') + '\n');
    writeFileSync(join(wfd, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'workflow-subagent' }));
  };
  mk('w1', preamble + 'bom.ts TASK: audit POST /refresh');
  mk('w2', preamble + 'services/secrets.ts TASK: audit the GET handler');
  // w3 shares no preamble and its content is a text-block array (not a bare string).
  mk('w3', [{ type: 'text', text: 'Register the 3 new action types in the frontend maps' }]);
  writeFileSync(join(wfd, 'journal.jsonl'), [
    JSON.stringify({ type: 'started', key: 'v2:h1', agentId: 'w1' }),
    JSON.stringify({ type: 'started', key: 'v2:h2', agentId: 'w2' }),
    JSON.stringify({ type: 'started', key: 'v2:h3', agentId: 'w3' })
  ].join('\n') + '\n');

  const labels = runningAgents(p, { now: Date.now() }).map((a) => a.label).sort();
  assert.deepEqual(labels, ['Register the 3 new', 'bom.ts', 'secrets.ts']);
});

// A regular Task subagent with no meta.description also falls back to a prompt-derived label
// (here a "<verb> <file-basename>" shape).
test('regular subagent with no description labels from its first prompt', () => {
  const r = mkdtempSync(join(tmpdir(), 'uc-hud-noDesc-'));
  const p = join(r, 'nd.jsonl');
  const sd = join(r, 'nd', 'subagents');
  mkdirSync(sd, { recursive: true });
  const TID = 'toolu_nd01';
  writeFileSync(p, JSON.stringify({
    type: 'assistant', timestamp: recent(),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: TID, name: 'Agent', input: {} }] }
  }) + '\n'); // no tool_result → running
  writeFileSync(join(sd, 'agent-nd.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: recent(), message: { role: 'user', content: 'Read the file at path: /tmp/x/a.js and extract TODOs' } }),
    JSON.stringify({ type: 'assistant', timestamp: recent(), message: { role: 'assistant', model: 'claude-sonnet-4-6' } })
  ].join('\n') + '\n');
  writeFileSync(join(sd, 'agent-nd.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: TID }));

  const agents = runningAgents(p, { now: Date.now() });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].label, 'Read a.js');
});
