import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Determinism contract for the whole suite:
//   - NO_COLOR → mono logo + no ANSI, so the plain-text snapshot is stable.
//   - CLAUDE_CONFIG_DIR points at an empty temp dir BEFORE importing hud.js, so paths.js
//     resolves LEDGER_PATH/POLICY_PATH under it: the ledger is empty ("tracking savings…")
//     and loadPolicy() falls back to the bundled default (perDay: null → no today bar).
//   - ULTRACOST_HUD_STATE_DIR is injected so frameIndex never touches the real tmp dir.
// Set env first, then dynamic-import the module under test.
process.env.NO_COLOR = '1';
const cfg = mkdtempSync(join(tmpdir(), 'uc-hud-cfg-'));
process.env.CLAUDE_CONFIG_DIR = cfg;
const stateDir = mkdtempSync(join(tmpdir(), 'uc-hud-state-'));

const { composeHud, frameIndex, fallbackLine, hudWorking } = await import('../src/hud.js');
const { displayWidth } = await import('../src/render.js');

const NOW = 1_700_000_000_000;

// A fixture session whose sibling subagents/ dir holds one running regular subagent and
// one running workflow stage (mirrors tests/hud-agents.test.js).
function makeSession() {
  const root = mkdtempSync(join(tmpdir(), 'uc-hud-sess-'));
  const sid = 'demo';
  const parent = join(root, `${sid}.jsonl`);
  const subDir = join(root, sid, 'subagents');
  mkdirSync(subDir, { recursive: true });

  const RUNNING_TID = 'toolu_running01';
  const startTs = new Date(NOW - 12000).toISOString(); // 12s ago
  const asst = JSON.stringify({
    type: 'assistant', timestamp: startTs,
    message: { role: 'assistant', id: 'm1', content: [{ type: 'tool_use', id: RUNNING_TID, name: 'Agent', input: {} }] }
  });
  writeFileSync(parent, asst + '\n'); // no tool_result → the Agent is running

  const agentLines = (ts, model) => [
    JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: 'go' } }),
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { role: 'assistant', id: 'a1', model } })
  ].join('\n') + '\n';

  writeFileSync(join(subDir, 'agent-run1.jsonl'), agentLines(startTs, 'claude-sonnet-4-6'));
  writeFileSync(join(subDir, 'agent-run1.meta.json'),
    JSON.stringify({ agentType: 'general-purpose', description: 'Extract graph chunk', toolUseId: RUNNING_TID }));

  const wf = join(subDir, 'workflows', 'wf_x');
  mkdirSync(wf, { recursive: true });
  const wfStart = new Date(NOW - 4000).toISOString(); // 4s ago
  // A workflow stage's meta carries no description and the journal key is a hash, so the HUD
  // derives the label from the stage's first prompt — here a leading file token → "clusters.ts".
  const wfPrompt = 'clusters.ts — audit mutating cluster handlers, add addActivity';
  writeFileSync(join(wf, 'agent-wfrun.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: wfStart, message: { role: 'user', content: wfPrompt } }),
    JSON.stringify({ type: 'assistant', timestamp: wfStart, message: { role: 'assistant', id: 'a1', model: 'claude-opus-4-8' } })
  ].join('\n') + '\n');
  writeFileSync(join(wf, 'agent-wfrun.meta.json'), JSON.stringify({ agentType: 'workflow-subagent' }));
  writeFileSync(join(wf, 'journal.jsonl'),
    JSON.stringify({ type: 'started', key: 'v2:hashrun', agentId: 'wfrun' }) + '\n');

  return { parent, sid };
}

