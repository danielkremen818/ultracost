import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadPolicy } from './policy.js';
import { scan, fixFile, collectFiles, auditScripts, stageList, CODES } from './guard.js';
import { estimateFile, scenarioTotals } from './estimate.js';
import { refreshPricing, writePricingToPolicy, DEFAULT_PRICING_URL } from './pricing.js';
import { install, uninstall, setStatusLine, restoreStatusLine } from './install.js';
import { detectDelivery } from './detect.js';
import { readTranscripts, locateWorkflowRuns } from './transcript.js';
import { costFromUsage, modelPrice, totalTokens } from './cost.js';
import { tierOfModel, classifyPrompt, semanticFindings } from './classify.js';
import {
  reconcileRun, calibrationFromRuns, writeCalibration, readCalibration, applyCalibration,
  ledgerSync, spentToday
} from './loop.js';
import {
  ROOT, CLAUDE_MD, HOOK_PATH, POLICY_PATH, SETTINGS, PROJECTS_DIR, CALIBRATION_PATH, LEDGER_PATH, tilde, safePath
} from './paths.js';
import { log, ok, warn, err, info } from './log.js';
import { color, dim, bold, panel, columns, bar, sparkline, gradient, symbols, COLORS } from './render.js';
import { composeHud, fallbackLine } from './hud.js';

const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

// Per-invocation context, assigned by run(). Kept at module scope so the command
// handlers below read it exactly as the original top-level script did, while staying
// importable + unit-testable (run() is called once per process by the bin shim, and
// sequentially — never concurrently — by the tests).
let argv = [];
let cmd = 'help';
let positional = [];
let CWD = '.';
let NPX = false;
let SELF = 'ultracost';

// process.exit() bypasses the catch in the original script. We mirror that by throwing
// a typed signal that run() translates into the process exit code, so error/usage
// branches are coverable in-process without killing the test runner.
export class CliExit extends Error {
  constructor(code) {
    super('cli exit ' + code);
    this.code = code;
  }
}
function exit(code) { throw new CliExit(code); }

// Reads the module-level argv that run() refreshes on each invocation.
const has = (flag) => argv.includes(flag);

const money = (x) => '$' + Number(x).toFixed(4);
const money6 = (x) => '$' + Number(x);
const title = (t) => log(gradient(t, COLORS.violet, COLORS.cyan));

// All CLI logic, importable. Returns the process exit code (0 = success). Behavior is
// identical to the original bin/cli.js; the bin shim just forwards process.argv.
export async function run(argvIn = [], { cwd = process.cwd(), argv1 = process.argv[1] || '' } = {}) {
  argv = argvIn;
  cmd = argv[0] || 'help';
  positional = argv.slice(1).filter((a) => !a.startsWith('-'));
  CWD = cwd;
  // When invoked through `npx ultracost ...`, the binary isn't on PATH afterwards, so
  // printed hints must keep the `npx` prefix (npx caches under .../_npx/).
  NPX = argv1.includes('/_npx/');
  SELF = NPX ? 'npx ultracost' : 'ultracost';

  try {
    await dispatch();
    return 0;
  } catch (e) {
    if (e instanceof CliExit) return e.code;
    err(e.message);
    return 1;
  }
}

async function dispatch() {
  switch (cmd) {
    case 'init': case 'install': cmdInit(); break;
    case 'check': case 'guard': cmdCheck(); break;
    case 'audit': cmdAudit(); break;
    case 'estimate': cmdEstimate(); break;
    case 'explain': cmdExplain(); break;
    case 'simulate': cmdSimulate(); break;
    case 'diff': cmdDiff(); break;
    case 'pricing': await cmdPricing(); break;
    case 'usage': cmdUsage(); break;
    case 'reconcile': cmdReconcile(); break;
    case 'calibrate': cmdCalibrate(); break;
    case 'ledger': case 'savings': cmdLedger(); break;
    case 'status': cmdStatus(); break;
    case 'doctor': cmdDoctor(); break;
    case 'uninstall': cmdUninstall(); break;
    case 'hud': await cmdHud(); break;
    case '-v': case '--version': case 'version': log(version); break;
    case 'help': case '-h': case '--help': cmdHelp(); break;
    default:
      err(`Unknown command: ${cmd}`);
      cmdHelp();
      exit(1);
  }
}

