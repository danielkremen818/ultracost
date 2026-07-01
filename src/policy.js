import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_POLICY, POLICY_PATH } from './paths.js';

// Resolution order: explicit path, installed policy, bundled default. The installed /
// default locations are injectable (defaults preserve normal behavior) so the
// "nothing resolvable" guard is reachable in tests without deleting shipped files.
export function loadPolicy(explicitPath, { policyPath = POLICY_PATH, defaultPolicy = DEFAULT_POLICY } = {}) {
  const candidates = [explicitPath, policyPath, defaultPolicy].filter(Boolean);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Policy file is not valid JSON: ${p}\n  ${e.message}`);
    }
    return { policy: normalize(parsed), source: p };
  }
  throw new Error('No policy found and bundled default is missing.');
}

export function normalize(input) {
  const p = { ...input };
  p.version ??= 1;
  p.neverUse = (p.neverUse ?? ['haiku']).map((m) => String(m).toLowerCase());
  p.allowInherit ??= false;
  p.tiers ??= { opus: { model: 'opus', effort: 'xhigh' }, sonnet: { model: 'sonnet', effort: 'high' } };
  p.default ??= 'opus';
  p.tieBreaker ??= p.default;
  p.alwaysOpus ??= [];
  p.rules ??= [];

  p.effort ??= {};
  p.effort.range ??= ['low', 'medium', 'high', 'xhigh'];
  p.effort.default ??= 'high';
  p.effort.maxByModel ??= { sonnet: 'high', opus: 'xhigh' };
  p.effort.byComplexity ??= {
    low: 'trivial deterministic work: listing/globbing files, simple extraction, formatting, mechanical renames',
    medium: 'light judgment on a small surface: a single straightforward edit, summarizing one source',
    high: 'standard coding/analysis: most refactors, per-file review, non-trivial tests',
    xhigh: 'hard reasoning: cross-file architecture, adversarial review, planning, final synthesis'
  };

  p.pricing ??= {};
  p.pricing.opus ??= { input: 5, output: 25 };
  p.pricing.sonnet ??= { input: 3, output: 15 };
  p.pricing.haiku ??= { input: 1, output: 5 };

  p.estimation ??= {};
  p.estimation.tokensPerStage ??= { input: 2000, output: 1200 };
  p.estimation.effortOutputMultiplier ??= { low: 0.4, medium: 1, high: 1.8, xhigh: 3, max: 4 };
  p.estimation.assumedFanout ??= 5;
  p.estimation.cacheMultipliers ??= { cacheRead: 0.1, cacheWrite: 1.25 };

  p.classify ??= {};
  p.classify.keywords ??= {};
  p.classify.keywords.opus ??= [];
  p.classify.keywords.sonnet ??= [];

  p.budget ??= {};
  p.budget.perRun ??= null;
  p.budget.perDay ??= null;

  const errors = [];
  if (!p.tiers[p.default]) errors.push(`default tier "${p.default}" is not defined in tiers`);
  for (const r of p.rules) {
    if (r.tier && !p.tiers[r.tier]) errors.push(`rule references unknown tier "${r.tier}"`);
  }
  for (const [name, t] of Object.entries(p.tiers)) {
    if (!t || typeof t.model !== 'string') errors.push(`tier "${name}" is missing a string "model"`);
    if (p.neverUse.includes(String(t?.model).toLowerCase())) {
      errors.push(`tier "${name}" uses model "${t.model}" which is listed in neverUse`);
    }
  }
  for (const k of ['perRun', 'perDay']) {
    const v = p.budget[k];
    if (v !== null && !(typeof v === 'number' && v >= 0)) errors.push(`budget.${k} must be a non-negative number or null`);
  }
  if (errors.length) throw new Error('Invalid policy:\n  - ' + errors.join('\n  - '));
  return p;
}

// neverUse matches by alias or substring, so "haiku" also bans "claude-haiku-4-5".
export function classifyModel(value, policy) {
  const v = String(value).toLowerCase();
  if (v === 'inherit') return policy.allowInherit ? 'ok' : 'inherit';
  for (const banned of policy.neverUse) {
    if (v === banned || v.includes(banned)) return 'banned';
  }
  return 'ok';
}

export function tierModel(tierName, policy) {
  return policy.tiers[tierName]?.model ?? tierName;
}