// A busy session with N running regular subagents (each labeled "Task i"), for exercising the
// terminal-height-driven agent-row budget.
function makeBusySession(n) {
  const root = mkdtempSync(join(tmpdir(), 'uc-hud-busy-'));
  const sid = 'busy';
  const parent = join(root, `${sid}.jsonl`);
  const subDir = join(root, sid, 'subagents');
  mkdirSync(subDir, { recursive: true });
  const blocks = Array.from({ length: n }, (_, i) => ({ type: 'tool_use', id: `t${i}`, name: 'Agent', input: {} }));
  writeFileSync(parent, JSON.stringify({
    type: 'assistant', timestamp: new Date(NOW - 5000).toISOString(),
    message: { role: 'assistant', id: 'm1', content: blocks }
  }) + '\n'); // no tool_results → all running
  for (let i = 0; i < n; i++) {
    const ts = new Date(NOW - (i + 1) * 1000).toISOString();
    writeFileSync(join(subDir, `agent-x${i}.jsonl`), [
      JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: 'go' } }),
      JSON.stringify({ type: 'assistant', timestamp: ts, message: { role: 'assistant', model: 'claude-sonnet-4-6' } })
    ].join('\n') + '\n');
    writeFileSync(join(subDir, `agent-x${i}.meta.json`),
      JSON.stringify({ agentType: 'general-purpose', description: `Task ${i}`, toolUseId: `t${i}` }));
  }
  return parent;
}

const fixtureStdin = (transcriptPath) => ({
  session_id: 'demo',
  transcript_path: transcriptPath,
  model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8 (1M context)' },
  effort: { level: 'xhigh' },
  cost: { total_cost_usd: 0.21 },
  context_window: { used_percentage: 41, context_window_size: 1000000, current_usage: { input_tokens: 1400000 } }
});

const env = (extra = {}) => ({ ...process.env, ULTRACOST_HUD_STATE_DIR: stateDir, COLUMNS: '80', ...extra });

// Stored plain-text snapshot (NO_COLOR, frame 0, COLUMNS=80). Height is CONTENT-DRIVEN:
// the busy panel is 10 rows (savings/today/session/model + hr + running header + the two
// fixture agents) and the logo resamples DOWN to that height — no blank padding. The logo
// is mono + frame-independent; each logo line is padded to LOGO_FIXED_W so the (not shown at
// 80 cols) pipeline band would start at a stable column. At COLUMNS=80 there is room only for
// panel + logo (the band needs ≥ ~88 cols), so the third column is dropped per the ladder.
// The running region lists the two fixture agents newest-first (wf 4s, then subagent 12s).
const SNAPSHOT = [
  '╭─ ultracost ─────────────────────────╮         ▄██               ',
  '│ ↓ tracking savings…                 │         ▀█▀               ',
  '│ today $0.0000                       │  ▀███████████████▀        ',
  '│ session $0.2100 · 1.40M Tk          │    █████████████          ',
  '│ Opus 4.8 @ xhigh · ctx ███▎░░░░ 41% │   ▀█████████▀████         ',
  '│ ──────────────────────────────────  │   ▄▀███████████▀▄         ',
  '│ running · 2                         │    █████████▄███▀         ',
  '│ ● clusters.ts [wf] 4s               │      ██████████           ',
  '│ ● Extract graph [sonnet] 12s        │       ▀██████             ',
  '╰─────────────────────────────────────╯         ▀██               '
].join('\n');

test('composeHud matches the stored NO_COLOR snapshot', () => {
  const { parent } = makeSession();
  const out = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env() });
  assert.equal(out, SNAPSHOT);
});

test('every output line has equal displayWidth', () => {
  const { parent } = makeSession();
  const out = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env() });
  const widths = out.split('\n').map(displayWidth);
  assert.ok(widths.length > 1);
  assert.ok(widths.every((w) => w === widths[0]), `unequal widths: ${JSON.stringify(widths)}`);
});

test('composeHud is pure for a fixed frame', () => {
  const { parent } = makeSession();
  const stdin = fixtureStdin(parent);
  const a = composeHud(stdin, { now: NOW, frame: 7, env: env() });
  const b = composeHud(stdin, { now: NOW, frame: 7, env: env() });
  assert.equal(a, b);
});

test('truecolor render: every line equal width, no throw', () => {
  const { parent } = makeSession();
  const out = composeHud(fixtureStdin(parent), { now: NOW, frame: 3, env: env({ NO_COLOR: undefined, FORCE_COLOR: '3' }) });
  const widths = out.split('\n').map(displayWidth);
  assert.ok(widths.every((w) => w === widths[0]), `unequal widths: ${JSON.stringify(widths)}`);
});