function cmdHelp() {
  log('');
  title('  ultracost');
  log('  ' + dim('v' + version + ' — per-stage model routing for Claude Code workflows'));
  log('');
  log(bold('  Routing & guard'));
  log(columns([
    ['init', 'Install routing rules, hook, and default policy'],
    ['check [path]', 'Flag agent() stages that would inherit the session model'],
    ['audit [dir]', 'Pin stats across your real workflow scripts'],
    ['explain <script>', 'Per-stage rationale: tier, effort, tokens, cost, warnings']
  ], { indent: 2, gap: 3 }));
  log('');
  log(bold('  Cost'));
  log(columns([
    ['estimate <script>', 'Agents, model mix, and cost vs an all-opus baseline'],
    ['simulate <script>', 'Cost under alternative policies, side by side'],
    ['diff <a> <b>', 'Cost delta between two workflow versions (--ci for PRs)'],
    ['usage [dir]', 'Real token cost from local transcripts (main vs subagents)'],
    ['reconcile [--last]', 'Estimate vs actual for a real workflow run'],
    ['ledger', 'Cumulative savings vs all-opus across recorded runs'],
    ['calibrate', 'Tune the estimator from your real token usage'],
    ['pricing [refresh]', "Show pricing, or refresh from Anthropic's official page"]
  ], { indent: 2, gap: 3 }));
  log('');
  log(bold('  State'));
  log(columns([
    ['status', 'Active policy + how ultracost is delivered (plugin/cli)'],
    ['doctor', 'Diagnose the installation'],
    ['uninstall', 'Remove everything the CLI installed']
  ], { indent: 2, gap: 3 }));
  log('');
  log(bold('  HUD'));
  log(columns([
    ['hud', 'Live cost + savings + running agents statusline'],
    ['hud --preview', 'Render the HUD with sample data'],
    ['hud --install', 'Set ultracost as your Claude Code statusline (reversible)'],
    ['hud --uninstall', 'Restore your previous statusline']
  ], { indent: 2, gap: 3 }));
  log('');
  info(`  policy: ${tilde(POLICY_PATH)}   ·   flags: --json --fix --quiet`);
  log('');
}

function cmdInit() {
  const d = detectDelivery();
  if (d.verdict === 'plugin' && !has('--force')) {
    log(panel([
      `${color.green('●')} ultracost is already delivered by the plugin ${dim('(enabled + hooks active' + (d.plugin.version ? ', v' + d.plugin.version : '') + ')')}`,
      '',
      dim('Running init would write duplicate routing rules into ~/.claude that conflict'),
      dim('with plugin delivery. Use the plugin as-is, or:'),
      `  ${color.cyan(SELF + ' init --force')}   ${dim('install the CLI path too (advanced)')}`
    ], { title: 'init skipped', hex: COLORS.amber }));
    return;
  }

  const { policy, source } = loadPolicy();
  const r = install(policy, { force: has('--force') });
  log('');
  title('  ultracost init');
  log('');
  ok(`policy: ${r.policy} ${dim('(' + tilde(POLICY_PATH) + ')')}`);
  ok(`rules: ${r.rules} ${dim('(' + tilde(CLAUDE_MD) + ')')}`);
  ok(`hook: ${r.hook} ${dim('(' + tilde(HOOK_PATH) + ')')}`);
  if (r.register === 'invalid') warn('settings.json is invalid JSON — register the hook manually');
  else {
    ok(`hook ${r.register} ${dim('in ' + tilde(SETTINGS))}`);
    ok(`stop hook ${r.stop} ${dim('(closed-loop autorun)')}`);
  }
  if (r.statusLine !== undefined) ok(`statusLine: ${r.statusLine} ${dim('(live cost HUD · restores on uninstall)')}`);
  if (d.verdict === 'both' || d.plugin.enabled) {
    log('');
    warn('the plugin is also active — you now have dual delivery; rules may be injected twice.');
    info(`remove one: /plugin uninstall ultracost@ultracost  (or)  ${SELF} uninstall`);
  }
  log('');
  info(`active policy from ${tilde(source)} — new sessions pick this up immediately.`);
  log('');
}

function severityGlyph(sev) {
  if (sev === 'error') return color.red(symbols.err);
  // Findings only ever carry severity 'error' or 'warn'.
  return color.amber(symbols.warn);
}

