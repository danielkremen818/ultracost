#!/usr/bin/env node
// Local animated preview of the ultracost HUD — watch the new subagent-pipeline band live.
//
// Drives the REAL composeHud() against a throwaway transcript fixture, so the band
// (src/hud-pipeline.js), the pixel logo, and the panel render EXACTLY as they will inside
// Claude Code. The animation is wall-clock driven, so the comet particles actually flow;
// the preview cycles idle (ambient drift) <-> busy (auto-scaled swimlanes) so you see both.
//
//   node scripts/hud-preview.mjs            # live animation in your terminal — Ctrl-C to quit
//   node scripts/hud-preview.mjs --smoke    # render a few static frames + widths, then exit
//   COLUMNS=140 node scripts/hud-preview.mjs   # force a width (else auto-detects the terminal)
//
// The fixture lives in a temp dir and is removed on exit. Nothing in the repo is touched.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { composeHud } from '../src/hud.js';

const SMOKE = process.argv.includes('--smoke');
const ROOT = join(tmpdir(), `ultracost-hud-preview-${process.pid}`);
const IDLE_TP = join(ROOT, 'idle.jsonl');           // no sibling subagents/ dir -> idle
const BUSY_TP = join(ROOT, 'busy.jsonl');           // parent transcript for the busy fixture
const BUSY_SUB = join(ROOT, 'busy', 'subagents');   // runningAgents() reads this

// The agents shown in the busy phase: staggered start offsets (seconds ago) + tier, so the
// auto-scale spread is visible (longest fills the band, the rest proportional).
const CAST = [
  { id: 'a', agoSec: 96, model: 'claude-opus-4-8',    desc: 'Module build' },
  { id: 'b', agoSec: 58, model: 'claude-sonnet-4-6',  desc: 'Integrate composeHud' },
  { id: 'c', agoSec: 27, model: 'claude-opus-4-8',    desc: 'Write tests' },
  { id: 'd', agoSec: 9,  model: null,                 desc: 'Scan files' },
];

const stdinFor = (tp) => ({
  session_id: 'preview',
  transcript_path: tp,
  model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8 (1M context)' },
  effort: { level: 'xhigh' },
  cost: { total_cost_usd: 0.2134 },
  context_window: { used_percentage: 41, context_window_size: 1000000 },
});

// Write the busy fixture with start timestamps relative to `now` so elapsed stays in a nice
// range and agents never age past runningAgents()'s 2-minute freshness window. Re-called each
// time we re-enter the busy phase.
function writeBusy(now) {
  mkdirSync(BUSY_SUB, { recursive: true });
  // Parent transcript: a line with NO tool_result -> every agent counts as still running.
  writeFileSync(BUSY_TP, JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }) + '\n');
  for (const a of CAST) {
    const ts = new Date(now - a.agoSec * 1000).toISOString();
    const lines = [JSON.stringify({ timestamp: ts })];
    if (a.model) lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: a.model } }));
    writeFileSync(join(BUSY_SUB, `agent-${a.id}.jsonl`), lines.join('\n') + '\n');
    writeFileSync(join(BUSY_SUB, `agent-${a.id}.meta.json`),
      JSON.stringify({ agentType: 'general-purpose', description: a.desc, toolUseId: `tu_${a.id}` }));
  }
}

function setup() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'idle'), { recursive: true }); // idle.jsonl's sibling has no subagents/
  writeFileSync(IDLE_TP, JSON.stringify({ type: 'user', message: { role: 'user', content: 'idle' } }) + '\n');
}

function cleanup() {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
}

const cols = () => parseInt(process.env.COLUMNS, 10) || process.stdout.columns || 100;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

setup();

if (SMOKE) {
  // Headless verification: render idle then busy, no clear/loop, show row count + widths.
  const env = { ...process.env, COLUMNS: String(cols()) };
  const show = (label, stdin, frame, working) => {
    const out = composeHud(stdin, { now: Date.now(), frame, working, env });
    const lines = out.split('\n');
    // Report the rendered width (derived from the output), not the env-supplied COLUMNS,
    // so we never log a process-environment value (CodeQL: clear-text logging).
    const width = Math.max(0, ...lines.map((l) => [...stripAnsi(l)].length));
    console.log(`\n── ${label}  (rendered width=${width}, rows=${lines.length}) ──`);
    for (const l of lines) {
      const bare = stripAnsi(l);
      console.log('|' + bare + '|  w=' + [...bare].length);
    }
  };
  show('IDLE (ambient drift)', stdinFor(IDLE_TP), 0, false);
  writeBusy(Date.now());
  show('BUSY (swimlanes)', stdinFor(BUSY_TP), 3.2, true);
  cleanup();
  process.exit(0);
}

// ── Live animation ──
const IDLE_MS = 5000;   // seconds of idle drift per cycle
const BUSY_MS = 11000;  // seconds of busy swimlanes per cycle
const CYCLE = IDLE_MS + BUSY_MS;
const start = Date.now();
let lastPhase = '';

process.stdout.write('\x1b[?25l'); // hide cursor

const frame = () => {
  const now = Date.now();
  const phase = (now - start) % CYCLE < IDLE_MS ? 'idle' : 'busy';
  if (phase === 'busy' && lastPhase !== 'busy') writeBusy(now); // fresh elapsed each busy cycle
  lastPhase = phase;

  const env = { ...process.env, COLUMNS: String(cols()) };
  const stdin = stdinFor(phase === 'busy' ? BUSY_TP : IDLE_TP);
  const hud = composeHud(stdin, { now, frame: now / 1000, working: phase === 'busy', env });

  const title = '\x1b[38;2;167;139;250m  ultracost HUD — live preview\x1b[0m';
  const foot = `\x1b[2m  phase: ${phase}  ·  width: ${cols()}  ·  Ctrl-C to quit\x1b[0m`;
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H' + title + '\n\n' + hud + '\n\n' + foot + '\n');
};

const timer = setInterval(frame, 100);
frame();

const quit = () => {
  clearInterval(timer);
  process.stdout.write('\x1b[?25h\n'); // show cursor
  cleanup();
  process.exit(0);
};
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
