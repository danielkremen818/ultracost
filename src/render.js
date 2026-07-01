// Zero-dependency terminal rendering kit. Uses only Node stdlib: getColorDepth for
// capability detection, stripVTControlCharacters + Intl.Segmenter for width-aware
// alignment, and hand-rolled ANSI for truecolor/256/16 with graceful downsample.
// Honors NO_COLOR and FORCE_COLOR. No npm dependencies (a hard project constraint).

import { stripVTControlCharacters } from 'node:util';

// ultracost brand palette — ported from scripts/generate-architecture-svg.py so the
// CLI matches the docs/architecture diagram.
export const COLORS = {
  violet: '#a78bfa',
  magenta: '#e879f9',
  pink: '#f472b6',
  cyan: '#22d3ee',
  lilac: '#c4b5fd',
  amber: '#fbbf24',
  green: '#34d399',
  red: '#fb7185',
  clay: '#d97757',
  slate: '#94a3b8'
};

export function colorDepth() {
  if (process.env.NO_COLOR !== undefined) return 1;
  const fc = process.env.FORCE_COLOR;
  if (fc !== undefined) {
    if (fc === '0' || fc === 'false') return 1;
    if (fc === '1' || fc === 'true') return 4;
    if (fc === '2') return 8;
    return 24;
  }
  if (!process.stdout || !process.stdout.isTTY) return 1;
  try { return process.stdout.getColorDepth(); } catch { return 4; }
}

export const supportsColor = () => colorDepth() > 1;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbTo256(r, g, b) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
}

function rgbTo16(r, g, b) {
  const bit = (v) => (v > 110 ? 1 : 0);
  let code = 30 + (bit(r) | (bit(g) << 1) | (bit(b) << 2));
  if ((r + g + b) / 3 > 150) code += 60;
  return code;
}

// Wrap a string in a truecolor/256/16 foreground escape appropriate to the terminal.
export function paint(str, hex) {
  const d = colorDepth();
  if (d <= 1) return String(str);
  const [r, g, b] = hexToRgb(hex);
  if (d >= 24) return `\x1b[38;2;${r};${g};${b}m${str}\x1b[39m`;
  if (d >= 8) return `\x1b[38;5;${rgbTo256(r, g, b)}m${str}\x1b[39m`;
  return `\x1b[${rgbTo16(r, g, b)}m${str}\x1b[39m`;
}

const sgr = (open, close) => (s) => (supportsColor() ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const italic = sgr(3, 23);
export const underline = sgr(4, 24);

// Named brand colorizers, e.g. color.violet('text').
export const color = Object.fromEntries(Object.entries(COLORS).map(([k, hex]) => [k, (s) => paint(s, hex)]));

// A left-to-right two-stop gradient across a string (truecolor only; else solid start).
export function gradient(str, startHex, endHex) {
  const s = String(str);
  if (colorDepth() < 24) return paint(s, startHex);
  const [r1, g1, b1] = hexToRgb(startHex);
  const [r2, g2, b2] = hexToRgb(endHex);
  const chars = [...s];
  const n = Math.max(1, chars.length - 1);
  return chars
    .map((ch, i) => {
      const t = i / n;
      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      return `\x1b[38;2;${r};${g};${b}m${ch}`;
    })
    .join('') + '\x1b[39m';
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff],
  [0x20000, 0x3fffd]
];
const isWide = (cp) => WIDE.some(([a, b]) => cp >= a && cp <= b);

// Display width that ignores ANSI escapes and counts wide/emoji graphemes as 2.
export function displayWidth(str) {
  const plain = stripVTControlCharacters(String(str));
  let w = 0;
  for (const { segment } of segmenter.segment(plain)) {
    const cp = segment.codePointAt(0);
    if (cp === 0) continue;
    w += segment.length > 1 || isWide(cp) ? 2 : 1;
  }
  return w;
}