function cmdCheck() {
  const target = positional[0] ? safePath(positional[0]) : CWD;
  const { policy } = loadPolicy();

  if (has('--fix')) {
    const targets = collectFiles(target);
    let fixed = 0;
    for (const f of targets) fixed += fixFile(f, policy);
    ok(`applied ${fixed} fix(es) across ${targets.length} file(s)`);
  }

  const { findings, files } = scan(target, policy);
  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');

  if (has('--json')) {
    log(JSON.stringify({ target, files: files.length, findings }, null, 2));
    exit(errors.length ? 1 : 0);
  }

  log('');
  if (!findings.length) {
    log(panel([`${color.green(symbols.ok)} every agent() stage pins a model`], { title: `check · ${files.length} file(s)`, hex: COLORS.green }));
    log('');
    return;
  }

  // group findings by file
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, fs] of byFile) {
    const e = fs.filter((x) => x.severity === 'error').length;
    const w = fs.filter((x) => x.severity === 'warn').length;
    const head = `${tilde(file)}  ${e ? color.red(e + ' error' + (e > 1 ? 's' : '')) : ''}${e && w ? dim(' · ') : ''}${w ? color.amber(w + ' warning' + (w > 1 ? 's' : '')) : ''}`;
    log('  ' + bold(head));
    for (const f of fs) {
      const tag = f.severity === 'error' ? color.red(f.code) : color.amber(f.code);
      log(`    ${severityGlyph(f.severity)} ${dim(f.line + ':' + f.column)}  ${tag}  ${f.message}`);
      if (!has('--quiet')) log(`      ${dim(f.snippet)}`);
    }
    log('');
  }
  const summary = `${errors.length ? color.red(errors.length + ' error(s)') : color.green('0 errors')}  ·  ${warns.length ? color.amber(warns.length + ' warning(s)') : dim('0 warnings')}  ${dim('in ' + files.length + ' file(s)')}`;
  log('  ' + summary);
  if (errors.length) {
    info(`  fix the unambiguous ones: ${SELF} check ${positional[0] || '.'} --fix`);
    log('');
    exit(1);
  }
  log('');
}

function cmdAudit() {
  const base = positional[0] ? safePath(positional[0]) : PROJECTS_DIR;
  const { policy } = loadPolicy();
  const { files, totals } = auditScripts(base, policy);

  if (has('--json')) {
    log(JSON.stringify({ base, ...totals }, null, 2));
    return;
  }

  log('');
  title('  ultracost audit');
  log('');
  if (!files.length) {
    warn(`no workflow scripts found under ${tilde(base)}`);
    info(`looked for ${tilde(base)}/**/workflows/scripts/*.js`);
    return;
  }
  info(`  scanned ${totals.scripts} script(s) under ${tilde(base)}`);
  log('');
  const pinnedPct = totals.stages ? (totals.pinned / totals.stages) * 100 : 0;
  const unpinnedPct = totals.unpinnedRatio * 100;
  log(columns([
    ['agent() stages', String(totals.stages)],
    ['pinned', color.green(String(totals.pinned))],
    ['unpinned', color.red(String(totals.unpinned)), dim('UC001/UC002 — inherit the session model')],
    ['banned', String(totals.banned), dim('UC003')],
    ['inherit', String(totals.inherit), dim('UC004')],
    ['dynamic', String(totals.dynamic), dim('UC005')],
    ['wrong-tier', String(totals.wrongTier ?? 0), dim('UC006/UC008')],
    ['over-effort', String(totals.overEffort ?? 0), dim('UC007')]
  ], { indent: 2, gap: 2, align: ['left', 'right', 'left'] }));
  log('');
  log('  ' + bold('pinned   ') + bar(totals.pinned, totals.stages || 1, 30, COLORS.green) + `  ${pinnedPct.toFixed(1)}%`);
  log('  ' + bold('unpinned ') + bar(totals.unpinned, totals.stages || 1, 30, COLORS.red) + `  ${unpinnedPct.toFixed(1)}%`);
  log('');
}

function cmdEstimate() {
  if (!positional[0]) { err(`usage: ${SELF} estimate <workflow-script.js> [--json]`); exit(1); }
  const target = safePath(positional[0]);
  if (!existsSync(target)) { err(`not found: ${target}`); exit(1); }
  const { policy } = loadPolicy();
  const cal = readCalibration();
  const est = estimateFile(target, applyCalibration(policy, cal));

  if (has('--json')) {
    log(JSON.stringify({ target, calibrated: !!cal, ...est }, null, 2));
    return;
  }

  const a = est.agents;
  const fan = a.fanoutGroups ? `${a.known} fixed + ${a.fanoutGroups} fan-out x ~${a.assumedPerFanout} = ~${a.assumedTotal}` : `${a.known}`;
  const mix = Object.entries(est.modelMix).map(([k, v]) => color[mixKey(k)](`${v}x ${k}`)).join('  ') || 'none';

  log('');
  title('  ultracost estimate');
  log('  ' + dim(tilde(target)));
  log('');
  log(columns([
    ['agents', fan],
    ['model mix', mix]
  ], { indent: 2, gap: 3 }));
  log('');
  const pct = est.cost.savingsPct;
  log(columns([
    [dim('baseline'), dim('all ' + est.assumptions.sessionModel), money(est.cost.baseline)],
    ['tiered', dim('ultracost'), money(est.cost.tiered)],
    [color.green('savings'), color.green(pct + '%'), color.green(money(est.cost.savings))]
  ], { indent: 2, gap: 3, align: ['left', 'left', 'right'] }));
  log('');
  log('  ' + bar(est.cost.savings, est.cost.baseline || 1, 30, COLORS.green) + `  ${pct}% saved`);
  log('');
  info(`  estimate; pricing as of ${est.assumptions.pricingAsOf || 'n/a'}; fan-out assumes ~${a.assumedPerFanout} items/group; unpinned stages inherit ${est.assumptions.sessionModel}.`);
  if (cal) info(`  token prior calibrated from your real runs (${SELF} calibrate; ${cal.samples} samples).`);
  if (pct === 0 && est.stages.length) info('  tip: pin cheaper tiers (sonnet) on mechanical stages to cut cost.');
  log('');
}

