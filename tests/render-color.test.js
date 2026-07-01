// Exercises the color-ON paths of the render kit (the rest of the suite forces
// NO_COLOR, so these branches need their own controlled env). We toggle NO_COLOR /
// FORCE_COLOR per call and restore afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorDepth, paint, gradient, pad, bold, dim, hr } from '../src/render.js';

function withEnv(env, fn) {
  const save = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
  for (const k of ['NO_COLOR', 'FORCE_COLOR']) {
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  try { return fn(); } finally {
    for (const k of ['NO_COLOR', 'FORCE_COLOR']) {
      if (save[k] === undefined) delete process.env[k]; else process.env[k] = save[k];
    }
  }
}

test('colorDepth maps FORCE_COLOR levels', () => {
  assert.equal(withEnv({ FORCE_COLOR: '0' }, colorDepth), 1);
  assert.equal(withEnv({ FORCE_COLOR: 'false' }, colorDepth), 1);
  assert.equal(withEnv({ FORCE_COLOR: '1' }, colorDepth), 4);
  assert.equal(withEnv({ FORCE_COLOR: 'true' }, colorDepth), 4);
  assert.equal(withEnv({ FORCE_COLOR: '2' }, colorDepth), 8);
  assert.equal(withEnv({ FORCE_COLOR: '3' }, colorDepth), 24);
});

test('colorDepth: NO_COLOR overrides FORCE_COLOR', () => {
  assert.equal(withEnv({ NO_COLOR: '1', FORCE_COLOR: '3' }, colorDepth), 1);
});

test('colorDepth: non-TTY → 1; TTY → getColorDepth (with catch fallback)', () => {
  const realIsTTY = process.stdout.isTTY;
  const realGCD = process.stdout.getColorDepth;
  try {
    process.stdout.isTTY = false;
    assert.equal(withEnv({}, colorDepth), 1);
    process.stdout.isTTY = true;
    process.stdout.getColorDepth = () => 8;
    assert.equal(withEnv({}, colorDepth), 8);
    process.stdout.getColorDepth = () => { throw new Error('boom'); };
    assert.equal(withEnv({}, colorDepth), 4);
  } finally {
    process.stdout.isTTY = realIsTTY;
    process.stdout.getColorDepth = realGCD;
  }
});

test('paint emits truecolor / 256 / 16 / no-color by depth', () => {
  withEnv({ FORCE_COLOR: '3' }, () => assert.match(paint('x', '#a78bfa'), /\x1b\[38;2;167;139;250m/));
  withEnv({ FORCE_COLOR: '2' }, () => {
    assert.match(paint('x', '#a78bfa'), /\x1b\[38;5;\d+m/);
    paint('x', '#000000'); // rgbTo256 grayscale: r<8 → 16
    paint('x', '#ffffff'); // grayscale: r>248 → 231
    paint('x', '#808080'); // grayscale mid
  });
  withEnv({ FORCE_COLOR: '1' }, () => {
    assert.match(paint('x', '#a78bfa'), /\x1b\[\d\dm/);
    paint('x', '#ffffff'); // rgbTo16 bright → +60
    paint('x', '#000000'); // rgbTo16 dark
  });
  withEnv({ FORCE_COLOR: '0' }, () => assert.equal(paint('x', '#a78bfa'), 'x'));
});

test('gradient interpolates at truecolor, solid below', () => {
  withEnv({ FORCE_COLOR: '3' }, () => {
    const g = gradient('abc', '#a78bfa', '#22d3ee');
    assert.match(g, /\x1b\[38;2;/);
    assert.ok(g.endsWith('\x1b[39m'));
  });
  withEnv({ FORCE_COLOR: '2' }, () => assert.match(gradient('abc', '#a78bfa', '#22d3ee'), /\x1b\[38;5;/));
});

test('pad center distributes padding around the value', () => {
  assert.equal(pad('x', 5, 'center'), '  x  ');
  assert.equal(pad('xy', 5, 'center'), ' xy  ');
});

test('bold/dim wrap with SGR when color is on', () => {
  withEnv({ FORCE_COLOR: '1' }, () => {
    assert.match(bold('x'), /\x1b\[1mx\x1b\[22m/);
    assert.match(dim('x'), /\x1b\[2mx\x1b\[22m/);
  });
});

test('hr renders a horizontal rule of the requested width', () => {
  withEnv({ NO_COLOR: '1' }, () => assert.equal(hr(4), '────'));
});
