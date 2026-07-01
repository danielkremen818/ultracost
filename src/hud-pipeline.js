// Subagent "pipeline" band — the third HUD column, to the right of the pixel logo. It is
// the horizontal analogue of logo.js's descending "cost flowing down" pulse: each running
// agent gets a swimlane (mini-Gantt) whose tier-colored particle STREAM spans a length
// proportional to its elapsed time, auto-scaled so the longest-running visible agent fills
// the band. Particles flow left→right within that span as MANY small dots with soft
// comet-trails (bright head → fading tail), so at the ~1/sec statusline refresh it reads as
// continuous flow rather than discrete blips.
//
// Pure & deterministic: output depends ONLY on (agents, width, rows, frame, depth). No
// Math.random, no Date.now, no fs — `frame` (wall-clock seconds, a float in prod / integer
// in tests) is the sole time input. We reuse render.js's kit (displayWidth/truncate/pad/
// paint/colorDepth/COLORS) and never reimplement it. NEVER throws: any internal error falls
// back to blank rows of the correct width.

import { colorDepth, COLORS, displayWidth, truncate, pad, paint } from './render.js';

// Tier → brand color name. Mirrors hud.js tierColor(): opus=violet, sonnet=cyan, haiku=red,
// null/none=slate. Kept local so this module stays self-contained.
const tierColorName = (tier) =>
  tier === 'opus' ? 'violet' : tier === 'sonnet' ? 'cyan' : tier === 'haiku' ? 'red' : 'slate';

const LANE_CAP = 6;   // max visible swimlanes; overflow collapses into a dim "+K more" line
const MIN_STREAM = 8; // always keep at least this many stream cells so the flow stays legible

// Comet glyph ramp by brightness (dim tail → bright head). Truecolor/256 modulate the
// foreground RGB on top of these; depth-4 / mono lean on the glyph shape alone.
const HEAD = '●';
const MID = '•';
const FAINT = '∙';
const DOT = '·';
const SPACE = ' ';

// Mono silhouette ramp for busy lanes — a FRAME-INDEPENDENT mask (like logo.js monoRow) so
// snapshots stay stable.
const MONO_RAMP = [SPACE, DOT, FAINT, MID]; // by stream intensity bucket

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

// A blank band of the right size — the universal fallback (and the depth-0 sanity floor).
function blank(width, rows) {
  const w = Math.max(0, width | 0);
  const r = Math.max(0, rows | 0);
  const line = ' '.repeat(w);
  return Array.from({ length: r }, () => line);
}

// Emit one cell glyph with foreground color for the given depth. `hex` is the lane's tier
// color; `bright` ∈ [0,1] is the comet brightness (1 = head). depth>=8 fades the color
// toward a dark base by brightness for the trailing-fade look; depth 4 paints solid tier
// color (no RGB fade available) and relies on glyph shape; depth<=1 returns the bare glyph.
function cell(glyph, hex, bright, depth) {
  if (glyph === SPACE) return SPACE;
  if (depth <= 1) return glyph;
  if (depth >= 8) {
    // Fade the lit color toward a dim slate-ish base so the tail dissolves into the band.
    const faded = mix(hex, '#1e2230', 1 - clamp01(bright));
    return paint(glyph, faded);
  }
  // depth 4: 16-color foreground only — solid tier color, brightness carried by the glyph.
  return paint(glyph, hex);
}