test('malformed / empty stdin returns a non-empty string and never throws', () => {
  for (const bad of [null, undefined, {}, 'garbage', 42, [], { cost: null }, { transcript_path: 123 }]) {
    let out;
    assert.doesNotThrow(() => { out = composeHud(bad, { now: NOW, frame: 0, env: env() }); });
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0, `empty output for ${JSON.stringify(bad)}`);
  }
});

test('fallbackLine is non-empty and includes session cost when present', () => {
  assert.equal(fallbackLine(null), 'ultracost');
  assert.equal(fallbackLine({}), 'ultracost');
  assert.equal(fallbackLine({ cost: { total_cost_usd: 1.5 } }), 'ultracost · $1.5000');
});

test('idle session (no agents) shows the idle row', () => {
  const out = composeHud(fixtureStdin('/tmp/uc-hud-no-such.jsonl'), { now: NOW, frame: 0, env: env() });
  assert.match(out, /idle · no agents running/);
});

// ── content-driven height + third pipeline column (HUD v2) ──

test('wide COLUMNS adds the pipeline band as a third column', () => {
  const { parent } = makeSession();
  const out = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env({ COLUMNS: '120' }) });
  const lines = out.split('\n');
  const widths = lines.map(displayWidth);
  assert.ok(widths.every((w) => w === widths[0]), `unequal widths: ${JSON.stringify(widths)}`);
  // The band fills the width minus a 1-col right margin (reserved so Claude Code's statusline
  // never clips the band's last cell). Panel + logo alone would stop near col 63.
  assert.equal(widths[0], 119, `expected three-column output at COLUMNS-1, got ${widths[0]}`);
  // The mono pipeline silhouette appears (busy lanes render dotted ramps to the right).
  assert.match(out, /[·∙•]/u);
  // First lane is the newest agent (the workflow stage); its prompt-derived label shows (no clip).
  assert.match(lines[0], /clusters\.ts/u);
});

test('height is content-driven: idle HUD is shorter than the busy HUD', () => {
  const { parent } = makeSession(); // two running agents
  const busy = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env({ COLUMNS: '120' }) });
  const idle = composeHud(fixtureStdin('/tmp/uc-hud-none.jsonl'), { now: NOW, frame: 0, env: env({ COLUMNS: '120' }) });
  const busyRows = busy.split('\n').length;
  const idleRows = idle.split('\n').length;
  // Idle panel = savings/today/session/model + hr + idle-row = 8 lines (top+body+bottom).
  assert.equal(idleRows, 8, `idle HUD should be ~8 rows, got ${idleRows}`);
  // Busy adds the "running" header + two agent rows.
  assert.ok(busyRows > idleRows, `busy (${busyRows}) should be taller than idle (${idleRows})`);
});

test('busy 3-column layout is well-formed and full width (logo padded to fixed width)', () => {
  const { parent } = makeSession(); // running agents → the band renders
  const busy = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env({ COLUMNS: '120' }) }).split('\n');
  // Every row is COLUMNS − 1 wide (the band reserves the last column so Claude Code can't clip
  // it) and the layout is rectangular — so the logo, padded to a FIXED width, makes the band
  // begin at the same column on every row.
  assert.ok(busy.every((l) => displayWidth(l) === 119), `rows must be 119 wide: ${JSON.stringify(busy.map(displayWidth))}`);
  assert.ok(busy[0].indexOf('╮') > 0, 'panel box must render');
  // The band column renders content well beyond the panel + logo prefix (~col 65).
  assert.ok(busy.some((l) => /\S/.test(l.slice(70))), 'busy band must render content beyond panel+logo');
});

test('idle session drops the band column entirely (panel + logo only)', () => {
  const busy = composeHud(fixtureStdin(makeSession().parent), { now: NOW, frame: 0, env: env({ COLUMNS: '120' }) }).split('\n');
  const idle = composeHud(fixtureStdin('/tmp/uc-hud-none.jsonl'), { now: NOW, frame: 0, env: env({ COLUMNS: '120' }) }).split('\n');
  // Busy is full width (band present); idle is markedly narrower (no band column) with nothing
  // beyond the panel + logo — the band fills only while subagents work.
  assert.equal(displayWidth(busy[0]), 119, 'busy renders the full-width band');
  assert.ok(displayWidth(idle[0]) < displayWidth(busy[0]), 'idle must be narrower than busy (no band)');
  assert.ok(idle.every((l) => !/\S/.test(l.slice(70))), 'idle must have no band content beyond panel+logo');
});

