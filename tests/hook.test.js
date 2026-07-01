import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(ROOT, 'templates', 'hooks', 'reinject.mjs');
const GATE = join(ROOT, 'templates', 'hooks', 'workflow-gate.mjs');
const AUTORUN = join(ROOT, 'templates', 'hooks', 'loop-autorun.mjs');
const HUDSETUP = join(ROOT, 'templates', 'hooks', 'hud-setup.mjs');

function run(input) {
  const out = execFileSync('node', [HOOK], { input, encoding: 'utf8' });
  return JSON.parse(out);
}

function gate(input, env = {}) {
  return execFileSync('node', [GATE], { input, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('emits SessionStart additionalContext on startup source', () => {
  const o = run('{"source":"startup"}');
  assert.equal(o.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(o.hookSpecificOutput.additionalContext, /model routing|route every/i);
});

test('injects the policy regardless of source (compact)', () => {
  const o = run('{"source":"compact"}');
  assert.match(o.hookSpecificOutput.additionalContext, /haiku/);
  assert.match(o.hookSpecificOutput.additionalContext, /opus/);
  assert.match(o.hookSpecificOutput.additionalContext, /sonnet/);
});

test('still emits with empty/invalid stdin', () => {
  const o = run('');
  assert.ok(o.hookSpecificOutput.additionalContext.length > 0);
});

// ---- workflow-gate (default, hard PreToolUse cost gate) ----

const WORKFLOW_EVT = JSON.stringify({
  tool_name: 'Workflow',
  tool_input: { script: "agent('plan', { model: 'opus' }); agent('apply', { model: 'sonnet' });" }
});

test('gate asks (with estimate) before a Workflow launch', () => {
  const o = JSON.parse(gate(WORKFLOW_EVT));
  assert.equal(o.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(o.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /ultracost estimate:/);
});

test('gate surfaces the estimate via systemMessage (visible despite the ask-reason TUI bug)', () => {
  const o = JSON.parse(gate(WORKFLOW_EVT));
  assert.match(o.systemMessage, /ultracost estimate:/);
});

test('gate always asks on a Workflow launch even if the script is unreadable', () => {
  const o = JSON.parse(gate('{"tool_name":"Workflow","tool_input":{}}'));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'ask');
});

test('gate stays out of the way for non-Workflow tools', () => {
  assert.equal(gate('{"tool_name":"Read"}'), '');
});

test('ULTRACOST_GATE=off disables the gate', () => {
  assert.equal(gate(WORKFLOW_EVT, { ULTRACOST_GATE: 'off' }), '');
});

const UNPINNED_SCRIPT = "pipeline(items, (u) => agent('build ' + u), (b, u) => agent('verify ' + u));";
const PINNED_SCRIPT = "pipeline(items, (u) => agent('build ' + u, { model: 'sonnet' }));";
const UNPINNED_WF = JSON.stringify({ tool_name: 'Workflow', tool_input: { script: UNPINNED_SCRIPT } });
const wf = (script, permission_mode) =>
  JSON.stringify({ tool_name: 'Workflow', permission_mode, tool_input: { script } });
const decisionOf = (input, env) => JSON.parse(gate(input, env)).hookSpecificOutput.permissionDecision;

test('gate leads with a warning when stages are unpinned', () => {
  const o = JSON.parse(gate(UNPINNED_WF));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /NOT pinned/i);
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /inherit/i);
});

test('ULTRACOST_GATE=strict denies an unpinned workflow', () => {
  const o = JSON.parse(gate(UNPINNED_WF, { ULTRACOST_GATE: 'strict' }));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'deny');
});

test('ULTRACOST_GATE=strict still only asks when every stage is pinned', () => {
  const pinned = JSON.stringify({
    tool_name: 'Workflow',
    tool_input: { script: PINNED_SCRIPT }
  });
  const o = JSON.parse(gate(pinned, { ULTRACOST_GATE: 'strict' }));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'ask');
});

// ---- mode-aware default (no env): deny where an ask can't pause ----

test('unpinned + bypassPermissions auto-escalates to deny by default', () => {
  assert.equal(decisionOf(wf(UNPINNED_SCRIPT, 'bypassPermissions')), 'deny');
});

test('unpinned + dontAsk auto-escalates to deny by default', () => {
  assert.equal(decisionOf(wf(UNPINNED_SCRIPT, 'dontAsk')), 'deny');
});

test('unpinned + default mode asks (does not escalate)', () => {
  assert.equal(decisionOf(wf(UNPINNED_SCRIPT, 'default')), 'ask');
});

test('unpinned + acceptEdits / auto asks (does not escalate)', () => {
  assert.equal(decisionOf(wf(UNPINNED_SCRIPT, 'acceptEdits')), 'ask');
  assert.equal(decisionOf(wf(UNPINNED_SCRIPT, 'auto')), 'ask');
});

test('clean workflow + bypassPermissions asks (never denied)', () => {
  assert.equal(decisionOf(wf(PINNED_SCRIPT, 'bypassPermissions')), 'ask');
});

