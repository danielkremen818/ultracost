// Animated pixel-art ultracost mark for the HUD statusline. The base pixel map lives in
// logo-data.js (baked from assets/logo.png by scripts/generate-logo.py); this module is
// the pure, deterministic renderer: it composites a descending "cost flowing down" pulse
// onto the mark and packs two pixel rows per terminal row with the ▀ half-block (fg = top
// pixel, bg = bottom pixel). Output varies ONLY by `frame` — no Math.random, no clock —
// so snapshots are stable. Truecolor → 256 → 16 → monochrome graceful degradation.
//
// We can't reuse render.js's paint() here: it only writes a foreground escape, and the
// half-block compositor needs a combined fg+bg SGR per cell. The rgb→256 quantizer is the
// same formula as render.js's private rgbTo256 (copied inline by design — render.js owns
// its kit and we must not change it).

import { colorDepth } from './render.js';
import { LOGO } from './logo-data.js';

export { LOGO };

// Animation loop length: the descending band advances one frame per HUD invocation and
// wraps at FRAMES. 48 gives a slow, legible sweep down the ~20px-tall mark.
export const FRAMES = 48;

const TOP_HALF = '▀'; // ▀  upper half block: fg paints the top px, bg the bottom px
const FULL = '█';     // █
const BOT_HALF = '▄'; // ▄
const SPACE = ' ';

// 16-color brand anchors for the depth-4 path (fg only). Nearest by squared distance.
const BRAND16 = [
  [[167, 139, 250], 95], // violet  → bright magenta
  [[232, 121, 249], 95], // magenta → bright magenta
  [[244, 114, 182], 95], // pink    → bright magenta
  [[226, 224, 255], 97], // orb     → bright white
  [[120, 60, 200], 35]   // deep purple → magenta
];

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Same quantizer as render.js's private rgbTo256 (6×6×6 cube + grayscale ramp).
function rgb256(r, g, b) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
}

function nearestBrand16([r, g, b]) {
  let best = BRAND16[0][1];
  let bestD = Infinity;
  for (const [[br, bg, bb], code] of BRAND16) {
    const d = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2;
    if (d < bestD) { bestD = d; best = code; }
  }
  return best;
}

// Animation cycle lengths in SECONDS. The renderer is driven by wall-clock time (not a
// per-refresh counter), so motion stays consistent despite the irregular ~1/sec statusline
// refresh. Wide, soft bands over these periods read smooth even at that low frame rate.
const WORK_PERIOD = 11;
const IDLE_PERIOD = 16;

// Per-pixel animated RGB for a base cell. Two always-on states:
//   working=true  → the descending "cost flowing down" pulse (band + trail + particles + orb).
//   working=false → a calm idle: a slow breath + a gentle orb glow, no sweeping band.
// cell = [r,g,b,kind] (kind 0=triangle 1=orb 2=stem); never null (callers skip transparent
// pixels). yN ∈ [0,1] is the normalized row. Pure in (cell, x, y, yN, frame, gridW, working).
function shade(cell, x, y, yN, frame, gridW, working) {
  // `frame` is wall-clock SECONDS in production (a float), or an explicit integer in tests.
  // Facets + gradient are baked into the reference colours; the animation only modulates
  // brightness on top, using WIDE SOFT bands (no discrete particles) so it reads smooth at
  // the low statusline frame rate.
  const [r, g, b, kind] = cell;
  let base = [r, g, b];

  if (!working) {
    // IDLE: one very wide, soft highlight drifting slowly down + a gentle orb glow.
    const phase = (((frame / IDLE_PERIOD) % 1) + 1) % 1; // 0 (top) → 1 (bottom)
    const d = yN - phase;
    const sheen = Math.exp(-(d * d) / (2 * 0.26 * 0.26)); // very wide → gradual, smooth
    if (kind === 1) {
      const glow = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
      base = lerp3(base, [255, 255, 255], 0.18 + 0.22 * glow);
    }
    const out = lerp3(base, [255, 255, 255], 0.22 * sheen);
    return [clamp(out[0]), clamp(out[1]), clamp(out[2])];
  }

  // WORKING: a wide, soft descending band with a gentle trailing fade + a synced orb pulse.
  const phase = (((frame / WORK_PERIOD) % 1) + 1) % 1;
  const d = yN - phase;
  const core = Math.exp(-(d * d) / (2 * 0.16 * 0.16)); // wider/softer than a sharp pulse
  const tail = d < 0 ? Math.max(0, 1 + d / 0.42) : 0;  // soft trail above the band
  const intensity = Math.max(0, Math.min(1, Math.max(core, 0.5 * tail)));
  if (kind === 1) {
    const pulse = 0.6 + 0.4 * Math.sin(2 * Math.PI * phase);
    base = lerp3(base, [255, 255, 255], 0.3 * pulse);
  }
  const out = lerp3(base, [255, 255, 255], 0.5 * intensity);
  return [clamp(out[0]), clamp(out[1]), clamp(out[2])];
}

