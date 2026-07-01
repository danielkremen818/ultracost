import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth } from '../src/render.js';
import { renderPipeline } from '../src/hud-pipeline.js';

const DEPTHS = [24, 8, 4, 1];
const FRAMES_SAMPLE = [0, 3, 7, 42];

// runningAgents()-shaped fixtures: newest-first, with tier + elapsedMs.
const agent = (over = {}) => ({
  label: 'Extract graph',
  model: 'claude-sonnet-4-6',
  tier: 'sonnet',
  elapsedMs: 12000,
  kind: 'subagent',
  status: 'running',
  ...over
});

const opts = (over = {}) => ({ width: 26, rows: 8, frame: 0, depth: 24, ...over });

// Helper: assert a band is exactly rows lines, each displayWidth exactly width.
function assertShape(out, { width, rows }) {
  assert.ok(Array.isArray(out), 'output must be an array');
  assert.equal(out.length, rows, `expected ${rows} rows, got ${out.length}`);
  for (const line of out) {
    assert.equal(typeof line, 'string');
    assert.equal(displayWidth(line), width, `line ${JSON.stringify(line)} width ≠ ${width}`);
  }
}

// (a) Output is exactly rows lines, each displayWidth === width — across depths, busy & idle.
test('output is exactly rows lines, each displayWidth === width', () => {
  for (const depth of DEPTHS) {
    for (const rows of [1, 3, 8]) {
      for (const width of [24, 30, 48]) {
        const busy = renderPipeline([agent()], { width, rows, frame: 0, depth });
        assertShape(busy, { width, rows });
        const idle = renderPipeline([], { width, rows, frame: 0, depth });
        assertShape(idle, { width, rows });
      }
    }
  }
});

// (b) Determinism — same (agents, width, rows, frame, depth) → byte-identical output.
test('renderPipeline is pure: same inputs → identical output', () => {
  const agents = [agent({ tier: 'opus', model: 'claude-opus-4-8', elapsedMs: 30000 }), agent()];
  for (const depth of DEPTHS) {
    for (const frame of FRAMES_SAMPLE) {
      const a = renderPipeline(agents, opts({ frame, depth })).join('\n');
      const b = renderPipeline(agents, opts({ frame, depth })).join('\n');
      assert.equal(a, b, `non-deterministic at depth ${depth} frame ${frame}`);
    }
  }
  // Idle path is pure too.
  const i1 = renderPipeline([], opts({ frame: 7 })).join('\n');
  const i2 = renderPipeline([], opts({ frame: 7 })).join('\n');
  assert.equal(i1, i2);
});

// (c) Busy vs idle differ — agents produce labeled lanes; [] produces a blank band (the band
// fills only while subagents work; composeHud drops the column entirely when idle).
test('busy lanes carry labels; idle band is blank', () => {
  const o = opts({ depth: 1 }); // mono → easy to read text without ANSI
  const busy = renderPipeline([agent({ label: 'Extract graph' })], o).join('\n');
  assert.match(busy, /Extract/, 'busy lane must show a label');

  const idleRows = renderPipeline([], o);
  const idle = idleRows.join('\n');
  assert.doesNotMatch(idle, /Extract/, 'idle band must not carry agent labels');
  assert.notEqual(busy, idle, 'busy and idle bands must differ');

  // The band fills only while working → idle is entirely blank (correct width, no glyphs).
  assert.ok(idleRows.every((l) => !/\S/.test(l)), 'idle band must be blank');
});

// (d) Lane cap — >6 agents → 6 visible rows = 5 lanes + a "+K more" line.
test('lane cap: >6 agents → 6 lanes incl. "+K more"', () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    agent({ label: `agent${i}`, elapsedMs: 10000 + i * 1000 })
  );
  const out = renderPipeline(many, opts({ rows: 8, depth: 1 }));
  assertShape(out, { width: 26, rows: 8 });

  // 9 agents, cap 6 visible → 5 lanes + "+4 more".
  assert.match(out.join('\n'), /\+4 more/, 'overflow line must read "+4 more"');

  // The first five distinct labels appear; the sixth (agent5) is collapsed into "+K more".
  const blob = out.join('\n');
  for (const i of [0, 1, 2, 3, 4]) assert.match(blob, new RegExp(`agent${i}`));
  assert.doesNotMatch(blob, /agent5/, 'overflowed lanes must not render their own row');
});

// (d2) maxLanes (the HUD's terminal-height budget) raises the cap: with enough rows, every
// agent shows and there is no "+K more".
test('maxLanes raises the lane cap so a big fan-out fills the space', () => {
  const many = Array.from({ length: 9 }, (_, i) => agent({ label: `agent${i}`, elapsedMs: 10000 + i * 1000 }));
  const out = renderPipeline(many, opts({ rows: 12, depth: 1, maxLanes: 9 }));
  assertShape(out, { width: 26, rows: 12 });
  const blob = out.join('\n');
  for (let i = 0; i < 9; i++) assert.match(blob, new RegExp(`agent${i}`));
  assert.doesNotMatch(blob, /\+\d+ more/, 'no overflow line when all lanes fit');
});

