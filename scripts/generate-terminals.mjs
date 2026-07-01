#!/usr/bin/env node
// Render the real ultracost CLI output as polished "mac-window" terminal SVGs for the
// README — on the ultracost brand palette (src/render.js COLORS, near-black canvas).
//
// How it stays honest: every panel is produced by actually running `node bin/cli.js
// <cmd>` with FORCE_COLOR=3, capturing the truecolor ANSI the visual kit emits, and
// converting that ANSI into <tspan> runs. So the SVGs are the literal CLI output, not a
// hand-drawn mock — they cannot drift from what the tool prints. The closed-loop panels
// (reconcile/ledger) run against a throwaway transcript fixture under a temp
// CLAUDE_CONFIG_DIR so they show real rendered output without touching your ~/.claude.
//
// Offline + zero-dependency (pure Node). Run from the repo root:
//     node scripts/generate-terminals.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../src/paths.js';
import { COLORS } from '../src/render.js';

const CLI = join(ROOT, 'bin', 'cli.js');
const OUT_DIR = join(ROOT, 'assets');

// ── terminal geometry / theme ───────────────────────────────────────────────
const FONT = 13;
const CELL_W = 8.0;     // ui-monospace advance at 13px, with a hair of slack
const LINE_H = 19;
const PADX = 22;
const TITLEBAR_H = 36;
const BODY_TOP_PAD = 16;
const BODY_BOT_PAD = 16;

