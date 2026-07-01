import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { POLICY_PATH } from './paths.js';

// The .md variant returns the clean markdown rate table; the bare URL is a JS-rendered
// SPA whose raw HTML does not parse reliably.
export const DEFAULT_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
const DEFAULT_MODELS = { opus: 'Claude Opus 4.8', sonnet: 'Claude Sonnet 4.6', haiku: 'Claude Haiku 4.5' };

// Defensive bounds on the one outbound request ultracost ever makes.
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_LENGTH = 2 * 1024 * 1024; // ~2MB of text; the page is a few KB

// Parse per-model {input, output} from the official pricing page text. The standard
// rate row carries several dollar figures (base input + cache columns + output); the
// long-context row has only two. Pick, per model, the row with the most figures, then
// take the first as input and the last as output.
export function parsePrices(pageText, models = DEFAULT_MODELS) {
  const out = {};
  const lines = String(pageText).split('\n');
  for (const [alias, name] of Object.entries(models)) {
    let best = null;
    for (const l of lines) {
      if (!l.includes(name)) continue;
      const amounts = [...l.matchAll(/\$\s*([0-9]+(?:\.[0-9]+)?)/g)].map((m) => parseFloat(m[1]));
      if (!best || amounts.length > best.length) best = amounts;
    }
    if (best && best.length >= 2) out[alias] = { input: best[0], output: best[best.length - 1] };
  }
  return out;
}

// Fetch the official pricing page and return an updated pricing block (provenance
// refreshed). fetchImpl is injectable so tests run offline. Throws on HTTP error or
// if any model can't be parsed (page format drift) — the caller keeps old prices.
export async function refreshPricing(policy, { url, fetchImpl = globalThis.fetch } = {}) {
  const models = policy.pricing?._models || DEFAULT_MODELS;
  const src = url || policy.pricing?._source || DEFAULT_PRICING_URL;
  if (typeof fetchImpl !== 'function') throw new Error('no fetch available (need Node >= 24 or an injected fetchImpl)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let body;
  try {
    const res = await fetchImpl(src, { headers: { 'user-agent': 'ultracost-pricing-refresh' }, signal: controller.signal });
    if (!res.ok) throw new Error(`pricing fetch failed: HTTP ${res.status} from ${src}`);
    body = await res.text();
  } finally {
    clearTimeout(timer);
  }
  if (typeof body === 'string' && body.length > MAX_BODY_LENGTH) {
    throw new Error(`pricing page too large (${body.length} chars > ${MAX_BODY_LENGTH}) from ${src} — refusing to parse`);
  }
  const parsed = parsePrices(body, models);
  const missing = Object.keys(models).filter((a) => !parsed[a]);
  if (missing.length) throw new Error(`could not parse pricing for: ${missing.join(', ')} from ${src} (page format may have changed)`);
  assertPlausible(parsed, src);
  return { ...policy.pricing, _source: src, _asOf: new Date().toISOString().slice(0, 10), _models: models, ...parsed };
}

// Guard against a bad parse silently overwriting good prices: output must exceed input,
// input must be positive, and the models must not all be identical (a tell that the
// parser latched onto unrelated numbers, as a JS-rendered HTML page produces).
export function assertPlausible(parsed, src = 'source') {
  const entries = Object.entries(parsed);
  for (const [alias, p] of entries) {
    if (!(p.input > 0) || !(p.output > p.input)) {
      throw new Error(`implausible pricing for ${alias} ($${p.input} in / $${p.output} out) from ${src} — keeping current prices`);
    }
  }
  const sigs = new Set(entries.map(([, p]) => `${p.input}/${p.output}`));
  if (entries.length > 1 && sigs.size === 1) {
    throw new Error(`all models parsed to the same price from ${src} — likely a bad parse; keeping current prices`);
  }
}

// Write a refreshed pricing block into the installed policy file. Returns the path.
export function writePricingToPolicy(pricing, policyPath = POLICY_PATH) {
  if (!existsSync(policyPath)) throw new Error(`no installed policy at ${policyPath} — run "ultracost init" first`);
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.pricing = pricing;
  writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n');
  return policyPath;
}