// Lerp between two hex colors by t (0 → a, 1 → b). truecolor/256-only path; render.js's
// paint() quantizes the result for us, so we just produce a hex string.
function mix(aHex, bHex, t) {
  const a = hex2rgb(aHex);
  const b = hex2rgb(bHex);
  const r = Math.round(lerp(a[0], b[0], t));
  const g = Math.round(lerp(a[1], b[1], t));
  const bl = Math.round(lerp(a[2], b[2], t));
  return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hex2rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Comet field intensity at a continuous position. Several heads ride along the span at a
// steady speed; each head has a bright core with a soft trailing tail BEHIND it (toward the
// span start), the horizontal twin of logo.js's descending band+trail. `u` ∈ [0,1] is the
// cell position within the lit span; `phase` ∈ [0,1) advances heads left→right with time.
// Returns brightness ∈ [0,1]. Pure in (u, phase, density).
function comet(u, phase, density) {
  // `density` heads evenly spaced along the span; phase shifts them all together. For each
  // head at position p (wrapping), brightness = sharp core + exponential tail behind it.
  let best = 0;
  for (let k = 0; k < density; k++) {
    const p = (((k / density) + phase) % 1 + 1) % 1; // head position, wrapped into [0,1)
    const d = u - p;                                  // signed distance from head
    let bright;
    if (d <= 0) {
      // Behind the head (tail trails toward the span start): exponential fade.
      bright = Math.exp(d / 0.10); // d<=0 → ≤1; ~0.10 span tail length
    } else {
      // Just ahead of the head: tiny falloff so the leading edge is crisp.
      bright = Math.exp(-(d * d) / (2 * 0.012 * 0.012));
    }
    if (bright > best) best = bright;
  }
  return clamp01(best);
}

// Map a brightness to a comet glyph (shared by all depths for shape consistency).
function glyphFor(bright) {
  if (bright >= 0.72) return HEAD;
  if (bright >= 0.4) return MID;
  if (bright >= 0.16) return FAINT;
  if (bright >= 0.04) return DOT;
  return SPACE;
}

// Render one busy swimlane row: a short label, then a tier-colored comet stream whose lit
// SPAN length is `spanFrac` of the stream area (auto-scaled by the caller). Returns a string
// of EXACTLY `width` displayWidth.
function laneRow(agent, spanFrac, width, frame, depth, labelW) {
  const tier = agent && agent.model ? agent.tier : null;
  const hex = COLORS[tierColorName(tier)];

  // Label column (width chosen by the caller so every lane shares it and the streams align).
  // Dim-tier-colored for at-a-glance tier; truncated only if the band is too narrow to fit it.
  const rawLabel = String((agent && agent.label) || (agent && agent.agentType) || '·');
  const label = labelW > 0 ? truncate(rawLabel, labelW) : '';
  const labelCell = depth <= 1 ? pad(label, labelW) : paint(pad(label, labelW), hex);

  const gap = labelW > 0 ? 1 : 0;
  const streamW = Math.max(0, width - labelW - gap);
  if (streamW <= 0) return clampWidth(labelCell, width);

  // Lit span: cells [0, span) carry the comet; the rest is empty (lane hasn't reached there).
  const span = Math.max(1, Math.round(streamW * clamp01(spanFrac)));
  // Heads-per-span and flow speed scale with span so longer lanes show more, faster flow —
  // reinforcing "this one's been running longer". Phase is wall-clock driven (frame=seconds).
  const density = Math.max(2, Math.round(span / 6));
  const phase = (((frame / 7) % 1) + 1) % 1; // ~7s loop: smooth at the low refresh rate

  let stream = '';
  for (let x = 0; x < streamW; x++) {
    if (x >= span) { stream += SPACE; continue; }
    const u = span > 1 ? x / (span - 1) : 1; // 0 = span start, 1 = leading edge
    if (depth <= 1) {
      // Mono: frame-INDEPENDENT silhouette — a dotted bar whose length is the span, denser
      // toward the leading edge so it still reads as flow direction without animation.
      const bucket = Math.min(MONO_RAMP.length - 1, 1 + Math.floor(u * (MONO_RAMP.length - 1)));
      stream += MONO_RAMP[bucket];
      continue;
    }
    const bright = comet(u, phase, density);
    stream += cell(glyphFor(bright), hex, bright, depth);
  }

  const line = labelCell + (gap ? SPACE : '') + stream;
  return clampWidth(line, width, depth);
}

// Force a (possibly ANSI-colored) line to EXACTLY `width` columns: pad short, truncate long.
// Colored lines must end with a reset so color never bleeds into the gutter / next column.
function clampWidth(line, width, depth = 1) {
  const w = displayWidth(line);
  let out;
  if (w < width) out = line + ' '.repeat(width - w);
  else if (w > width) out = truncate(line, width); // truncate is ANSI-aware
  else out = line;
  if (depth > 1) out += '\x1b[0m';
  return out;
}

// Public renderer. Returns EXACTLY `rows` strings, each displayWidth EXACTLY `width`,
// ANSI-colored per `depth`. agents=[] → a blank band (idle; the caller drops the column).
// NEVER throws: any failure → blank rows of the correct size.
export function renderPipeline(agents, { width, rows, frame, depth = colorDepth(), working, maxLanes } = {}) {
  const w = Math.max(0, Math.floor(width) || 0);
  const r = Math.max(0, Math.floor(rows) || 0);
  if (w === 0 || r === 0) return blank(w, r);
  const f = Number.isFinite(frame) ? frame : 0;

  try {
    const list = Array.isArray(agents) ? agents : [];

    // IDLE: nothing to show. The band only fills while subagents are working — composeHud drops
    // the band column entirely when idle — so return blank rows to satisfy the contract.
    if (list.length === 0) return blank(w, r);

    // BUSY: one swimlane per agent (newest-first, runningAgents order), capped by the caller's
    // maxLanes (the HUD's terminal-height budget) and the available rows. If more agents than
    // fit, the LAST visible row becomes a dim "+K more" line — same convention as the panel.
    const cap = Math.min(maxLanes > 0 ? Math.floor(maxLanes) : LANE_CAP, r);
    const hasOverflow = list.length > cap;
    const visibleLanes = hasOverflow ? Math.max(1, cap - 1) : Math.min(list.length, cap);
    const shown = list.slice(0, visibleLanes);

    // Shared label column: wide enough to show each full (already-shortened) agent label so
    // names aren't clipped, but never starving the stream (keeps >= MIN_STREAM flow cells).
    // Shared across lanes so every stream starts at the same screen column.
    const labelOf = (a) => String((a && a.label) || (a && a.agentType) || '·');
    const longestLabel = shown.reduce((m, a) => Math.max(m, displayWidth(labelOf(a))), 0);
    const labelW = Math.max(0, Math.min(longestLabel, w - MIN_STREAM - 1));

    // Auto-scale: the longest-running visible agent fills the band; the rest are proportional.
    // Guard against zero/negative elapsed so spanFrac stays in (0,1].
    let maxElapsed = 0;
    for (const a of shown) maxElapsed = Math.max(maxElapsed, (a && a.elapsedMs) || 0);
    if (maxElapsed <= 0) maxElapsed = 1;

    const out = [];
    for (const a of shown) {
      const spanFrac = clamp01(Math.max(0.12, ((a && a.elapsedMs) || 0) / maxElapsed));
      out.push(laneRow(a, spanFrac, w, f, depth, labelW));
    }

    if (hasOverflow) {
      const moreCount = list.length - shown.length;
      const text = '+' + moreCount + ' more';
      const line = depth <= 1 ? text : paint(text, COLORS.slate);
      out.push(clampWidth(line, w, depth));
    }

    // Pad any remaining rows below the lanes with blank lines so we return EXACTLY r rows.
    while (out.length < r) out.push(' '.repeat(w));
    if (out.length > r) out.length = r;
    return out;
  } catch {
    return blank(w, r);
  }
}
