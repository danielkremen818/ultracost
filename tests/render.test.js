// Force color off so the kit's output is deterministic and width math is exercised.
process.env.NO_COLOR = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, pad, truncate, bar, sparkline, columns, panel, paint, supportsColor } from '../src/render.js';

test('color is disabled under NO_COLOR', () => {
  assert.equal(supportsColor(), false);
  assert.equal(paint('hi', '#a78bfa'), 'hi');
});

test('displayWidth ignores ANSI escapes', () => {
  assert.equal(displayWidth('hello'), 5);
  assert.equal(displayWidth('\x1b[31mhello\x1b[0m'), 5);
});

test('pad and truncate respect display width', () => {
  assert.equal(pad('hi', 5), 'hi   ');
  assert.equal(pad('hi', 5, 'right'), '   hi');
  assert.equal(truncate('hello world', 6), 'hello…');
});

test('bar renders filled/empty blocks deterministically', () => {
  assert.equal(bar(1, 2, 4), '██░░');
  assert.equal(bar(0, 2, 4), '░░░░');
  assert.equal(bar(2, 2, 4), '████');
});

test('sparkline maps the range onto block heights', () => {
  assert.equal(sparkline([0, 7]), '▁█');
  assert.equal(sparkline([]), '');
});

test('columns aligns by widest cell', () => {
  const out = columns([['a', '1'], ['bbb', '22']], { gap: 1, align: ['left', 'right'] });
  const lines = out.split('\n');
  assert.equal(lines[0], 'a    1');
  assert.equal(lines[1], 'bbb 22');
});

test('panel draws a rounded titled border that encloses the body', () => {
  const out = panel(['line one', 'two'], { title: 'box', pad: 1 });
  const lines = out.split('\n');
  assert.ok(lines[0].startsWith('╭'));
  assert.ok(lines.at(-1).startsWith('╰') && lines.at(-1).endsWith('╯'));
  // every rendered line has the same display width
  const widths = new Set(lines.map((l) => displayWidth(l)));
  assert.equal(widths.size, 1);
});
