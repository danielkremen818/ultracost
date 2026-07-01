import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { HUD_STATE_DIR } from './paths.js';
import { ledgerRead, spentToday } from './loop.js';
import { loadPolicy } from './policy.js';
import { tierOfModel } from './classify.js';
import { totalTokens } from './cost.js';
import { runningAgents } from './hud-agents.js';
import { renderLogo, FRAMES, LOGO } from './logo.js';
import { renderPipeline } from './hud-pipeline.js';
import { panel, bar, hr, dim, color, paint, COLORS, colorDepth, displayWidth, truncate, pad } from './render.js';

// HUD composition for the `ultracost hud` statusline: gather live metrics into a left
// panel, render the animated pixel logo, and side-join the subagent pipeline band. Height
// is CONTENT-DRIVEN — the panel grows with running agents and the logo + band resample to
// match, so idle HUDs stop wasting vertical space. Pure given injected now/frame/env so
// snapshots are deterministic. composeHud NEVER throws — every row is independently guarded
// and the whole body is wrapped, falling back to fallbackLine().

const PANEL_MIN = 34;
// Running-agent rows are content-driven: the panel (and the band beside it) grow to show every
// running agent, bounded only by the terminal height — so a big fan-out fills the vertical
// space instead of collapsing into "+K more" while the tall logo leaves it empty. When the
// terminal height isn't known (the statusline often runs without LINES set) we fall back to a
// generous default that covers a typical fan-out.
const AGENT_ROWS_MIN = 4;
const AGENT_ROWS_MAX = 24;
const AGENT_ROWS_DEFAULT = 12;
const PANEL_CHROME_ROWS = 8; // borders + up to 4 metric rows + hr + "running" header
// Max terminal rows for the side logo = half the baked pixel height (each terminal row packs
// 2 pixel rows via the ▀ half-block). The logo resamples DOWN to the current content height,
// never above this.
const LOGO_ROWS = Math.floor(LOGO.h / 2);
// Pad every logo line to the width the logo has at its TALLEST render (LOGO_ROWS) so the
// pipeline band's left edge stays at a STABLE screen column whatever height the content
// resamples to — the busy panel can now grow past the logo, which then pads below.
const LOGO_FIXED_W = displayWidth(renderLogo(0, { depth: 1, rows: LOGO_ROWS, working: false })[0]);

// How many running-agent rows to show before collapsing the rest into a "+K more" line:
// terminal height minus the panel chrome, clamped — or a generous default when unknown.
function agentRowBudget(env) {
  const lines = parseInt(env && env.LINES, 10) || (process.stdout && process.stdout.rows) || 0;
  if (!lines) return AGENT_ROWS_DEFAULT;
  return Math.max(AGENT_ROWS_MIN, Math.min(AGENT_ROWS_MAX, lines - PANEL_CHROME_ROWS - 1));
}
// Minimum band width to bother drawing the third column; below it we drop the band.
const BAND_MIN = 24;
const GUTTER = '  ';
// Stay in the "working" animation for a few seconds after the last detected activity so the
// logo doesn't flicker to idle in the gaps between assistant messages.
const ACTIVE_WINDOW_MS = 4000;

// Tier → brand color name for the running-agent dot (mirrors cli.js mixKey). No model
// (null tier) → slate.
const tierColor = (tier) => (tier === 'opus' ? 'violet' : tier === 'sonnet' ? 'cyan' : tier === 'haiku' ? 'red' : 'slate');

// Tokens billed for the session: context_window.current_usage carries the same usage
// buckets transcript lines do, so reuse the cost-model token sum.
const fmtTokens = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));

const money = (x) => '$' + Number(x).toFixed(4);

// Bar color by budget fraction: green < 70% / amber < 90% / red ≥ 90%.
const budgetHex = (frac) => (frac >= 0.9 ? COLORS.red : frac >= 0.7 ? COLORS.amber : COLORS.green);

