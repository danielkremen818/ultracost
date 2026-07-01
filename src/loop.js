import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CALIBRATION_PATH, LEDGER_PATH } from './paths.js';
import { costFromUsage, modelPrice, totalTokens } from './cost.js';
import { tierOfModel } from './classify.js';

// The closed loop: turn the per-stage token sums from transcript.js into reconciled
// cost (actual vs an all-opus baseline), a self-calibrating token prior, and a
// persisted savings ledger. All offline; reuses the cost model in cost.js.

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function ensureDir(file) {
  const d = dirname(file);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// Effective input tokens — fold cache reads/writes into an input-equivalent at the
// policy's multipliers so the estimator's single input number prices realistically.
function effectiveInput(u, policy) {
  const mult = policy?.estimation?.cacheMultipliers || { cacheRead: 0.1, cacheWrite: 1.25 };
  return (u.input_tokens || 0) +
    (u.cache_read_input_tokens || 0) * (mult.cacheRead ?? 0.1) +
    (u.cache_creation_input_tokens || 0) * (mult.cacheWrite ?? 1.25);
}

// Reconcile one workflow run: actual cost per stage at its real model vs the all-opus
// baseline (the same tokens re-priced at opus rates).
export function reconcileRun(run, policy) {
  const opusPrice = modelPrice('opus', policy);
  const stages = run.stages.map((s) => {
    const price = modelPrice(s.model, policy);
    return {
      ...s,
      tier: tierOfModel(s.model),
      tokens: totalTokens(s.usage),
      actualCost: costFromUsage(s.usage, price, policy),
      opusCost: costFromUsage(s.usage, opusPrice, policy)
    };
  });
  const actual = stages.reduce((n, s) => n + s.actualCost, 0);
  const allOpus = stages.reduce((n, s) => n + s.opusCost, 0);
  return {
    wfId: run.wfId,
    dir: run.dir,
    project: run.project,
    ts: run.mtime ? new Date(run.mtime).toISOString() : null,
    stages,
    totals: {
      actual,
      allOpus,
      saved: allOpus - actual,
      savedPct: allOpus ? Math.round((1 - actual / allOpus) * 100) : 0,
      tokens: stages.reduce((n, s) => n + s.tokens, 0)
    }
  };
}

// Build a calibrated token prior from real runs. tokencast-style: drop per-stage
// outliers (> 3x or < 0.2x the median total) before taking medians.
export function calibrationFromRuns(runs, policy) {
  const stages = runs.flatMap((r) => r.stages || []);
  let recs = stages
    .map((s) => ({ inT: effectiveInput(s.usage, policy), outT: s.usage.output_tokens || 0, tot: totalTokens(s.usage), model: s.model }))
    .filter((r) => r.tot > 0);
  if (!recs.length) return null;
  const medTot = median(recs.map((r) => r.tot));
  recs = recs.filter((r) => r.tot <= medTot * 3 && r.tot >= medTot * 0.2);
  if (!recs.length) return null;

  const tokensPerStage = { input: Math.round(median(recs.map((r) => r.inT))), output: Math.round(median(recs.map((r) => r.outT))) };
  const perModel = {};
  for (const k of ['opus', 'sonnet']) {
    const ms = recs.filter((r) => String(r.model || '').toLowerCase().includes(k));
    if (ms.length) perModel[k] = { input: Math.round(median(ms.map((r) => r.inT))), output: Math.round(median(ms.map((r) => r.outT))), samples: ms.length };
  }
  return {
    _asOf: new Date().toISOString().slice(0, 10),
    runs: runs.length,
    samples: recs.length,
    droppedOutliers: stages.length - recs.length,
    tokensPerStage,
    perModel
  };
}

export function readCalibration() {
  if (!existsSync(CALIBRATION_PATH)) return null;
  try { return JSON.parse(readFileSync(CALIBRATION_PATH, 'utf8')); } catch { return null; }
}

export function writeCalibration(cal) {
  ensureDir(CALIBRATION_PATH);
  writeFileSync(CALIBRATION_PATH, JSON.stringify(cal, null, 2) + '\n');
  return CALIBRATION_PATH;
}

// Return a shallow policy clone whose estimator token prior comes from calibration
// (if present). estimate.js stays pure — the CLI/gate opt in via this.
export function applyCalibration(policy, cal = readCalibration()) {
  if (!cal || !cal.tokensPerStage) return policy;
  return { ...policy, estimation: { ...policy.estimation, tokensPerStage: cal.tokensPerStage }, _calibrated: true };
}

export function ledgerRead() {
  if (!existsSync(LEDGER_PATH)) return [];
  try {
    return readFileSync(LEDGER_PATH, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch { return []; }
}

// Reconcile every run and upsert one ledger line per workflow id (idempotent — re-running
// does not double-count). Returns the full, deduped, date-sorted ledger.
export function ledgerSync(runs, policy) {
  const byId = new Map(ledgerRead().map((e) => [e.wfId, e]));
  for (const run of runs) {
    const r = reconcileRun(run, policy);
    byId.set(r.wfId, {
      wfId: r.wfId,
      project: r.project,
      ts: r.ts,
      stages: r.stages.length,
      actual: r.totals.actual,
      allOpus: r.totals.allOpus,
      saved: r.totals.saved,
      savedPct: r.totals.savedPct,
      tokens: r.totals.tokens
    });
  }
  const entries = [...byId.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  ensureDir(LEDGER_PATH);
  writeFileSync(LEDGER_PATH, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  return entries;
}

export function spentToday(entries = ledgerRead(), day = new Date().toISOString().slice(0, 10)) {
  return entries.filter((e) => String(e.ts).slice(0, 10) === day).reduce((n, e) => n + (e.actual || 0), 0);
}