test('ULTRACOST_GATE=ask opts out of escalation (asks even in bypassPermissions)', () => {
  assert.equal(decisionOf(wf(UNPINNED_SCRIPT, 'bypassPermissions'), { ULTRACOST_GATE: 'ask' }), 'ask');
});

// ---- loop-autorun (Stop hook: closed loop on session end) ----

import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

function autorun(env = {}) {
  return execFileSync('node', [AUTORUN], { input: '{"hook_event_name":"Stop"}', encoding: 'utf8', env: { ...process.env, ...env } });
}

function wfFixture(cfg) {
  const wf = join(cfg, 'projects', 'proj', 's1', 'subagents', 'workflows', 'wf_demo');
  mkdirSync(wf, { recursive: true });
  const asst = (id, req, out, model) => JSON.stringify({
    type: 'assistant', requestId: req, timestamp: '2026-06-14T10:00:00Z',
    message: { role: 'assistant', id, model, usage: { input_tokens: 1000, output_tokens: out } }
  });
  writeFileSync(join(wf, 'agent-aaa.jsonl'), asst('m_a', 'rA', 500, 'claude-sonnet-4-6') + '\n');
  writeFileSync(join(wf, 'agent-bbb.jsonl'), asst('m_b', 'rB', 800, 'claude-opus-4-8') + '\n');
  writeFileSync(join(wf, 'journal.jsonl'), JSON.stringify({ key: 'plan', agentId: 'bbb' }) + '\n');
}

test('autorun no-ops (no output) when there are no workflow runs', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-autorun-'));
  assert.equal(autorun({ CLAUDE_CONFIG_DIR: cfg }), '');
});

test('autorun is disabled by ULTRACOST_AUTORUN=off', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-autorun-'));
  wfFixture(cfg);
  assert.equal(autorun({ CLAUDE_CONFIG_DIR: cfg, ULTRACOST_AUTORUN: 'off' }), '');
});

test('autorun reconciles a finished run, writes ledger+calibration, then no-ops next turn', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-autorun-'));
  wfFixture(cfg);

  const o = JSON.parse(autorun({ CLAUDE_CONFIG_DIR: cfg }));
  assert.match(o.systemMessage, /closed loop/i);
  assert.match(o.systemMessage, /saved/i);
  assert.ok(existsSync(join(cfg, 'ultracost', 'ledger.jsonl')), 'ledger persisted');
  assert.ok(existsSync(join(cfg, 'ultracost', 'calibration.json')), 'calibration persisted');

  // Same run already seen -> fast no-op (empty output) on the next turn.
  assert.equal(autorun({ CLAUDE_CONFIG_DIR: cfg }), '');
});

// ---- hud-setup (SessionStart hook: one-time HUD statusline auto-setup) ----

import { readFileSync as rf } from 'node:fs';

function hudSetup(env = {}) {
  return execFileSync('node', [HUDSETUP], { input: '{"source":"startup"}', encoding: 'utf8', env: { ...process.env, ...env } });
}

test('hud-setup sets the HUD statusLine on first run and writes a one-time marker', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-hudset-'));
  hudSetup({ CLAUDE_CONFIG_DIR: cfg, NO_COLOR: '1' });
  const settings = JSON.parse(rf(join(cfg, 'settings.json'), 'utf8'));
  assert.ok(settings.statusLine, 'statusLine written');
  assert.match(settings.statusLine.command, / hud/);
  assert.match(settings.statusLine.command, /cli\.js/);
  assert.ok(existsSync(join(cfg, 'ultracost', '.hud-autosetup')), 'one-time marker written');
});

test('hud-setup respects an existing statusLine by backing it up', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-hudset-'));
  mkdirSync(join(cfg), { recursive: true });
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo mine' } }));
  hudSetup({ CLAUDE_CONFIG_DIR: cfg, NO_COLOR: '1' });
  assert.ok(existsSync(join(cfg, 'ultracost', 'statusline-backup.json')), 'prior statusLine backed up');
});

test('hud-setup is one-time: a second run does not rewrite a user-removed statusLine', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-hudset-'));
  hudSetup({ CLAUDE_CONFIG_DIR: cfg, NO_COLOR: '1' });           // first run sets it
  const s = JSON.parse(rf(join(cfg, 'settings.json'), 'utf8'));
  delete s.statusLine;                                            // user removes it
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify(s));
  hudSetup({ CLAUDE_CONFIG_DIR: cfg, NO_COLOR: '1' });           // second run (marker present)
  assert.ok(!('statusLine' in JSON.parse(rf(join(cfg, 'settings.json'), 'utf8'))), 'not re-added');
});

test('hud-setup is disabled by ULTRACOST_HUD=off', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-hudset-'));
  hudSetup({ CLAUDE_CONFIG_DIR: cfg, ULTRACOST_HUD: 'off', NO_COLOR: '1' });
  assert.ok(!existsSync(join(cfg, 'settings.json')), 'no settings written when opted out');
});