const BG = '#0d1017';       // brand near-black canvas
const TITLEBAR = '#161a26';
const BASE_TEXT = '#c9d2e3';
const TITLE_TEXT = COLORS.slate;
const DOT_RED = COLORS.red;
const DOT_AMBER = COLORS.amber;
const DOT_GREEN = COLORS.green;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ── ANSI (SGR) → styled runs ────────────────────────────────────────────────
// Handles exactly what src/render.js emits: truecolor fg (38;2;r;g;b / 39), bold (1/22),
// dim (2/22), italic (3/23), underline (4/24), and full reset (0).
function parseSgr(codes, state) {
  const t = codes.split(';').filter((x) => x !== '');
  if (!t.length) { Object.assign(state, freshState()); return; }
  for (let i = 0; i < t.length; i++) {
    const n = Number(t[i]);
    if (n === 0) Object.assign(state, freshState());
    else if (n === 1) state.bold = true;
    else if (n === 2) state.dim = true;
    else if (n === 3) state.italic = true;
    else if (n === 4) state.underline = true;
    else if (n === 22) { state.bold = false; state.dim = false; }
    else if (n === 23) state.italic = false;
    else if (n === 24) state.underline = false;
    else if (n === 39) state.fg = null;
    else if (n === 38 && t[i + 1] === '2') {
      state.fg = `#${[t[i + 2], t[i + 3], t[i + 4]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
      i += 4;
    }
  }
}
const freshState = () => ({ fg: null, bold: false, dim: false, italic: false, underline: false });

function toLines(ansi) {
  const lines = [];
  for (const raw of ansi.split('\n')) {
    const runs = [];
    const state = freshState();
    const re = /\x1b\[([0-9;]*)m/g;
    let last = 0;
    let m;
    const emit = (text) => { if (text) runs.push({ text, ...state }); };
    while ((m = re.exec(raw)) !== null) {
      emit(raw.slice(last, m.index));
      parseSgr(m[1], state);
      last = re.lastIndex;
    }
    emit(raw.slice(last));
    lines.push(runs);
  }
  return lines;
}

// Trim leading/trailing blank lines and collapse runs of >1 blank line to a single one.
function tidy(lines) {
  const blank = (l) => l.every((r) => r.text.trim() === '');
  let a = 0;
  let b = lines.length;
  while (a < b && blank(lines[a])) a++;
  while (b > a && blank(lines[b - 1])) b--;
  const out = [];
  let prevBlank = false;
  for (const l of lines.slice(a, b)) {
    const isB = blank(l);
    if (isB && prevBlank) continue;
    out.push(l);
    prevBlank = isB;
  }
  return out;
}

function runSpan(r) {
  const attrs = [];
  attrs.push(`fill="${r.fg || BASE_TEXT}"`);
  if (r.bold) attrs.push('font-weight="700"');
  if (r.italic) attrs.push('font-style="italic"');
  if (r.underline) attrs.push('text-decoration="underline"');
  if (r.dim && !r.fg) attrs.push('opacity="0.58"');
  else if (r.dim) attrs.push('opacity="0.72"');
  return `<tspan ${attrs.join(' ')}>${esc(r.text)}</tspan>`;
}

// ── build one terminal SVG from captured ANSI ───────────────────────────────
function buildSVG({ title, ansi }) {
  const lines = tidy(toLines(ansi));
  const plain = lines.map((l) => l.map((r) => r.text).join(''));
  const cols = Math.max(34, ...plain.map((s) => [...s].length), [...title].length + 6);
  const W = Math.round(PADX * 2 + cols * CELL_W);
  const bodyTop = TITLEBAR_H + BODY_TOP_PAD;
  const H = Math.round(bodyTop + lines.length * LINE_H + BODY_BOT_PAD);

  const P = [];
  P.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" ` +
    `role="img" aria-label="ultracost terminal: ${esc(title)}">`
  );
  P.push(
    '<defs>' +
    `<linearGradient id="frame" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="${COLORS.violet}"/><stop offset="55%" stop-color="${COLORS.magenta}"/>` +
    `<stop offset="100%" stop-color="${COLORS.cyan}"/></linearGradient>` +
    `<radialGradient id="glow" cx="22%" cy="0%" r="90%">` +
    `<stop offset="0%" stop-color="${COLORS.violet}" stop-opacity="0.16"/>` +
    `<stop offset="60%" stop-color="${COLORS.violet}" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="screen"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="11"/></clipPath>` +
    '</defs>'
  );
  // window body + brand gradient frame
  P.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="11.5" fill="${BG}" stroke="url(#frame)" stroke-width="1.5"/>`);
  P.push(`<g clip-path="url(#screen)">`);
  P.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#glow)"/>`);
  // titlebar (rounded top, squared bottom via overlap)
  P.push(`<rect x="1.5" y="1.5" width="${W - 3}" height="${TITLEBAR_H}" rx="11" fill="${TITLEBAR}"/>`);
  P.push(`<rect x="1.5" y="${TITLEBAR_H - 8}" width="${W - 3}" height="10" fill="${TITLEBAR}"/>`);
  P.push(`<line x1="0" y1="${TITLEBAR_H + 1.5}" x2="${W}" y2="${TITLEBAR_H + 1.5}" stroke="#000" stroke-opacity="0.35"/>`);
  P.push(`<circle cx="24" cy="${TITLEBAR_H / 2 + 1}" r="5.5" fill="${DOT_RED}"/>`);
  P.push(`<circle cx="44" cy="${TITLEBAR_H / 2 + 1}" r="5.5" fill="${DOT_AMBER}"/>`);
  P.push(`<circle cx="64" cy="${TITLEBAR_H / 2 + 1}" r="5.5" fill="${DOT_GREEN}"/>`);
  P.push(`<text x="${W / 2}" y="${TITLEBAR_H / 2 + 5}" text-anchor="middle" font-size="11" fill="${TITLE_TEXT}" letter-spacing="0.04em">${esc(title)}</text>`);
  // body text
  P.push(`<text font-size="${FONT}" xml:space="preserve">`);
  lines.forEach((runs, i) => {
    const y = bodyTop + i * LINE_H + 13;
    const content = runs.length ? runs.map(runSpan).join('') : '';
    P.push(`<tspan x="${PADX}" y="${y}">${content || ' '}</tspan>`);
  });
  P.push('</text>');
  P.push('</g>');
  P.push('</svg>');
  return P.join('\n');
}