function cmdUsage() {
  const { policy } = loadPolicy();
  const records = readTranscripts({ root: positional[0] ? safePath(positional[0]) : undefined });
  if (has('--json')) {
    const rows = records.map((r) => ({ kind: r.kind, model: r.model, project: r.project, cost: costFromUsage(r.usage, modelPrice(r.model, policy), policy), tokens: totalTokens(r.usage) }));
    log(JSON.stringify({ records: rows.length, rows }, null, 2));
    return;
  }
  log('');
  title('  ultracost usage');
  log('  ' + dim('real token cost from local transcripts'));
  log('');
  if (!records.length) { warn('no transcripts found under your Claude Code projects dir'); log(''); return; }

  const byKind = {};
  const byModel = {};
  let total = 0;
  let tokens = 0;
  for (const r of records) {
    const cost = costFromUsage(r.usage, modelPrice(r.model, policy), policy);
    const tk = totalTokens(r.usage);
    total += cost; tokens += tk;
    byKind[r.kind] = (byKind[r.kind] || 0) + cost;
    const mk = tierOfModel(r.model);
    byModel[mk] = (byModel[mk] || 0) + cost;
  }
  log(panel([
    `${bold(money(total))}  ${dim('across ' + records.length + ' assistant turns · ' + fmt(tokens) + ' tokens')}`
  ], { title: 'total cost', hex: COLORS.violet }));
  log('');
  const kindRows = ['main', 'subagent', 'workflow-stage'].filter((k) => byKind[k]).map((k) => [k, money(byKind[k])]);
  log(columns(kindRows, { indent: 2, gap: 3, align: ['left', 'right'] }));
  log('');
  const maxModel = Math.max(1, ...Object.values(byModel));
  for (const [k, v] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) {
    log('  ' + color[mixKey(k)](pad9(k)) + ' ' + bar(v, maxModel, 26, COLORS[mixKey(k)]) + '  ' + money(v));
  }
  log('');
}
function pad9(s) { return (s + '         ').slice(0, 9); }

function pickRun(runs) {
  if (has('--last')) return runs[0];
  if (positional[0]) return runs.find((r) => r.wfId.includes(positional[0])) || null;
  return runs[0];
}

function cmdReconcile() {
  const { policy } = loadPolicy();
  const runs = locateWorkflowRuns();
  if (!runs.length) { warn('no dynamic-workflow runs found in your transcripts yet'); return; }
  const run = pickRun(runs);
  if (!run) { err(`no workflow run matching "${positional[0]}"`); exit(1); }
  const rec = reconcileRun(run, policy);

  if (has('--json')) { log(JSON.stringify(rec, null, 2)); return; }

  log('');
  title('  ultracost reconcile');
  log('  ' + dim(rec.wfId + ' · ' + (rec.ts ? rec.ts.slice(0, 10) : '') + ' · ' + rec.stages.length + ' stages'));
  log('');
  const rows = rec.stages.map((s, i) => [
    dim('#' + (i + 1)),
    color[mixKey(s.tier)](s.tier),
    fmt(s.tokens),
    money(s.actualCost),
    dim(money(s.opusCost))
  ]);
  log(columns(rows, { indent: 2, gap: 3, align: ['right', 'left', 'right', 'right', 'right'], head: [dim('#'), 'tier', 'tokens', 'actual', 'all-opus'] }));
  log('');
  const t = rec.totals;
  log(columns([
    [dim('actual'), money(t.actual)],
    [dim('all-opus baseline'), money(t.allOpus)],
    [color.green('saved'), color.green(money(t.saved) + '  (' + t.savedPct + '%)')]
  ], { indent: 2, gap: 3, align: ['left', 'right'] }));
  log('  ' + bar(t.saved, t.allOpus || 1, 30, COLORS.green) + `  ${t.savedPct}% saved`);
  log('');
  info('  reconciled from real per-stage token usage (subagents/workflows/wf_*/agent-*.jsonl).');
  log('');
}

