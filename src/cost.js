// Turn real transcript token usage into USD, using the policy's per-model rates plus
// cache multipliers (cache reads bill at ~0.1x input, cache writes at ~1.25x — the
// pattern Claude Code's own cost math uses). Model ids are resolved by substring so
// both aliases (claude-opus-4-8) and dated ids (claude-sonnet-4-6-20250929) price.

const PRICE_KEYS = ['opus', 'sonnet', 'haiku'];

export function modelPrice(model, policy) {
  const v = String(model || '').toLowerCase();
  const key = PRICE_KEYS.find((k) => v.includes(k)) || 'opus';
  return policy?.pricing?.[key] || policy?.pricing?.opus || { input: 5, output: 25 };
}

// Cache-creation tokens: prefer the flat field, else sum the newer nested ephemeral
// buckets (cache_creation.ephemeral_5m_input_tokens + ephemeral_1h_input_tokens).
function cacheCreate(u) {
  if (typeof u.cache_creation_input_tokens === 'number') return u.cache_creation_input_tokens;
  const c = u.cache_creation;
  if (c) return (c.ephemeral_5m_input_tokens || 0) + (c.ephemeral_1h_input_tokens || 0);
  return 0;
}

// Sum a list of message.usage objects into one normalized usage record.
export function sumUsage(list) {
  const acc = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const u of list) {
    if (!u) continue;
    acc.input_tokens += u.input_tokens || 0;
    acc.output_tokens += u.output_tokens || 0;
    acc.cache_creation_input_tokens += cacheCreate(u);
    acc.cache_read_input_tokens += u.cache_read_input_tokens || 0;
  }
  return acc;
}

// USD for one usage record at a given price ({ input, output } per MTok).
export function costFromUsage(usage, price, policy) {
  const mult = policy?.estimation?.cacheMultipliers || { cacheRead: 0.1, cacheWrite: 1.25 };
  const u = usage || {};
  const input = u.input_tokens || 0;
  const output = u.output_tokens || 0;
  const cr = u.cache_read_input_tokens || 0;
  const cw = u.cache_creation_input_tokens || 0;
  return (
    input * price.input +
    output * price.output +
    cr * price.input * (mult.cacheRead ?? 0.1) +
    cw * price.input * (mult.cacheWrite ?? 1.25)
  ) / 1e6;
}

// Total tokens billed (for display) — every bucket counts as a token moved.
export const totalTokens = (u) =>
  (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