// ── capture CLI output (truecolor, no NO_COLOR) ─────────────────────────────
function capture(args, extraEnv = {}) {
  const env = { ...process.env, FORCE_COLOR: '3', ...extraEnv };
  delete env.NO_COLOR;
  try {
    return execFileSync('node', [CLI, ...args], { encoding: 'utf8', env, maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    // non-zero exits (e.g. `check` on a script with errors) still print to stdout
    return (e.stdout || '') + (e.stderr || '');
  }
}

// A `$ ultracost …` prompt line (brand green prompt + cyan command), prepended to a panel.
function prompt(cmd) {
  const g = (s) => `\x1b[38;2;52;211;153m${s}\x1b[39m`;
  const c = (s) => `\x1b[38;2;34;211;238m${s}\x1b[39m`;
  return `${g('$ ')}${c('ultracost ' + cmd)}\n`;
}

// ── closed-loop transcript fixture (real code path, throwaway config dir) ────
function writeRun(projectsDir, project, session, wfId, stages, mtimeMs) {
  const wfDir = join(projectsDir, project, session, 'subagents', 'workflows', wfId);
  mkdirSync(wfDir, { recursive: true });
  const journal = [];
  for (const s of stages) {
    journal.push(JSON.stringify({ agentId: s.id, key: s.key }));
    const line = JSON.stringify({
      type: 'assistant', requestId: `r-${s.id}`,
      message: { id: `m-${s.id}`, role: 'assistant', model: s.model, usage: s.usage }
    });
    writeFileSync(join(wfDir, `agent-${s.id}.jsonl`), line + '\n');
  }
  writeFileSync(join(wfDir, 'journal.jsonl'), journal.join('\n') + '\n');
  const t = mtimeMs / 1000;
  utimesSync(wfDir, t, t);
}

const opus = (input, output, cr) => ({ model: 'claude-opus-4-8', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cr } });
const sonnet = (input, output, cr) => ({ model: 'claude-sonnet-4-6', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cr } });

function buildFixture() {
  const sandbox = mkdtempSync(join(tmpdir(), 'ultracost-term-'));
  const projects = join(sandbox, 'projects');
  const project = '-Users-you-projects-app';
  const session = 'a1b2c3d4-session';
  const now = Date.now();
  const H = 3600_000;

  // Oldest run (yesterday): a small refactor that is mostly opus reasoning, so it
  // saves little vs all-opus — an honest "reasoning costs" data point.
  writeRun(projects, project, session, 'wf_refactor_01', [
    { id: '01', key: 'plan', ...opus(1800, 2000, 12000) },
    { id: '02', key: 'apply', ...sonnet(1400, 900, 7000) },
    { id: '03', key: 'review', ...opus(2100, 2600, 16000) }
  ], now - 26 * H);

  // Middle run (today): a purely mechanical data pass — every stage is sonnet, so it
  // lands at the full ~40% tier savings vs all-opus.
  writeRun(projects, project, session, 'wf_csv_extract_02', [
    { id: '01', key: 'discover', ...sonnet(1100, 600, 5000) },
    { id: '02', key: 'extract-1', ...sonnet(1300, 700, 6000) },
    { id: '03', key: 'extract-2', ...sonnet(1250, 650, 6000) },
    { id: '04', key: 'extract-3', ...sonnet(1280, 690, 6200) },
    { id: '05', key: 'reformat', ...sonnet(1200, 640, 5800) }
  ], now - 5 * H);

  // Newest run (today; what `reconcile --last` reports): the deep-audit shape —
  // a couple of opus reasoning stages over a mostly-mechanical sonnet fan-out.
  writeRun(projects, project, session, 'wf_deep_audit_03', [
    { id: '01', key: 'planner', ...opus(1500, 1200, 9000) },
    { id: '02', key: 'discover', ...sonnet(1100, 600, 5000) },
    { id: '03', key: 'scan-auth', ...sonnet(1400, 820, 7000) },
    { id: '04', key: 'scan-api', ...sonnet(1350, 780, 6800) },
    { id: '05', key: 'scan-db', ...sonnet(1300, 760, 6500) },
    { id: '06', key: 'scan-ui', ...sonnet(1320, 800, 6600) },
    { id: '07', key: 'verify-1', ...sonnet(1200, 650, 5500) },
    { id: '08', key: 'verify-2', ...sonnet(1250, 680, 5800) },
    { id: '09', key: 'security', ...sonnet(1450, 900, 7200) },
    { id: '10', key: 'synthesis', ...opus(2000, 2200, 14000) }
  ], now - 1 * H);

  return { sandbox, env: { CLAUDE_CONFIG_DIR: sandbox } };
}