function cmdCalibrate() {
  const { policy } = loadPolicy();
  const runs = locateWorkflowRuns();
  const cal = calibrationFromRuns(runs, policy);
  if (!cal) { warn('not enough real workflow-stage data to calibrate yet'); return; }
  const path = writeCalibration(cal);

  if (has('--json')) { log(JSON.stringify(cal, null, 2)); return; }
  log('');
  title('  ultracost calibrate');
  log('');
  const lines = [
    `samples   ${cal.samples} stages from ${cal.runs} run(s) ${dim('(' + cal.droppedOutliers + ' outliers dropped)')}`,
    `tokens/stage   ${fmt(cal.tokensPerStage.input)} in / ${fmt(cal.tokensPerStage.output)} out`
  ];
  for (const [k, v] of Object.entries(cal.perModel)) lines.push(`  ${color[mixKey(k)](k)}   ${fmt(v.input)} in / ${fmt(v.output)} out ${dim('(' + v.samples + ')')}`);
  log(panel(lines, { title: 'calibrated token prior', hex: COLORS.cyan }));
  log('');
  ok(`written to ${tilde(path)} — ${SELF} estimate now uses your real token sizes.`);
  log('');
}

function cmdLedger() {
  const { policy } = loadPolicy();
  const runs = locateWorkflowRuns();
  const entries = ledgerSync(runs, policy);

  if (has('--json')) { log(JSON.stringify({ entries }, null, 2)); return; }
  log('');
  title('  ultracost ledger');
  log('  ' + dim('cumulative savings vs an all-opus baseline'));
  log('');
  if (!entries.length) { warn('no recorded workflow runs yet — run some ultracode workflows, then re-check'); log(''); return; }
  const saved = entries.reduce((n, e) => n + (e.saved || 0), 0);
  const actual = entries.reduce((n, e) => n + (e.actual || 0), 0);
  const allOpus = entries.reduce((n, e) => n + (e.allOpus || 0), 0);
  const pct = allOpus ? Math.round((1 - actual / allOpus) * 100) : 0;
  log(panel([
    `${color.green(bold(money(saved)))}  ${dim('saved across ' + entries.length + ' run(s)')}`,
    `${dim('actual ' + money(actual) + '  ·  all-opus ' + money(allOpus) + '  ·  ' + pct + '% saved')}`,
    `${dim('today: ' + money(spentToday(entries)))}`
  ], { title: 'savings ledger', hex: COLORS.green }));
  log('');
  const spark = sparkline(entries.map((e) => e.saved), COLORS.green);
  if (spark) log('  per-run saved  ' + spark);
  log('  ' + dim(`ledger at ${tilde(LEDGER_PATH)}`));
  log('');
}

function mixKey(k) {
  return k === 'opus' ? 'violet' : k === 'sonnet' ? 'cyan' : k === 'haiku' ? 'red' : 'slate';
}

function cmdExplain() {
  if (!positional[0]) { err(`usage: ${SELF} explain <workflow-script.js>`); exit(1); }
  const target = safePath(positional[0]);
  if (!existsSync(target)) { err(`usage: ${SELF} explain <workflow-script.js>`); exit(1); }
  const { policy } = loadPolicy();
  const pol = applyCalibration(policy);
  const est = estimateFile(target, pol);
  const stages = stageList(readFileSync(target, 'utf8'));

  if (has('--json')) {
    const out = est.stages.map((s, i) => {
      const prompt = stages[i]?.prompt || null;
      const cls = prompt ? classifyPrompt(prompt, policy) : null;
      return { line: s.line, model: s.model, effort: s.effort, fanout: s.fanout, pinned: s.pinned, tieredCost: s.tieredCost, prompt, classified: cls };
    });
    log(JSON.stringify({ target, stages: out }, null, 2));
    return;
  }

  log('');
  title('  ultracost explain');
  log('  ' + dim(tilde(target)) + (pol._calibrated ? dim('  · calibrated') : ''));
  log('');
  const rows = est.stages.map((s, i) => {
    const prompt = stages[i]?.prompt;
    const cls = prompt ? classifyPrompt(prompt, policy) : null;
    const reads = cls && cls.tier ? `${cls.tier}${cls.confidence === 'high' ? '' : '?'}` : dim('—');
    const flags = prompt
      ? semanticFindings({ model: s.model, effort: s.effort, prompt }, policy, CODES).map((f) => f.code)
      : [];
    const tierName = tierOfModel(s.model);
    return [
      dim('#' + (i + 1)),
      color[mixKey(tierName)](s.model) + (s.fanout ? dim(' xN') : ''),
      s.effort || dim('—'),
      reads,
      money(s.tieredCost),
      flags.length ? color.amber(flags.join(',')) : color.green('ok')
    ];
  });
  log(columns(rows, {
    indent: 2, gap: 3,
    align: ['right', 'left', 'left', 'left', 'right', 'left'],
    head: [dim('#'), 'model', 'effort', 'reads-like', 'est', 'check']
  }));
  log('');
  log('  ' + dim(`${est.agents.assumedTotal} agents · tiered ${money(est.cost.tiered)} · ${est.cost.savingsPct}% under all-${est.assumptions.sessionModel}`));
  info(`  "reads-like" is the tier the prompt looks like; a "?" means low confidence. Flags: UC006 wrong-tier, UC007 over-effort, UC008 alwaysOpus.`);
  log('');
}