// Emit one cell as a half-block at the given color depth. `top`/`bot` are animated RGB, or
// null for a TRANSPARENT (background) pixel — the mark must read as part of the terminal,
// not a pasted rectangle, so background pixels carry NO bg colour (49 = default bg) and a
// fully-empty cell is just a space. A half-filled cell paints only its lit half (▀ top / ▄
// bottom) over the terminal background. `49;` before every coloured cell clears any bg the
// previous (both-lit) cell set, so colour never bleeds across the transparent gaps.
function cellSgr(top, bot, depth) {
  if (top == null && bot == null) return '\x1b[49m ';
  if (depth >= 24) {
    if (top && bot) return `\x1b[38;2;${top[0]};${top[1]};${top[2]};48;2;${bot[0]};${bot[1]};${bot[2]}m${TOP_HALF}`;
    if (top) return `\x1b[49;38;2;${top[0]};${top[1]};${top[2]}m${TOP_HALF}`;
    return `\x1b[49;38;2;${bot[0]};${bot[1]};${bot[2]}m${BOT_HALF}`;
  }
  if (depth >= 8) {
    if (top && bot) return `\x1b[38;5;${rgb256(...top)};48;5;${rgb256(...bot)}m${TOP_HALF}`;
    if (top) return `\x1b[49;38;5;${rgb256(...top)}m${TOP_HALF}`;
    return `\x1b[49;38;5;${rgb256(...bot)}m${BOT_HALF}`;
  }
  // depth 4: 16-color foreground only, never a background.
  if (top) return `\x1b[49;${nearestBrand16(top)}m${TOP_HALF}`;
  return `\x1b[49;${nearestBrand16(bot)}m${BOT_HALF}`;
}

// Nearest-neighbor resample of the base map to a target pixel height (aspect-preserving).
// Lets the HUD render the mark smaller than its native 32px without a second baked map.
// Identity when targetH >= LOGO.h, so the default render is unchanged.
function resample(targetH) {
  if (targetH >= LOGO.h) return { w: LOGO.w, h: LOGO.h, px: LOGO.px };
  const scale = targetH / LOGO.h;
  const w = Math.max(1, Math.round(LOGO.w * scale));
  const px = [];
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(LOGO.h - 1, Math.floor(y / scale));
    const row = [];
    for (let x = 0; x < w; x++) row.push(LOGO.px[sy]?.[Math.min(LOGO.w - 1, Math.floor(x / scale))] ?? null);
    px.push(row);
  }
  return { w, h: targetH, px };
}

// Monochrome silhouette (depth 1 / NO_COLOR): mask-only, frame-INDEPENDENT so snapshots
// are stable. █ = both px solid, ▀ = only top, ▄ = only bottom, space = empty.
function monoRow(grid, r) {
  let line = '';
  for (let x = 0; x < grid.w; x++) {
    const top = grid.px[2 * r]?.[x] != null;
    const bot = grid.px[2 * r + 1]?.[x] != null;
    line += top && bot ? FULL : top ? TOP_HALF : bot ? BOT_HALF : SPACE;
  }
  return line;
}

// Render the animated mark for `frame` to `rows` terminal lines (default = native h/2 = 16;
// pass a smaller `rows` to shrink — the base map is resampled to fit). Every row has equal
// displayWidth. Pure: identical (frame, depth, rows) → identical output.
export function renderLogo(frame, { depth = colorDepth(), rows = Math.floor(LOGO.h / 2), working = true } = {}) {
  const grid = resample(rows * 2);
  const pxRows = grid.h;
  if (depth <= 1) {
    const out = [];
    for (let r = 0; r < rows; r++) out.push(monoRow(grid, r));
    return out;
  }
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const yTop = 2 * r;
    const yBot = 2 * r + 1;
    let line = '';
    for (let x = 0; x < grid.w; x++) {
      const topCell = grid.px[yTop]?.[x] ?? null;
      const botCell = grid.px[yBot]?.[x] ?? null;
      // null cells stay transparent (no shade, no bg) so the mark blends into the terminal.
      const top = topCell ? shade(topCell, x, yTop, pxRows > 1 ? yTop / (pxRows - 1) : 0, frame, grid.w, working) : null;
      const bot = botCell ? shade(botCell, x, yBot, pxRows > 1 ? yBot / (pxRows - 1) : 0, frame, grid.w, working) : null;
      line += cellSgr(top, bot, depth);
    }
    lines.push(line + '\x1b[0m');
  }
  return lines;
}
