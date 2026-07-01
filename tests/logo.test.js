import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth } from '../src/render.js';
import { renderLogo, LOGO, FRAMES } from '../src/logo.js';

const FRAMES_SAMPLE = [0, 12, 24, 47];
const DEPTHS = [24, 8, 4, 1];

test('LOGO base map is 25×30 (h even → 15 terminal rows)', () => {
  assert.equal(LOGO.w, 25);
  assert.equal(LOGO.h, 30);
  assert.equal(LOGO.px.length, LOGO.h);
  assert.equal(LOGO.px[0].length, LOGO.w);
  assert.equal(FRAMES, 48);
});

test('every row displayWidth === LOGO.w across frames and depths', () => {
  for (const depth of DEPTHS) {
    for (const frame of FRAMES_SAMPLE) {
      const rows = renderLogo(frame, { depth });
      assert.equal(rows.length, Math.floor(LOGO.h / 2));
      for (const row of rows) {
        assert.equal(displayWidth(row), LOGO.w, `depth ${depth} frame ${frame}`);
      }
    }
  }
});

test('renderLogo is pure: same (frame, depth) → identical output', () => {
  for (const depth of DEPTHS) {
    for (const frame of FRAMES_SAMPLE) {
      const a = renderLogo(frame, { depth }).join('\n');
      const b = renderLogo(frame, { depth }).join('\n');
      assert.equal(a, b);
    }
  }
});

test('rows honors an explicit rows option (downscaled, aspect-preserved)', () => {
  const rows = renderLogo(0, { depth: 24, rows: 6 });
  assert.equal(rows.length, 6);
  const w = displayWidth(rows[0]);
  for (const row of rows) assert.equal(displayWidth(row), w); // uniform width across rows
  assert.ok(w > 0 && w < LOGO.w, `downscaled width ${w} should be < native ${LOGO.w}`);
});

test('working and idle states render differently, each pure, width invariant held', () => {
  const work = renderLogo(4, { depth: 24, working: true });
  const idle = renderLogo(4, { depth: 24, working: false });
  assert.deepEqual(renderLogo(4, { depth: 24, working: true }), work); // working is pure
  assert.deepEqual(renderLogo(4, { depth: 24, working: false }), idle); // idle is pure
  assert.notDeepEqual(work, idle); // the two states differ
  for (const row of [...work, ...idle]) assert.equal(displayWidth(row), LOGO.w);
});

test('NO_COLOR (depth 1) output is the silhouette and frame-INDEPENDENT', () => {
  const ref = renderLogo(0, { depth: 1 }).join('\n');
  for (const frame of FRAMES_SAMPLE) {
    assert.equal(renderLogo(frame, { depth: 1 }).join('\n'), ref);
  }
  // silhouette draws only the mask with █/▀/▄/space — no ANSI escapes at all.
  assert.ok(!ref.includes('\x1b['));
  assert.match(ref, /[█▀▄]/);
});

test('escape family is correct per depth', () => {
  const r24 = renderLogo(0, { depth: 24 }).join('');
  const r8 = renderLogo(0, { depth: 8 }).join('');
  const r4 = renderLogo(0, { depth: 4 }).join('');
  const r1 = renderLogo(0, { depth: 1 }).join('');

  // truecolor: 48;2; present, 48;5; absent.
  assert.ok(r24.includes('48;2;'));
  assert.ok(!r24.includes('48;5;'));

  // 256-color: 48;5; present, 48;2; absent.
  assert.ok(r8.includes('48;5;'));
  assert.ok(!r8.includes('48;2;'));

  // 16-color: no background escapes at all, still has a foreground SGR.
  assert.ok(!r4.includes('48;'));
  assert.ok(r4.includes('\x1b['));

  // monochrome: no escapes at all.
  assert.ok(!r1.includes('\x1b['));
});

test('every RGB channel stays within 0..255 (truecolor)', () => {
  // matches both the fg (38;2;…) and bg (48;2;…) triplets.
  const re = /[34]8;2;(\d+);(\d+);(\d+)/g;
  for (const frame of FRAMES_SAMPLE) {
    const blob = renderLogo(frame, { depth: 24 }).join('');
    let m;
    while ((m = re.exec(blob)) !== null) {
      for (let i = 1; i <= 3; i++) {
        const v = Number(m[i]);
        assert.ok(v >= 0 && v <= 255 && Number.isInteger(v), `channel ${v} out of range`);
      }
    }
  }
});
