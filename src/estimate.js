import { readFileSync } from 'node:fs';
import { stageList } from './guard.js';

const PRICE_KEYS = ['opus', 'sonnet', 'haiku'];

// Map any model alias or full id to a pricing key (substring match; defaults to opus).
export function priceKey(model) {
  const v = String(model).toLowerCase();
  return PRICE_KEYS.find((k) => v.includes(k)) || 'opus';
}

function round(x) {
  return Math.round(x * 1e4) / 1e4;
}

function effortMultiplier(effort, policy) {
  const m = policy.estimation.effortOutputMultiplier;
  return m[effort] ?? m[policy.effort?.default] ?? 1;
}

// Default effort for a model: the matching tier's effort, else the global default.
function tierEffortFor(model, policy) {
  const key = priceKey(model);
  for (const t of Object.values(policy.tiers)) {
    if (priceKey(t.model) === key) return t.effort || policy.effort?.default || 'high';
  }
  return policy.effort?.default || 'high';
}

function stageCost(model, effort, policy) {
  const price = policy.pricing[priceKey(model)] || policy.pricing.opus;
  const { input, output } = policy.estimation.tokensPerStage;
  return (input / 1e6) * price.input + ((output * effortMultiplier(effort, policy)) / 1e6) * price.output;
}

// Estimate agent count, model mix, and a tiered-vs-baseline cost for a workflow
// script. Baseline = every stage on the session model (the default tier, opus @
// xhigh) — what an unguided ultracode run does. Tiered = the per-stage models/effort
// actually pinned (unpinned stages inherit the session model, so they save nothing).
export function estimateText(text, policy, opts = {}) {
  const assumedFanout = opts.assumedFanout ?? policy.estimation.assumedFanout;
  const sessionModel = policy.tiers[policy.default]?.model || 'opus';
  const sessionEffort = policy.tiers[policy.default]?.effort || 'xhigh';

  const stages = stageList(text).map((s) => {
    const tieredModel = s.model || sessionModel;
    const tieredEffort = s.effort || (s.model ? tierEffortFor(s.model, policy) : sessionEffort);
    return {
      line: s.line,
      fanout: s.fanout,
      pinned: !!s.model,
      model: tieredModel,
      effort: tieredEffort,
      tieredCost: stageCost(tieredModel, tieredEffort, policy),
      baselineCost: stageCost(sessionModel, sessionEffort, policy)
    };
  });

  const weight = (s) => (s.fanout ? assumedFanout : 1);
  const tiered = stages.reduce((n, s) => n + s.tieredCost * weight(s), 0);
  const baseline = stages.reduce((n, s) => n + s.baselineCost * weight(s), 0);

  const known = stages.filter((s) => !s.fanout).length;
  const fanoutGroups = stages.filter((s) => s.fanout).length;

  const modelMix = {};
  for (const s of stages) {
    const k = priceKey(s.model);
    modelMix[k] = (modelMix[k] || 0) + weight(s);
  }

  return {
    agents: {
      known,
      fanoutGroups,
      assumedPerFanout: assumedFanout,
      assumedTotal: known + fanoutGroups * assumedFanout
    },
    modelMix,
    cost: {
      tiered: round(tiered),
      baseline: round(baseline),
      savings: round(baseline - tiered),
      savingsPct: baseline ? Math.round((1 - tiered / baseline) * 100) : 0
    },
    stages,
    assumptions: {
      sessionModel,
      pricing: policy.pricing,
      pricingAsOf: policy.pricing?._asOf,
      tokensPerStage: policy.estimation.tokensPerStage,
      effortOutputMultiplier: policy.estimation.effortOutputMultiplier,
      assumedFanout,
      note: 'Estimate. Unpinned stages inherit the session model and save nothing. Fan-out groups assume N items each; total scales linearly with the real item count.'
    }
  };
}

export function estimateFile(file, policy, opts) {
  return estimateText(readFileSync(file, 'utf8'), policy, opts);
}

// Total cost of the same workflow under three policies, for `ultracost simulate`:
// all-opus (the unguided ultracode default), all-sonnet (aggressive cost-first), and
// tiered (the per-stage pins as written).
export function scenarioTotals(text, policy) {
  const stages = stageList(text);
  const assumedFanout = policy.estimation.assumedFanout;
  const weight = (s) => (s.fanout ? assumedFanout : 1);
  const sum = (model, effort) => stages.reduce((n, s) => n + stageCost(model, effort, policy) * weight(s), 0);
  const def = policy.tiers[policy.default] || { model: 'opus', effort: 'xhigh' };
  const son = policy.tiers.sonnet || { model: 'sonnet', effort: 'high' };
  return {
    stages: stages.length,
    allOpus: round(sum(def.model, def.effort)),
    allSonnet: round(sum(son.model, son.effort || 'high')),
    tiered: round(estimateText(text, policy).cost.tiered)
  };
}
