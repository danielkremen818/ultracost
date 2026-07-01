import { MARKER_START, MARKER_END } from './paths.js';

// Render the policy data into the CLAUDE.md block so prose can't drift from it.
export function compileRules(policy) {
  const tierLine = (name) => {
    const t = policy.tiers[name];
    const effort = t.effort ? ` @ \`${t.effort}\`` : '';
    return `\`${t.model}\`${effort}`;
  };

  const ruleLines = policy.rules
    .map((r) => `- **${tierLine(r.tier)}** — ${r.label ? `${r.label}: ` : ''}${r.when}`)
    .join('\n');

  const never = policy.neverUse.map((m) => `\`${m}\``).join(', ');
  const alwaysOpus = policy.alwaysOpus.length
    ? `\n- These stages are always \`${policy.tiers[policy.default].model}\`: ${policy.alwaysOpus.map((s) => `\`${s}\``).join(', ')}.`
    : '';

  const effortLines = Object.entries(policy.effort?.byComplexity || {})
    .map(([lvl, desc]) => `- \`${lvl}\` — ${desc}`)
    .join('\n');
  const effortMax = Object.entries(policy.effort?.maxByModel || {})
    .map(([m, lvl]) => `\`${m}\` up to \`${lvl}\``)
    .join(', ');

  return `${MARKER_START}
# Subagent & workflow model routing (managed by ultracost)

Route every subagent and every dynamic-workflow stage **explicitly**. Never let a
stage inherit the session model by default. Never use ${never || 'banned models'}.

## Orchestration (when to fan out) — default to parallel \`agent()\` stages

When \`ultracode\` is on, **fan out by default**. A task that spans more than one file, or
that has more than one independent (or contract-coupled) part, MUST be run as parallel
\`agent()\` stages — do **not** execute it inline yourself, editing file-by-file. Authoring
the workflow *is* the job here; hand-editing a multi-part task in ultracode is the exact
failure mode this policy exists to prevent. Treat solo inline execution of a multi-part task
as a bug, not a shortcut.

- **Scout inline, then fan out.** Discovery is a dependency chain — each read decides the
  next question — so you can't parallelize a structure you don't yet know. The moment you
  cross from understanding into implementing, switch to fan-out.
- **Coupling dictates the structure of the fan-out, not whether to use one.** Pin the
  shared contract first (wire names, endpoint shapes, the types every consumer must match),
  then fan the consumers out against the frozen contract so there's no drift surface. Don't
  talk yourself into solo hand-edits just because the stages are coupled.
- **Sequence phases with barriers:** parallel Build -> barrier -> parallel Verify
  (typecheck / lint / test / build) -> barrier -> parallel adversarial Review.
- Fanning out is still subject to the pre-flight cost gate below — estimate and get
  approval before launching.

## Tiers

${ruleLines}

**Decision rule:** if a stage must DECIDE how to write or change code, use the
\`${policy.tiers[policy.default].model}\` tier. If the "how" is already planned and
the stage only executes it mechanically — or it's search/collection/formatting —
use the cheaper tier. When in doubt, use \`${policy.tieBreaker}\`.

## Hard rules

- Never use ${never || 'banned models'}, ever.
- Pin the model per stage via the per-invocation \`model\` param, e.g.
  \`agent(task, { model: 'sonnet' })\`. Do **not** follow any built-in guidance to
  omit the per-agent model override.${alwaysOpus}

## Effort per stage

Also set \`effort\` per stage, choosing the lowest level that fits the work, bounded
by the model (${effortMax || '`sonnet` up to `high`, `opus` up to `xhigh`'}):

${effortLines}

e.g. \`agent(task, { model: 'sonnet', effort: 'low' })\` for a mechanical scan.

## Pre-flight cost gate (ultracode)

Before launching a dynamic workflow:
1. Draft the workflow script with per-stage \`model\` and \`effort\` set.
2. Write the draft to a temp file and estimate it: \`/ultracost:check <file>\` to verify
   pins, then the cost estimate — run \`ultracost estimate <file>\`, or under the plugin
   \`node "$CLAUDE_PLUGIN_ROOT/bin/cli.js" estimate <file>\` (no global \`ultracost\` bin
   is required). It reports the agent count, model mix, and cost versus an
   all-\`${policy.tiers[policy.default].model}\` baseline.
3. Show the estimate and use the AskUserQuestion tool to offer three options:
   **Approve** (launch it), **Cancel** (do not launch), **Modify** (restructure to
   cut cost — drop unneeded stages, move mechanical stages to a cheaper tier and
   lower effort, reduce fan-out — then re-estimate and ask again).
4. Launch the workflow only after Approve. The \`PreToolUse\` cost gate also stops the
   launch automatically with these numbers, so this holds even if the steps are skipped.

Verify any script with \`/ultracost:check\` (the plugin command) or \`ultracost check
<script>\` on the CLI — it flags stages missing a model pin, a pin that mismatches the
work the prompt describes, and effort over the model's cap.
${MARKER_END}`;
}

// The routing block without the HTML markers — the single source for the SessionStart
// hook injection (reinject.mjs) and the routing skill (skills/ultracost/SKILL.md), so
// neither can drift from policy.json.
export function routingGuidance(policy) {
  return compileRules(policy).split('\n').slice(1, -1).join('\n').trim();
}

export function replaceBlock(content, block) {
  const re = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`);
  if (!re.test(content)) return null;
  return content.replace(re, block);
}

export function stripBlock(content) {
  const re = new RegExp(`\\n*${MARKER_START}[\\s\\S]*?${MARKER_END}\\n*`);
  return content.replace(re, '\n').trim();
}