// display_name often ends in " (1M context)"; strip that suffix for a clean label.
const stripContextSuffix = (name) => String(name || '').replace(/\s*\([^()]*context[^()]*\)\s*$/i, '').trim();

// Best-effort per-session animation frame: read ${HUD_STATE_DIR}/<id>.f, return it, and
// write back (n+1) % FRAMES. Any fs failure → 0 (the statusline still renders). A cheap
// prune drops files older than 24h once the dir grows past a cap so tmp stays bounded.
export function frameIndex(stdin, { env = process.env } = {}) {
  try {
    const dir = env.ULTRACOST_HUD_STATE_DIR || HUD_STATE_DIR;
    const id = String((stdin && stdin.session_id) || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    pruneState(dir);
    const file = join(dir, id + '.f');
    let n = 0;
    try { n = parseInt(readFileSync(file, 'utf8'), 10) || 0; } catch { n = 0; }
    n = ((n % FRAMES) + FRAMES) % FRAMES;
    try { writeFileSync(file, String((n + 1) % FRAMES)); } catch { /* read-only tmp: animation freezes, harmless */ }
    return n;
  } catch {
    return 0;
  }
}

// Drop frame files older than 24h, but only when the dir is large enough to bother (the
// statusline budget is tight — skip the stat sweep on the common small-dir case).
function pruneState(dir) {
  try {
    const names = readdirSync(dir);
    if (names.length <= 200) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const name of names) {
      try {
        const file = join(dir, name);
        if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

// Working vs idle, persisted per session in a sibling `<id>.w` state file. "Working" when
// subagents are running OR the session cost rose since the last invocation, and for a short
// grace window after. Drives which logo animation plays. Best-effort: any failure → idle.
export function hudWorking(stdin, { env = process.env, now = Date.now() } = {}) {
  try {
    const dir = env.ULTRACOST_HUD_STATE_DIR || HUD_STATE_DIR;
    const id = String((stdin && stdin.session_id) || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, id + '.w');
    let st = {};
    try { st = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { st = {}; }
    const cost = Number(stdin && stdin.cost && stdin.cost.total_cost_usd) || 0;
    let agents = 0;
    try { agents = runningAgents(stdin && stdin.transcript_path, { now }).length; } catch { agents = 0; }
    const costRose = typeof st.cost === 'number' && cost > st.cost + 1e-9;
    let active = typeof st.active === 'number' ? st.active : 0;
    if (agents > 0 || costRose) active = now;
    const working = agents > 0 || costRose || now - active < ACTIVE_WINDOW_MS;
    try { writeFileSync(file, JSON.stringify({ cost, active })); } catch { /* read-only tmp: harmless */ }
    return working;
  } catch {
    return false;
  }
}

// Minimal one-line fallback so the statusline never blanks. Uses only stdin (no fs).
export function fallbackLine(stdin) {
  let s = 'ultracost';
  try {
    const c = stdin && stdin.cost && stdin.cost.total_cost_usd;
    if (typeof c === 'number') s += ' · ' + money(c);
  } catch { /* keep the bare brand */ }
  return s;
}

// ── panel rows (each independently try/caught: one failure degrades only that row) ──

function savingsRow() {
  try {
    const entries = ledgerRead();
    if (!entries.length) return dim('↓ tracking savings…');
    const actual = entries.reduce((n, e) => n + (e.actual || 0), 0);
    const allOpus = entries.reduce((n, e) => n + (e.allOpus || 0), 0);
    const saved = entries.reduce((n, e) => n + (e.saved || 0), 0);
    const pct = allOpus ? Math.round((1 - actual / allOpus) * 100) : 0;
    return color.green('↓ ' + money(saved) + ' saved') + dim(' · ' + pct + '% vs all-opus');
  } catch {
    return dim('↓ tracking savings…');
  }
}

function todayRow(policy) {
  try {
    const today = spentToday();
    const perDay = policy && policy.budget && policy.budget.perDay;
    if (perDay == null) return 'today ' + money(today);
    const frac = perDay > 0 ? today / perDay : 0;
    return 'today ' + money(today) + ' / $' + perDay + '  ' + bar(today, perDay, 12, budgetHex(frac));
  } catch {
    return null;
  }
}

function sessionRow(stdin) {
  try {
    const cost = stdin && stdin.cost && stdin.cost.total_cost_usd;
    const usage = stdin && stdin.context_window && stdin.context_window.current_usage;
    const parts = [];
    if (typeof cost === 'number') parts.push('session ' + money(cost));
    if (usage) parts.push(fmtTokens(totalTokens(usage)) + ' Tk');
    return parts.length ? parts.join(' · ') : null;
  } catch {
    return null;
  }
}

function modelRow(stdin) {
  try {
    const name = stripContextSuffix(stdin && stdin.model && stdin.model.display_name);
    const effort = stdin && stdin.effort && stdin.effort.level;
    const cw = (stdin && stdin.context_window) || {};
    let pctNum = typeof cw.used_percentage === 'number' ? cw.used_percentage : null;
    if (pctNum == null) {
      const used = cw.current_usage ? totalTokens(cw.current_usage) : null;
      const size = cw.context_window_size;
      if (used != null && size > 0) pctNum = (used / size) * 100;
    }
    const head = [name, effort && '@ ' + effort].filter(Boolean).join(' ');
    if (pctNum == null) return head || null;
    const pct = Math.max(0, Math.min(100, Math.round(pctNum)));
    const ctxBar = bar(pct, 100, 8, budgetHex(pct / 100));
    return (head ? head + ' · ' : '') + 'ctx ' + ctxBar + ' ' + pct + '%';
  } catch {
    return null;
  }
}

// Running-agents region: header + one row per agent (up to `cap`, the rest collapsed into a
// "+K more" line), or an idle line. Each agent row truncated to the panel inner width.
function agentRows(transcriptPath, now, inner, cap) {
  const rows = [];
  let agents = [];
  try { agents = runningAgents(transcriptPath, { now }); } catch { agents = []; }
  if (!agents.length) {
    rows.push(dim('idle · no agents running'));
    return rows;
  }
  rows.push('running · ' + agents.length);
  const overflow = agents.length > cap;
  const visible = overflow ? Math.max(1, cap - 1) : agents.length;
  const shown = agents.slice(0, visible);
  for (const a of shown) {
    const tier = a.model ? a.tier : null;
    const dot = paint('●', COLORS[tierColor(tier)]);
    const secs = Math.round((a.elapsedMs || 0) / 1000);
    const elapsed = secs > 90 ? Math.round(secs / 60) + 'm' : secs + 's';
    const tag = a.kind === 'workflow-stage' ? 'wf' : a.tier || '?';
    const text = a.label + ' [' + tag + '] ' + elapsed;
    rows.push(dot + ' ' + truncate(text, inner - 2));
  }
  if (overflow) rows.push(dim('+' + (agents.length - shown.length) + ' more'));
  return rows;
}

// Compact one-line HUD for very narrow terminals: savings + today + running count.
function compactLine(stdin, now) {
  const parts = [];
  parts.push(savingsRow());
  const today = todayRowText();
  if (today) parts.push(today);
  let n = 0;
  try { n = runningAgents(stdin && stdin.transcript_path, { now }).length; } catch { n = 0; }
  parts.push(n ? 'running · ' + n : dim('idle'));
  return parts.join('  ');
}

function todayRowText() {
  try {
    const today = spentToday();
    return 'today ' + money(today);
  } catch {
    return null;
  }
}

export function composeHud(stdin, { now = Date.now(), frame, working, env = process.env } = {}) {
  try {
    const cols = parseInt(env.COLUMNS, 10) || 80;
    // Wall-clock-driven phase (seconds): the animation tracks real time, so motion is smooth
    // and consistent regardless of the irregular ~1/sec statusline refresh. Tests inject frame.
    const f = frame ?? now / 1000;
    const isWorking = typeof working === 'boolean' ? working : hudWorking(stdin, { env, now });
    const depth = colorDepth();

    let policy = null;
    try { policy = loadPolicy().policy; } catch { policy = null; }

    // Build the panel body — each row guarded inside its builder; nulls are dropped. NO blank
    // padding: the panel's natural height is the HUD's content height (idle ≈ 8 rows; grows as
    // agents run). The logo and band resample to match so nothing pads vertically.
    const inner = PANEL_MIN;
    const agentCap = agentRowBudget(env);
    const body = [];
    const push = (row) => { if (row != null) body.push(row); };
    push(savingsRow());
    push(todayRow(policy));
    push(sessionRow(stdin));
    push(modelRow(stdin));
    body.push(hr(inner));
    for (const r of agentRows(stdin && stdin.transcript_path, now, inner, agentCap)) body.push(r);

    const panelLines = panel(body, { title: 'ultracost', hex: COLORS.violet, minWidth: PANEL_MIN }).split('\n');
    const panelWidth = displayWidth(panelLines[0]);
    const contentRows = panelLines.length;

    // Logo resamples to the content height (never above its native LOGO_ROWS). Its rendered
    // width shrinks with height, so we pad each line to LOGO_FIXED_W (its width at the tallest
    // content height): the band's left edge then stays at a stable screen column as the logo
    // grows/shrinks between idle and busy.
    const logoRows = Math.min(contentRows, LOGO_ROWS);
    const rawLogo = renderLogo(f, { depth, rows: logoRows, working: isWorking });
    const logoLines = rawLogo.map((l) => pad(l, LOGO_FIXED_W));

    // Width ladder (decision 10): band → logo → panel → compact. Each column needs its width
    // plus a 2-space gutter to its left. Reserve the last terminal column (cols - 1) so Claude
    // Code's statusline never clips the band's final cell into a stray "…".
    const needPanelLogo = panelWidth + 2 + LOGO_FIXED_W;
    const bandW = cols - 1 - needPanelLogo - 2; // band fills the rest, minus a 1-col safety margin

    // The pipeline band only appears WHILE subagents are running; when idle there's nothing to
    // show, so we drop the band column entirely (panel + logo only — no empty right region).
    let agents = [];
    try { agents = runningAgents(stdin && stdin.transcript_path, { now }); } catch { agents = []; }

    if (bandW >= BAND_MIN && agents.length > 0) {
      // All three columns. The band is content-driven height too (one lane per agent, capped).
      const band = renderPipeline(agents, { width: bandW, rows: contentRows, frame: f, depth, working: isWorking, maxLanes: agentCap });
      return joinColumns([panelLines, logoLines, band], [panelWidth, LOGO_FIXED_W, bandW]);
    }
    if (cols >= needPanelLogo) {
      // Panel + logo only (today's two-column layout, now content-height instead of fixed).
      return joinColumns([panelLines, logoLines], [panelWidth, LOGO_FIXED_W]);
    }
    if (cols >= panelWidth) return panelLines.join('\n'); // panel only
    return compactLine(stdin, now);                       // very narrow → one line
  } catch {
    return fallbackLine(stdin);
  }
}

// Side-join 2+ equal-height columns with a 2-space gutter between each. Every column is an
// array of EXACTLY `contentRows` lines of its declared width (the panel sets the height; the
// logo and band are rendered to it), so no vertical centring/padding is needed. The panel box
// (│ … │) keeps every composed line starting with a non-space, pinning the right columns in
// place against Claude Code's per-line leading-whitespace trim.
function joinColumns(cols, widths) {
  const h = Math.max(...cols.map((c) => c.length));
  const out = [];
  for (let i = 0; i < h; i++) {
    const cells = cols.map((c, ci) => pad(c[i] ?? '', widths[ci]));
    out.push(cells.join(GUTTER));
  }
  return out.join('\n');
}