// (d3) maxLanes is still bounded by the available rows → overflow collapses as usual.
test('lane cap stays bounded by rows even with a high maxLanes', () => {
  const many = Array.from({ length: 9 }, (_, i) => agent({ label: `agent${i}` }));
  const out = renderPipeline(many, opts({ rows: 4, depth: 1, maxLanes: 20 }));
  assertShape(out, { width: 26, rows: 4 });
  // cap = min(20, 4) = 4 → 3 lanes + "+6 more".
  assert.match(out.join('\n'), /\+6 more/);
});

// (e) Tier colors present for opus/sonnet at depth 24 (violet vs cyan diverge).
// NOTE: render.js paint() reads colorDepth() from the ENV, not the `depth` arg — so we must
// force truecolor in the environment (as hud.test.js does with FORCE_COLOR=3) for the actual
// ANSI to appear. We restore env afterward to avoid leaking into the depth-1 tests.
test('tier colors: opus and sonnet lanes use different truecolor fg', () => {
  const savedFC = process.env.FORCE_COLOR;
  const savedNC = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = '3';
  try {
    const opusOut = renderPipeline([agent({ tier: 'opus', model: 'claude-opus-4-8' })], opts({ depth: 24 })).join('');
    const sonnetOut = renderPipeline([agent({ tier: 'sonnet', model: 'claude-sonnet-4-6' })], opts({ depth: 24 })).join('');

    // Truecolor foreground SGR present in both.
    assert.match(opusOut, /\x1b\[38;2;\d+;\d+;\d+m/, 'opus lane must carry truecolor fg');
    assert.match(sonnetOut, /\x1b\[38;2;\d+;\d+;\d+m/, 'sonnet lane must carry truecolor fg');

    // The two tiers must not produce identical colored output (violet ≠ cyan).
    assert.notEqual(opusOut, sonnetOut, 'opus and sonnet lanes must differ in color');

    // Colored lines end with a reset so color never bleeds into the next column.
    const lines = renderPipeline([agent({ tier: 'opus', model: 'claude-opus-4-8' })], opts({ depth: 24 }));
    assert.ok(lines[0].endsWith('\x1b[0m'), 'colored lane line must end with reset');
  } finally {
    if (savedFC === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = savedFC;
    if (savedNC === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNC;
  }
});

// (f) Mono fallback (depth 1) uses ASCII dots and is frame-INDEPENDENT.
test('mono (depth 1) uses dots, no ANSI, and is frame-independent', () => {
  const agents = [agent({ tier: 'opus', model: 'claude-opus-4-8', elapsedMs: 30000 }), agent()];

  // Busy mono: identical across two very different frames.
  const busy1 = renderPipeline(agents, opts({ frame: 1, depth: 1 })).join('\n');
  const busy99 = renderPipeline(agents, opts({ frame: 99, depth: 1 })).join('\n');
  assert.equal(busy1, busy99, 'busy mono must be frame-independent');

  // Idle mono: identical across frames too.
  const idle1 = renderPipeline([], opts({ frame: 1, depth: 1 })).join('\n');
  const idle99 = renderPipeline([], opts({ frame: 99, depth: 1 })).join('\n');
  assert.equal(idle1, idle99, 'idle mono must be frame-independent');

  // No ANSI escapes at all in mono.
  assert.ok(!busy1.includes('\x1b['), 'mono busy must contain no ANSI');
  assert.ok(!idle1.includes('\x1b['), 'mono idle must contain no ANSI');

  // ASCII-dot silhouette glyphs present (· ∙ •), no comet heads (●) which are color-only.
  assert.match(busy1 + idle1, /[·∙•]/, 'mono must use the dot ramp');
  assert.ok(!(busy1 + idle1).includes('●'), 'mono must not use the colored comet head glyph');
});

// (g) Never throws on odd input (missing fields, width 0, rows 0, junk agents, default opts).
test('never throws on odd input; degenerate sizes → blanks of correct size', () => {
  const odd = [
    [null, opts()],
    [undefined, opts()],
    ['garbage', opts()],
    [[{}], opts()],                                   // agent with no fields
    [[{ label: null, model: null }], opts()],         // null fields
    [[agent()], { width: 0, rows: 5, frame: 0, depth: 24 }],
    [[agent()], { width: 26, rows: 0, frame: 0, depth: 24 }],
    [[agent()], { width: -4, rows: -2, frame: 0, depth: 24 }],
    [[agent()], { width: 26, rows: 5, frame: NaN, depth: 24 }],
    [[agent()], undefined],                           // no opts at all → defaults
  ];
  for (const [agents, o] of odd) {
    let out;
    assert.doesNotThrow(() => { out = renderPipeline(agents, o); }, `threw on ${JSON.stringify(o)}`);
    assert.ok(Array.isArray(out), 'must return an array');
  }

  // width 0 → blank rows of width 0 (every line empty), rows preserved.
  const zeroW = renderPipeline([agent()], { width: 0, rows: 5, frame: 0, depth: 24 });
  assert.equal(zeroW.length, 5);
  assert.ok(zeroW.every((l) => displayWidth(l) === 0));

  // rows 0 → empty array.
  assert.equal(renderPipeline([agent()], { width: 26, rows: 0, frame: 0, depth: 24 }).length, 0);

  // A junk agent still produces a width-correct line (no throw, falls back to a "·" label).
  const junk = renderPipeline([{}], opts({ depth: 24 }));
  assertShape(junk, { width: 26, rows: 8 });
});
