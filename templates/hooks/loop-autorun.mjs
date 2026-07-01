#!/usr/bin/env node
// ultracost closed-loop autorun — Stop hook. Runs once the main agent finishes a
// turn (after every subagent is done), so the user never has to remember the
// reconcile/calibrate/ledger commands.
//
// It is cheap and idempotent: it no-ops unless a NEW dynamic-workflow run has
// finished since the last time it ran (tracked by wfId in autorun-state.json). On a
// fresh run it:
//   1. ledgerSync()        — upsert one savings line per workflow (idempotent),
//   2. calibrationFromRuns — refresh the token prior the estimator/gate use,
//   3. reconcileRun()      — summarize estimate-vs-actual for the freshly finished
//                            run(s) and surface it via systemMessage.
//
// Disable with ULTRACOST_AUTORUN=off. Never blocks Stop (no decision:block) and
// always exits 0 — a closed-loop summary must never wedge the session.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ULTRACOST_DIR } from '../../src/paths.js';
import { loadPolicy } from '../../src/policy.js';
import { workflowRunDirs, locateWorkflowRuns } from '../../src/transcript.js';
import { reconcileRun, ledgerSync, calibrationFromRuns, writeCalibration } from '../../src/loop.js';

const STATE_PATH = join(ULTRACOST_DIR, 'autorun-state.json');
const money = (x) => '$' + Number(x).toFixed(4);

// Drain stdin so Claude Code's writer never blocks; we don't need the event body.
async function drainStdin() {
  if (process.stdin.isTTY) return;
  try {
    process.stdin.setEncoding('utf8');
    for await (const _ of process.stdin) { /* discard */ }
  } catch { /* ignore */ }
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return { seen: [] }; }
}

function writeState(state) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state) + '\n');
  } catch { /* best-effort */ }
}

async function main() {
  await drainStdin();
  if (process.env.ULTRACOST_AUTORUN === 'off') return;

  // Fast path: a cheap dir+mtime scan (no jsonl parsing). If no workflow id has
  // appeared since last turn, exit before the expensive per-stage parse — this keeps
  // the hook negligible on the vast majority of Stop events.
  const dirs = workflowRunDirs();
  if (!dirs.length) return;
  const seen = new Set(readState().seen || []);
  const candidates = dirs.filter((d) => !seen.has(d.wfId));
  if (!candidates.length) return;

  // A new workflow id is present — now do the real (expensive) parse.
  const runs = locateWorkflowRuns();
  const fresh = runs.filter((r) => !seen.has(r.wfId));
  // Remember every run dir we've observed so subsequent turns stay a fast no-op.
  writeState({ seen: dirs.map((d) => d.wfId) });
  if (!fresh.length) return;

  const { policy } = loadPolicy();

  // Persist: ledger (all runs, idempotent) + refreshed calibration prior.
  const ledger = ledgerSync(runs, policy);
  const cal = calibrationFromRuns(runs, policy);
  if (cal) writeCalibration(cal);

  // Summarize only the freshly finished run(s).
  const recos = fresh.map((r) => reconcileRun(r, policy));
  const actual = recos.reduce((n, r) => n + r.totals.actual, 0);
  const allOpus = recos.reduce((n, r) => n + r.totals.allOpus, 0);
  const saved = recos.reduce((n, r) => n + r.totals.saved, 0);
  const pct = allOpus ? Math.round((1 - actual / allOpus) * 100) : 0;
  const lifetime = ledger.reduce((n, e) => n + (e.saved || 0), 0);

  const msg =
    `ultracost closed loop — ${fresh.length} workflow run(s) finished: ` +
    `actual ${money(actual)} vs all-opus ${money(allOpus)} ` +
    `(saved ${money(saved)}, ${pct}%). ` +
    `Calibration refreshed${cal ? ` (${cal.samples} stage samples)` : ''}. ` +
    `Lifetime saved: ${money(lifetime)}.`;

  process.stdout.write(JSON.stringify({ systemMessage: msg }));
}

main().catch(() => {}).finally(() => process.exit(0));