function cmdSimulate() {
  if (!positional[0]) { err(`usage: ${SELF} simulate <workflow-script.js>`); exit(1); }
  const target = safePath(positional[0]);
  if (!existsSync(target)) { err(`usage: ${SELF} simulate <workflow-script.js>`); exit(1); }
  const { policy } = loadPolicy();
  const s = scenarioTotals(readFileSync(target, 'utf8'), applyCalibration(policy));

  if (has('--json')) { log(JSON.stringify({ target, ...s }, null, 2)); return; }

  log('');
  title('  ultracost simulate');
  log('  ' + dim(tilde(target) + ' · ' + s.stages + ' stage(s)'));
  log('');
  const max = Math.max(s.allOpus, s.allSonnet, s.tiered, 1e-9);
  const row = (label, val, hex, note) => log('  ' + bold(pad14(label)) + ' ' + bar(val, max, 24, hex) + '  ' + money(val) + (note ? '  ' + dim(note) : ''));
  row('all-opus', s.allOpus, COLORS.violet, 'unguided ultracode default');
  row('tiered (yours)', s.tiered, COLORS.green, `${s.allOpus ? Math.round((1 - s.tiered / s.allOpus) * 100) : 0}% under all-opus`);
  row('all-sonnet', s.allSonnet, COLORS.cyan, 'aggressive cost-first');
  log('');
  info('  relative estimate; tiered is your current per-stage pins. Quality-first keeps reasoning on opus.');
  log('');
}
function pad14(s) { return (s + '              ').slice(0, 14); }

function cmdDiff() {
  if (!positional[0] || !positional[1]) { err(`usage: ${SELF} diff <old-script.js> <new-script.js> [--ci]`); exit(1); }
  const a = safePath(positional[0]);
  const b = safePath(positional[1]);
  if (!existsSync(a) || !existsSync(b)) { err(`usage: ${SELF} diff <old-script.js> <new-script.js> [--ci]`); exit(1); }
  const { policy } = loadPolicy();
  const pol = applyCalibration(policy);
  const ea = estimateFile(a, pol);
  const eb = estimateFile(b, pol);
  const dCost = eb.cost.tiered - ea.cost.tiered;
  const dAgents = eb.agents.assumedTotal - ea.agents.assumedTotal;
  const pct = ea.cost.tiered ? Math.round((dCost / ea.cost.tiered) * 100) : 0;

  if (has('--json')) {
    log(JSON.stringify({ a, b, old: ea.cost, new: eb.cost, deltaTiered: dCost, deltaAgents: dAgents }, null, 2));
    return;
  }
  if (has('--ci')) {
    const sign = dCost >= 0 ? '+' : '−';
    log('## ultracost cost diff');
    log('');
    log('| version | agents | tiered | vs all-opus |');
    log('|---|---|---|---|');
    log(`| \`${basename(a)}\` | ${ea.agents.assumedTotal} | ${money(ea.cost.tiered)} | ${ea.cost.savingsPct}% |`);
    log(`| \`${basename(b)}\` | ${eb.agents.assumedTotal} | ${money(eb.cost.tiered)} | ${eb.cost.savingsPct}% |`);
    log('');
    log(`**Δ tiered cost: ${sign}${money(Math.abs(dCost))} (${pct >= 0 ? '+' : ''}${pct}%)** · Δ agents: ${dAgents >= 0 ? '+' : ''}${dAgents}`);
    return;
  }

  log('');
  title('  ultracost diff');
  log('  ' + dim(`${basename(a)} → ${basename(b)}`));
  log('');
  log(columns([
    [dim(basename(a)), `${ea.agents.assumedTotal} agents`, money(ea.cost.tiered)],
    [dim(basename(b)), `${eb.agents.assumedTotal} agents`, money(eb.cost.tiered)]
  ], { indent: 2, gap: 3, align: ['left', 'right', 'right'] }));
  log('');
  const up = dCost > 0;
  const deltaStr = `${up ? '+' : ''}${money(dCost)}  (${pct >= 0 ? '+' : ''}${pct}%)  ·  ${dAgents >= 0 ? '+' : ''}${dAgents} agents`;
  log('  ' + bold('Δ ') + (up ? color.red(deltaStr) : color.green(deltaStr)));
  log('');
}

