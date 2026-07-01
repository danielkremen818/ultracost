import { color, bold, dim } from './render.js';

// Back-compatible styling surface. `c.*` keeps the names the CLI already uses, now
// backed by the brand palette in render.js (truecolor with 256/16/no-color fallback).
export const c = {
  bold,
  dim,
  red: color.red,
  green: color.green,
  yellow: color.amber,
  cyan: color.cyan,
  violet: color.violet,
  magenta: color.magenta,
  amber: color.amber,
  slate: color.slate
};

export const log = (msg = '') => console.log(msg);
export const ok = (msg) => log(`${color.green('✓')} ${msg}`);
export const warn = (msg) => log(`${color.amber('!')} ${msg}`);
export const err = (msg) => log(`${color.red('✗')} ${msg}`);
export const info = (msg) => log(dim(msg));

// Re-export the full render kit so callers can `import { panel, columns, bar } from './log.js'`.
export * from './render.js';