// ── audit fixture: a real `**/workflows/scripts/*.js` tree, mostly unpinned ──
const UNGUIDED = `// the default an unguided ultracode run authors: no stage pins a model
export default async function ({ agent, parallel, pipeline, args }) {
  const plan = await agent('Plan the research across ' + args.topic);
  const sources = await agent('Find every relevant source');
  const notes = await parallel(sources.map((s) => agent('Read and summarize ' + s)));
  const cross = await parallel([
    agent('Analyze themes across the notes'),
    agent('Evaluate source credibility'),
    agent('Identify contradictions')
  ]);
  const draft = await agent('Synthesize the findings into a draft');
  return agent('Review and polish the final report');
}
`;
const PARTLY = `// a second script with a couple of stages pinned, most still inherit
export default async function ({ agent, parallel, args }) {
  const plan = await agent('Design the migration', { model: 'opus', effort: 'xhigh' });
  const files = await agent('List the files to change');
  await parallel(files.map((f) => agent('Apply the edit to ' + f)));
  const tests = await agent('Run the suite and report failures');
  return agent('Consolidate the results');
}
`;

function buildAuditFixture() {
  const sandbox = mkdtempSync(join(tmpdir(), 'ultracost-audit-'));
  const mk = (project, name, src) => {
    const dir = join(sandbox, 'projects', project, 'workflows', 'scripts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), src);
  };
  mk('-Users-you-projects-research', 'deep-research.js', UNGUIDED);
  mk('-Users-you-projects-research', 'literature-scan.js', UNGUIDED);
  mk('-Users-you-projects-app', 'migrate.js', PARTLY);
  return sandbox;
}

// ── panels ──────────────────────────────────────────────────────────────────
function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixture = buildFixture();
  const auditDir = buildAuditFixture();
  let panels;
  try {
    panels = [
      {
        file: 'demo.svg',
        title: 'ultracost — estimate + guard',
        ansi: prompt('estimate examples/deep-audit.workflow.js') +
          capture(['estimate', 'examples/deep-audit.workflow.js']) +
          '\n' + prompt('check examples/workflow.good.js') +
          capture(['check', 'examples/workflow.good.js'])
      },
      {
        file: 'term-guard.svg',
        title: 'ultracost check — the Workflow Guard',
        ansi: prompt('check examples/workflow.bad.js') + capture(['check', 'examples/workflow.bad.js'])
      },
      {
        file: 'term-estimate.svg',
        title: 'ultracost estimate',
        ansi: prompt('estimate examples/deep-audit.workflow.js') + capture(['estimate', 'examples/deep-audit.workflow.js'])
      },
      {
        file: 'term-audit.svg',
        title: 'ultracost audit — pin coverage across your history',
        // Real scan of the fixture tree; only the printed base path is normalized to
        // the canonical projects dir (the numbers are exactly what the guard found).
        ansi: prompt('audit ~/.claude/projects') + capture(['audit', auditDir]),
        subs: [[auditDir, '~/.claude/projects']]
      },
      {
        file: 'term-simulate.svg',
        title: 'ultracost simulate — quality/cost curve',
        ansi: prompt('simulate examples/deep-audit.workflow.js') + capture(['simulate', 'examples/deep-audit.workflow.js'])
      },
      {
        file: 'term-reconcile.svg',
        title: 'ultracost reconcile — estimate vs actual',
        ansi: prompt('reconcile --last') + capture(['reconcile', '--last'], fixture.env)
      },
      {
        file: 'term-ledger.svg',
        title: 'ultracost ledger — cumulative savings',
        ansi: prompt('ledger') + capture(['ledger'], fixture.env),
        subs: [[fixture.sandbox, '~/.claude']]
      }
    ];
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
    rmSync(auditDir, { recursive: true, force: true });
  }

  for (const p of panels) {
    for (const [from, to] of p.subs || []) p.ansi = p.ansi.split(from).join(to);
    const svg = buildSVG(p);
    const out = join(OUT_DIR, p.file);
    writeFileSync(out, svg + '\n');
    console.error(`wrote ${out} (${svg.length} bytes)`);
  }
}

main();