async function cmdPricing() {
  const { policy } = loadPolicy();
  if (positional[0] === 'refresh') {
    const urlIdx = argv.indexOf('--url');
    const url = urlIdx !== -1 ? argv[urlIdx + 1] : undefined;
    info(`fetching official pricing from ${url || policy.pricing?._source || DEFAULT_PRICING_URL} ...`);
    const updated = await refreshPricing(policy, { url });
    const path = writePricingToPolicy(updated);
    ok(`pricing updated in ${tilde(path)} (as of ${updated._asOf})`);
    showPricing(updated);
    return;
  }
  showPricing(policy.pricing);
}

function showPricing(pr) {
  log('');
  title('  ultracost pricing');
  log('  ' + dim('USD per million tokens' + (pr?._asOf ? ' · as of ' + pr._asOf : '')));
  log('');
  const rows = ['opus', 'sonnet', 'haiku'].filter((k) => pr?.[k]).map((k) => [
    color[mixKey(k)](k), money6(pr[k].input) + ' in', money6(pr[k].output) + ' out'
  ]);
  log(columns(rows, { indent: 2, gap: 3, align: ['left', 'right', 'right'] }));
  log('');
  if (pr?._source) info(`  source: ${pr._source}`);
  info(`  refresh: ${SELF} pricing refresh`);
  log('');
}

function deliveryHex(v) {
  return v === 'none' ? COLORS.red : v === 'both' ? COLORS.amber : COLORS.green;
}

function cmdStatus() {
  const { policy, source } = loadPolicy();
  const d = detectDelivery();
  log('');
  title('  ultracost status');
  log('');

  const dot = (on) => (on ? color.green('●') : dim('○'));
  const dl = [];
  const pluginActive = d.verdict === 'plugin' || d.verdict === 'both';
  const cliActive = d.verdict === 'cli' || d.verdict === 'both';
  dl.push(`${dot(pluginActive)} plugin   ${pluginActive ? color.green('active') : dim('not enabled')}` +
    (pluginActive ? '  ' + dim('v' + (d.plugin.version || '?') + ' · SessionStart + PreToolUse hooks') : ''));
  dl.push(`${dot(cliActive)} cli      ${cliActive ? color.green('active') : dim('not installed')}` +
    (cliActive ? '  ' + dim('~/.claude/CLAUDE.md + SessionStart hook') : ''));
  log(panel(dl, { title: 'delivery · ' + d.verdict, hex: deliveryHex(d.verdict) }));
  log('');

  const tierRows = Object.entries(policy.tiers).map(([name, t]) => [
    color[mixKey(t.model)] ? color[mixKey(t.model)](name) : name,
    `${t.model}${t.effort ? ' @ ' + t.effort : ''}`,
    name === policy.default ? color.green('default') : ''
  ]);
  log(panel([
    columns(tierRows, { gap: 3, align: ['left', 'left', 'left'] }),
    dim('never: ' + (policy.neverUse.join(', ') || 'none'))
  ].join('\n').split('\n'), { title: 'policy', hex: COLORS.violet }));
  log('');

  // Caveats that change behavior, surfaced loudly.
  if (d.bypass) {
    warn(`permission mode is ${bold(d.permissionMode || 'bypassPermissions')} — the gate's ask path auto-approves, so clean workflows won't pause.`);
    info('unpinned/banned workflows are still hard-denied; turn off bypass (shift+tab) for the full pre-flight stop.');
  }
  if (d.verdict === 'both') warn('dual delivery: plugin AND cli both active — rules may be injected twice. Remove one.');
  if (d.verdict === 'none') warn(`ultracost is not active — install the plugin or run ${SELF} init.`);
  if (d.gateEnv) info(`ULTRACOST_GATE=${d.gateEnv}`);
  if (d.settingsInvalid) err('settings.json or settings.local.json is invalid JSON');
  info(`policy source: ${tilde(source)}`);
  log('');
}

function cmdDoctor() {
  const d = detectDelivery();
  const lines = [];
  let issues = 0;
  const add = (good, label, detail) => {
    lines.push(`${good ? color.green(symbols.ok) : color.amber(symbols.warn)} ${label}${detail ? '  ' + dim(detail) : ''}`);
    if (!good) issues++;
  };

  try {
    const { policy } = loadPolicy();
    add(true, `policy valid ${dim('(' + Object.keys(policy.tiers).length + ' tiers)')}`);
  } catch (e) {
    add(false, 'policy invalid', e.message);
  }

  if (d.verdict === 'plugin' || d.verdict === 'both') {
    add(d.plugin.hooks.sessionStart, 'plugin SessionStart policy injection');
    add(d.plugin.hooks.preToolUse, 'plugin PreToolUse cost gate');
  } else if (d.verdict === 'cli') {
    add(d.cli.rules, 'routing rules in ~/.claude/CLAUDE.md');
    add(d.cli.settingsHook, 'SessionStart hook registered');
    add(d.cli.hook, 're-inject hook installed');
  } else {
    add(false, 'ultracost is not active', `install the plugin (/plugin install ultracost@ultracost) or run ${SELF} init`);
  }

  if (d.verdict === 'both') { lines.push(`${color.amber(symbols.warn)} dual delivery — plugin AND cli both active; remove one to avoid double-injected rules`); issues++; }
  if (d.settingsInvalid) { lines.push(`${color.red(symbols.err)} settings.json or settings.local.json is invalid JSON`); issues++; }
  if (d.bypass) lines.push(dim(`note: ${d.permissionMode || 'bypass'} mode auto-approves the gate's ask path; unpinned workflows are still hard-denied`));
  lines.push(dim('note: pin per stage via the agent() model param — subagent frontmatter "model:" is ignored on some Claude Code 2.1.x (claude-code#52681)'));

  log('');
  log(panel(lines, { title: issues ? `doctor · ${issues} issue(s)` : 'doctor · all clear', hex: issues ? COLORS.amber : COLORS.green }));
  log('');
  if (issues) { info(`fix: ${SELF} init  (cli)  or  /plugin install ultracost@ultracost  (plugin)`); exit(1); }
}