export function truncate(str, max, ellipsis = '…') {
  if (displayWidth(str) <= max) return String(str);
  let out = '';
  let w = 0;
  for (const { segment } of segmenter.segment(stripVTControlCharacters(String(str)))) {
    const cw = segment.length > 1 || isWide(segment.codePointAt(0)) ? 2 : 1;
    if (w + cw > max - 1) break;
    out += segment;
    w += cw;
  }
  return out + ellipsis;
}

export function pad(str, width, align = 'left') {
  const s = String(str);
  const gap = Math.max(0, width - displayWidth(s));
  if (align === 'right') return ' '.repeat(gap) + s;
  if (align === 'center') {
    const l = Math.floor(gap / 2);
    return ' '.repeat(l) + s + ' '.repeat(gap - l);
  }
  return s + ' '.repeat(gap);
}

// A proportional bar built from eighth-blocks for sub-cell precision.
export function bar(value, max, width = 24, hex = COLORS.green) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const units = frac * width;
  const full = Math.floor(units);
  const rem = units - full;
  const eighths = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const tip = rem > 0 ? eighths[Math.round(rem * 8)] || '' : '';
  const filled = '█'.repeat(full) + tip;
  const used = full + (tip ? 1 : 0);
  return paint(filled, hex) + dim('░'.repeat(Math.max(0, width - used)));
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
export function sparkline(values, hex) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return '';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const s = values
    .map((v) => (Number.isFinite(v) ? SPARK[Math.min(7, Math.floor(((v - min) / span) * 7.999))] : ' '))
    .join('');
  return hex ? paint(s, hex) : s;
}

export const hr = (width, hex = COLORS.slate, ch = '─') => paint(ch.repeat(Math.max(0, width)), hex);

// A rounded panel with an optional title. `lines` is an array of already-styled rows.
export function panel(lines, { title = '', hex = COLORS.violet, pad: padX = 1, minWidth = 0 } = {}) {
  const body = Array.isArray(lines) ? lines : String(lines).split('\n');
  const inner = Math.max(minWidth, displayWidth(title) + 2, ...body.map((l) => displayWidth(l)));
  const w = inner + padX * 2;
  const sp = ' '.repeat(padX);
  const top = title
    ? paint('╭─ ', hex) + bold(title) + ' ' + paint('─'.repeat(Math.max(0, w - displayWidth(title) - 3)) + '╮', hex)
    : paint('╭' + '─'.repeat(w) + '╮', hex);
  const mid = body.map((l) => paint('│', hex) + sp + pad(l, inner) + sp + paint('│', hex));
  const bot = paint('╰' + '─'.repeat(w) + '╯', hex);
  return [top, ...mid, bot].join('\n');
}

// Aligned columns (no grid borders). rows: array of arrays of (possibly styled) cells.
export function columns(rows, { align = [], gap = 2, head = null, indent = 0 } = {}) {
  const all = head ? [head, ...rows] : rows;
  const cols = Math.max(0, ...all.map((r) => r.length));
  const widths = [];
  for (let c = 0; c < cols; c++) widths[c] = Math.max(0, ...all.map((r) => displayWidth(r[c] ?? '')));
  const pre = ' '.repeat(indent);
  const sep = ' '.repeat(gap);
  const renderRow = (r) =>
    pre + r.map((cell, c) => pad(cell ?? '', widths[c], align[c] || 'left')).join(sep).replace(/\s+$/, '');
  const out = [];
  if (head) {
    out.push(pre + head.map((cell, c) => bold(pad(cell ?? '', widths[c], align[c] || 'left'))).join(sep).replace(/\s+$/, ''));
  }
  for (const r of rows) out.push(renderRow(r));
  return out.join('\n');
}

export const symbols = {
  ok: '✓',
  warn: '!',
  err: '✗',
  bullet: '•',
  arrow: '→',
  dot: '●',
  pin: '●',
  none: '○'
};
