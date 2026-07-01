#!/usr/bin/env node
// ultracost deterministic cost gate — ON BY DEFAULT (PreToolUse, matcher "Workflow").
// The plugin registers this in hooks/hooks.json so EVERY dynamic-workflow launch
// pauses before it runs — it does not depend on the model choosing to ask. It reads
// the drafted script from tool_input.script, runs the static guard + cost estimate
// (calibrated from your real usage when available), enforces the policy budget caps,
// and returns a permission decision with an aligned mini cost table up front, so an
// accidental all-Opus fan-out (or an over-budget launch) can't slip through.
//
// A PreToolUse hook runs in EVERY permission mode (bypass only auto-approves the
// "ask" path; a "deny" is honored regardless of mode). So the gate is mode-aware:
// it hard-denies a problem workflow in the modes where an "ask" can't pause.
//
// Modes (env ULTRACOST_GATE):
//   (unset)  mode-aware default. Clean (all pinned, within budget) -> ask + estimate,
//            every mode. Problem (unpinned/banned/inherit) -> ask + warning in default
//            /acceptEdits/auto; DENY in bypassPermissions/dontAsk. Budget exceeded ->
//            DENY in every mode (a hard cap).
//   strict   deny on ANY problem, in every mode; ask (with estimate) when all clean.
//   ask      never escalate to deny — always ask (opts out of budget + mode denies).
//   off      disable entirely (headless `claude -p`, Auto Mode, CI).
//
// Residual limitation: Claude Code currently skips PreToolUse hooks for subagents
// dispatched under bypassPermissions (anthropics/claude-code#43772).

import { loadPolicy } from '../../src/policy.js';
import { estimateText } from '../../src/estimate.js';
import { analyze, CODES } from '../../src/guard.js';
import { applyCalibration, spentToday } from '../../src/loop.js';

const money = (x) => '$' + Number(x).toFixed(4);
const MODE = process.env.ULTRACOST_GATE;
const ESCALATE_MODES = new Set(['bypassPermissions', 'dontAsk']);

// systemMessage is the documented channel for surfacing text to the USER from a hook
// (hooks have no TTY); Claude Code does NOT render permissionDecisionReason for an
// "ask" (anthropics/claude-code#24059), so we send both.
function decide(decision, message) {
  process.stdout.write(JSON.stringify({
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: message
    }
  }));
  process.exit(0);
}
const ask = (r) => decide('ask', r);
const deny = (r) => decide('deny', r);

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let d = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) d += c;
  return d;
}

if (MODE === 'off') process.exit(0);

let evt = {};
try {
  evt = JSON.parse(await readStdin());
} catch {
  process.exit(0);
}

if (evt?.tool_name !== 'Workflow') process.exit(0);
const permMode = evt?.permission_mode;

const script = evt?.tool_input?.script;
if (typeof script !== 'string') {
  ask('ultracost cost gate: a dynamic workflow is about to launch, but its script could not be read to estimate cost. Approve to launch, or deny and review.');
}

// An aligned, multi-line cost table — far more scannable than one dense line.
function costTable(e) {
  const a = e.agents;
  const agents = a.fanoutGroups
    ? `~${a.assumedTotal} (${a.known} fixed + ${a.fanoutGroups} fan-out x ~${a.assumedPerFanout})`
    : `${a.known}`;
  const mix = Object.entries(e.modelMix).map(([k, v]) => `${v}x ${k}`).join(', ') || 'none';
  return [
    `  agents     ${agents}`,
    `  model mix  ${mix}`,
    `  tiered     ${money(e.cost.tiered)}   vs all-${e.assumptions.sessionModel} ${money(e.cost.baseline)}   (save ${money(e.cost.savings)}, ${e.cost.savingsPct}%)`
  ].join('\n');
}

try {
  const { policy } = loadPolicy();
  const e = estimateText(script, applyCalibration(policy));
  const { stages, findings } = analyze(script, policy);

  const unpinned = findings.filter((f) => f.code === CODES.NOOPTS || f.code === CODES.MISSING).length;
  const banned = findings.filter((f) => f.code === CODES.BANNED).length;
  const inherit = findings.filter((f) => f.code === CODES.INHERIT).length;
  const table = costTable(e);

  // 1) Budget caps — a hard pre-flight stop in every mode (unless =ask opts out).
  const budget = policy.budget || {};
  const today = spentToday();
  const overRun = budget.perRun != null && e.cost.tiered > budget.perRun;
  const overDay = budget.perDay != null && today + e.cost.tiered > budget.perDay;
  if ((overRun || overDay) && MODE !== 'ask') {
    const why = overRun
      ? `est. ${money(e.cost.tiered)} exceeds budget.perRun ${money(budget.perRun)}`
      : `today's spend ${money(today)} + est. ${money(e.cost.tiered)} exceeds budget.perDay ${money(budget.perDay)}`;
    deny(`\u26a0 ultracost budget: ${why}.\nultracost estimate:\n${table}\nReduce the workflow (cheaper tiers, fewer stages, less fan-out) and relaunch, or raise the cap in policy.json.`);
  }

  // 2) Pinning problems.
  const problems = [];
  if (unpinned) problems.push(`${unpinned}/${stages} stage(s) NOT pinned -> will inherit ${e.assumptions.sessionModel}`);
  if (banned) problems.push(`${banned} stage(s) pin a banned model`);
  if (inherit) problems.push(`${inherit} stage(s) use model:'inherit'`);

  if (problems.length) {
    const head = `\u26a0 ultracost: ${problems.join('; ')}.`;
    const hard = MODE === 'strict' || (MODE !== 'ask' && ESCALATE_MODES.has(permMode));
    if (hard) {
      deny(`${head}\nultracost estimate:\n${table}\nPin every stage (opus for reasoning, sonnet for mechanical work) and relaunch.`);
    }
    ask(`${head}\nultracost estimate:\n${table}\nDeny and ask me to pin every stage, or approve to run as-is.`);
  }

  // 3) Clean.
  ask(`ultracost estimate:\n${table}\nApprove to launch, or deny and ask me to make it cheaper.`);
} catch {
  ask('ultracost cost gate: a dynamic workflow is about to launch (cost estimate unavailable). Approve to launch, or deny and review.');
}