function cmdUninstall() {
  const r = uninstall();
  log('');
  title('  ultracost uninstall');
  log('');
  for (const [k, v] of Object.entries(r)) info(`  ${k}: ${v}`);
  ok('done.');
  const d = detectDelivery();
  if (d.plugin.enabled) {
    log('');
    info('note: the plugin is still installed — remove it in Claude Code with:');
    info('  /plugin uninstall ultracost@ultracost   then   /plugin marketplace remove ultracost');
  }
  log('');
}

// Sample stdin for `hud --preview` (and the TTY fallback): a representative statusline
// payload so the HUD renders with realistic numbers without a live Claude Code session.
const HUD_SAMPLE = {
  session_id: 'preview',
  transcript_path: '/tmp/ultracost-hud-preview.jsonl',
  model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8 (1M context)' },
  effort: { level: 'xhigh' },
  cost: { total_cost_usd: 0.21 },
  context_window: { used_percentage: 41, context_window_size: 1000000 }
};

// The `ultracost hud` statusline command. Four modes:
//   --preview    render the HUD with sample data (respects FORCE_COLOR via render kit)
//   --install    set ourselves as the Claude Code statusLine (reversible)
//   --uninstall  restore the previous statusLine
//   (bare)       render mode: read the piped statusline JSON on fd 0 and print the HUD.
// Render mode is wrapped end-to-end so it NEVER throws and ALWAYS exits 0 — on any
// failure it emits fallbackLine(), and as a last resort the literal "ultracost".
async function cmdHud() {
  if (has('--preview')) {
    process.stdout.write(composeHud(HUD_SAMPLE, { env: process.env }) + '\n');
    return;
  }

  if (has('--install')) {
    const r = setStatusLine({ plugin: !!process.env.CLAUDE_PLUGIN_ROOT });
    log('');
    title('  ultracost hud');
    log('');
    if (r === 'invalid') {
      warn('settings.json is invalid JSON — set the statusLine manually.');
      log('');
      return;
    }
    ok(`statusLine: ${r}`);
    log('');
    log('ultracost set itself as your Claude Code statusline — a live HUD of cost, savings');
    log('vs all-opus, and the subagents running right now with the model each is routed to.');
    log('Your previous statusline (if any) was backed up and will be restored on uninstall.');
    log(`Re-run ${color.cyan('/ultracost:hud')} any time to preview, re-setup, or disable it.`);
    log('');
    return;
  }

  if (has('--uninstall')) {
    const r = restoreStatusLine();
    log('');
    title('  ultracost hud');
    log('');
    const said = {
      restored: 'restored your previous statusline.',
      removed: 'removed the ultracost statusline (no previous one to restore).',
      kept: 'left your statusline alone — it is no longer the ultracost HUD.',
      absent: 'no statusline was set; nothing to do.',
      invalid: 'settings.json is invalid JSON — restore the statusLine manually.'
    }[r] || `statusLine: ${r}`;
    (r === 'invalid' ? warn : ok)(said);
    log('');
    return;
  }

  // Render mode. Output goes straight to stdout (it IS the statusline). Never throw.
  let out;
  try {
    let stdin;
    // NEVER block on fd 0: an interactive TTY would hang waiting for input, so fall
    // back to sample data. Claude Code always pipes a complete JSON blob (not a TTY).
    if (process.stdin.isTTY) {
      stdin = HUD_SAMPLE;
    } else {
      stdin = JSON.parse(readFileSync(0, 'utf8'));
    }
    out = composeHud(stdin, { env: process.env });
  } catch {
    try { out = fallbackLine(); } catch { out = 'ultracost'; }
  }
  if (!out) { try { out = fallbackLine(); } catch { out = 'ultracost'; } }
  process.stdout.write(out + '\n');
}