test('busy fan-out fills the vertical space: >4 agents all show with a tall terminal', () => {
  const parent = makeBusySession(8);
  const out = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env({ COLUMNS: '120', LINES: '40' }) });
  const widths = out.split('\n').map(displayWidth);
  assert.ok(widths.every((w) => w === widths[0]), `unequal widths: ${JSON.stringify(widths)}`);
  assert.match(out, /running · 8/);
  // All eight agents are listed — no "+K more" when the terminal is tall enough.
  for (let i = 0; i < 8; i++) assert.match(out, new RegExp(`Task ${i}\\b`));
  assert.doesNotMatch(out, /\+\d+ more/, 'a tall terminal must not collapse agents into "+K more"');
});

test('busy fan-out collapses to "+K more" on a short terminal (budget = LINES − chrome)', () => {
  const parent = makeBusySession(8);
  const out = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env({ COLUMNS: '120', LINES: '14' }) });
  const widths = out.split('\n').map(displayWidth);
  assert.ok(widths.every((w) => w === widths[0]), `unequal widths: ${JSON.stringify(widths)}`);
  // LINES 14 → budget = 14 − 8 − 1 = 5 agent rows → 4 lanes + "+4 more".
  assert.match(out, /running · 8/);
  assert.match(out, /\+4 more/);
});

test('narrow COLUMNS drops the logo (panel only)', () => {
  const { parent } = makeSession();
  const out = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env({ COLUMNS: '45' }) });
  // panel-only: lines are the panel width (~39), not the wider side-joined width (~63).
  const widths = out.split('\n').map(displayWidth);
  assert.ok(widths.every((w) => w === widths[0]));
  assert.ok(widths[0] < 50, `panel-only line width should be < 50, got ${widths[0]}`);
  assert.match(out, /ultracost/);
  assert.match(out, /running · 2/);
});

test('very narrow COLUMNS collapses to a single compact line', () => {
  const { parent } = makeSession();
  const out = composeHud(fixtureStdin(parent), { now: NOW, frame: 0, env: env({ COLUMNS: '24' }) });
  assert.ok(!out.includes('\n'), 'compact line must be single-line');
  assert.match(out, /running · 2/);
});

test('hudWorking: true while a subagent runs, false when idle', () => {
  const { parent } = makeSession(); // fixture has two running agents
  const w1 = mkdtempSync(join(tmpdir(), 'uc-hud-w-'));
  assert.equal(hudWorking(fixtureStdin(parent), { env: { ULTRACOST_HUD_STATE_DIR: w1 }, now: NOW }), true);

  // No agents and no cost change across invocations → idle once the grace window lapses.
  const w2 = mkdtempSync(join(tmpdir(), 'uc-hud-w2-'));
  const idleStdin = { session_id: 'idle', transcript_path: '/tmp/uc-none.jsonl', cost: { total_cost_usd: 1 } };
  hudWorking(idleStdin, { env: { ULTRACOST_HUD_STATE_DIR: w2 }, now: NOW }); // seed prior cost
  assert.equal(hudWorking(idleStdin, { env: { ULTRACOST_HUD_STATE_DIR: w2 }, now: NOW + 10000 }), false);
});

test('frameIndex advances per session and wraps mod FRAMES', () => {
  const sub = mkdtempSync(join(tmpdir(), 'uc-hud-frame-'));
  const e = { ULTRACOST_HUD_STATE_DIR: sub };
  const a = frameIndex({ session_id: 's' }, { env: e });
  const b = frameIndex({ session_id: 's' }, { env: e });
  assert.equal(a, 0);
  assert.equal(b, 1);
  // a different session has an independent counter.
  assert.equal(frameIndex({ session_id: 'other' }, { env: e }), 0);
});
