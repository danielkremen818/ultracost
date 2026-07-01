#!/usr/bin/env node
// Generate the plugin slash commands (commands/*.md) from one table.
//
// These are AGENTIC commands, not shell wrappers: the ultracost CLI is the agent's
// DATA TOOL (it produces the colored panels/bars), and the model then reasons over the
// result and, where a decision is useful, drives a NATIVE interactive step with the
// AskUserQuestion tool (the only custom interactive UI a plugin can invoke — Claude
// Code's own widgets like the effort slider are first-party and not plugin-renderable).
//
// Run after changing a command:  node scripts/generate-commands.mjs
// tests/surfaces.test.js fails if commands/ drifts from this output.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/paths.js';

// FORCE_COLOR makes the visual kit emit color even though the Bash tool is not a TTY, so
// the data the agent gathers looks like the `npx` terminal output. `env -u NO_COLOR`
// clears any ambient NO_COLOR (which otherwise wins per the spec) so it is deterministic.
const RUN = 'env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js"';

const DEFAULT_TOOLS = 'Bash, Read, AskUserQuestion';

// name -> { hint, tools, description, steps }.
export const COMMANDS = {
  check: {
    hint: '[path-to-workflow-script-or-dir]',
    tools: 'Bash, Read, Edit, AskUserQuestion',
    description: 'Guard a dynamic-workflow script and fix it: flag agent() stages that would inherit the session model or mismatch the task, propose the right per-stage pins, and offer to apply them.',
    steps: `You are running the **check** workflow. Goal: leave the script with every \`agent()\`
stage correctly pinned. Work as an agent — the CLI gives you evidence, you decide and act.

1. Pick the target: if \`$ARGUMENTS\` is set use it; otherwise find the most recently
   modified \`\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/*/workflows/scripts/*.js\`; if
   none, use the current directory.
2. Gather evidence:
   \`\`\`bash
   ${RUN} check <target>
   \`\`\`
3. Reason per finding. For UC001/UC002 (no pin) and UC006 (wrong tier), open the script
   with Read and decide the correct tier from the stage's prompt and the policy — \`opus\`
   @ \`xhigh\` for work that DECIDES how to change code (design, refactor, debug, review,
   synthesis); \`sonnet\` for pre-planned mechanical/search/format work; never \`haiku\`;
   alwaysOpus roles stay on opus (UC008); cap effort per model (UC007). Build a concrete
   per-stage proposal (file:line → \`{ model, effort }\`).
4. If there is nothing to fix, say so and stop. Otherwise present the proposal, then use
   **AskUserQuestion** to offer: *Apply all* (the unambiguous \`--fix\` cases plus your
   hand-pins via Edit), *Only safe auto-fix* (run \`${RUN} check <target> --fix\`), *Show
   the edits first*, or *Cancel*.
5. Carry out the choice, then re-run the guard to confirm it is clean.`
  },
  estimate: {
    hint: '<path-to-workflow-script>',
    tools: 'Bash, Read, Edit, AskUserQuestion',
    description: 'Estimate a workflow before launch and help cut its cost: agent count, model mix, tiered vs all-opus, then surface the costly stages and offer concrete downgrades.',
    steps: `You are running the **estimate** workflow. Goal: a clear cost picture and, if it is
expensive, a cheaper plan.

1. Use \`$ARGUMENTS\` as the script path (printed when an ultracode run starts).
2. Gather evidence:
   \`\`\`bash
   ${RUN} estimate $ARGUMENTS
   \`\`\`
3. Interpret it: which stages dominate the cost, and are any mechanical/search stages
   still on \`opus\` or at higher effort than the work needs? Read the script if you need
   the stage prompts.
4. If there is a real saving available, name the specific stages to move (e.g. "stage 2
   'list files' → sonnet"), then use **AskUserQuestion**: *Apply these downgrades* (edit
   the pins and re-estimate), *Keep as is*, or *Explain a stage*. If it is already lean,
   say so and stop.`
  },
  explain: {
    hint: '<path-to-workflow-script>',
    tools: DEFAULT_TOOLS,
    description: 'Explain a workflow stage by stage — pinned model, effort, the tier the prompt reads like, est cost, and which guard checks fire — and flag any pin that disagrees with the work.',
    steps: `You are running the **explain** workflow. Goal: the user understands why each stage is
priced and pinned the way it is.

1. Use \`$ARGUMENTS\` as the script path.
2. Gather evidence:
   \`\`\`bash
   ${RUN} explain $ARGUMENTS
   \`\`\`
3. Walk the stages that matter: confirm each pin fits the work (reads-like tier vs pinned
   model), and call out any UC006/UC007/UC008 flag with the concrete reason. If a stage is
   mispinned, offer (via **AskUserQuestion**) to jump into the \`/ultracost:check\` fix flow.`
  },
  simulate: {
    hint: '<path-to-workflow-script>',
    tools: DEFAULT_TOOLS,
    description: "Compare a workflow's cost under all-opus, the tiered pins as written, and aggressive all-sonnet — then recommend the right point on the quality/cost curve.",
    steps: `You are running the **simulate** workflow. Goal: show the quality/cost curve and give a
recommendation.

1. Use \`$ARGUMENTS\` as the script path.
2. Gather evidence:
   \`\`\`bash
   ${RUN} simulate $ARGUMENTS
   \`\`\`
3. Interpret the three totals (all-opus / tiered / all-sonnet). Recommend where this
   workflow should sit — quality-first keeps reasoning on \`opus\`; only push toward
   all-sonnet if the work is genuinely mechanical. Be specific about the tradeoff.`
  },
  diff: {
    hint: '<old-script.js> <new-script.js>',
    tools: DEFAULT_TOOLS,
    description: 'Diff the estimated cost of two workflow versions and judge whether the change is worth it; add --ci for a PR-comment table.',
    steps: `You are running the **diff** workflow. Goal: explain how an edit changed the cost and
whether that is justified.

1. Take two paths from \`$ARGUMENTS\` (old, then new).
2. Gather evidence:
   \`\`\`bash
   ${RUN} diff <old> <new>
   \`\`\`
3. Interpret the delta (tiered cost + agent count): what drove it, and is it a reasonable
   trade for the capability gained? If this is for a pull request, re-run with \`--ci\` to
   emit the Infracost-style markdown table and hand that back.`
  },
  audit: {
    hint: '[dir]',
    tools: DEFAULT_TOOLS,
    description: 'Audit pin coverage across your real workflow scripts, identify the worst offenders, and offer to check or fix a specific one.',
    steps: `You are running the **audit** workflow. Goal: a read on pin hygiene across history and a
next action.

1. Use \`$ARGUMENTS\` as the directory if given, else \`\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects\`.
2. Gather evidence:
   \`\`\`bash
   ${RUN} audit <dir>
   \`\`\`
3. Interpret the totals and unpinned ratio. If coverage is poor, offer (via
   **AskUserQuestion**) to run \`/ultracost:check\` on the worst script and fix it.`
  },
  usage: {
    hint: '[dir]',
    tools: DEFAULT_TOOLS,
    description: 'Report real token cost from local transcripts (main loop vs subagents vs workflow stages) and point out where the spend is concentrated. Offline.',
    steps: `You are running the **usage** workflow. Goal: show where real spend goes and what to do
about it.

1. Use \`$ARGUMENTS\` as the projects dir if given, else the default.
2. Gather evidence:
   \`\`\`bash
   ${RUN} usage <dir>
   \`\`\`
3. Interpret the split (main / subagent / workflow-stage, and by model). If workflow
   stages are a big share, suggest calibrating and reconciling a recent run.`
  },
  reconcile: {
    hint: '[--last | <workflow-id>]',
    tools: DEFAULT_TOOLS,
    description: 'Reconcile a real workflow run — estimate vs ACTUAL per stage from local transcripts — and judge whether the routing held up.',
    steps: `You are running the **reconcile** workflow. Goal: did the per-stage routing match
reality, and what would you change next time.

1. Pass \`$ARGUMENTS\` through (\`--last\`, a workflow id, or nothing → latest).
2. Gather evidence:
   \`\`\`bash
   ${RUN} reconcile $ARGUMENTS
   \`\`\`
3. Interpret: which stages cost the most, did any opus stage do mechanical work (a future
   sonnet candidate), and what was saved vs all-opus. Offer to \`/ultracost:calibrate\` if
   the estimate looked off.`
  },
  calibrate: {
    hint: null,
    tools: DEFAULT_TOOLS,
    description: 'Tune the estimator from your real token usage (outlier-filtered prior) so future estimates match your reality, and report what changed.',
    steps: `You are running the **calibrate** workflow. Goal: update the token prior and explain the
effect.

1. Apply the calibration:
   \`\`\`bash
   ${RUN} calibrate
   \`\`\`
2. Report what was learned (samples, tokens/stage, per-model) and that \`estimate\`,
   \`explain\`, \`simulate\`, and the cost gate now use your real sizes. If there was too
   little data, say what is needed (run more ultracode workflows, then re-calibrate).`
  },
  ledger: {
    hint: null,
    tools: DEFAULT_TOOLS,
    description: 'Show cumulative savings vs an all-opus baseline across recorded runs, with the per-run trend and today\'s spend.',
    steps: `You are running the **ledger** workflow. Goal: show the running savings and the trend.

1. Gather evidence:
   \`\`\`bash
   ${RUN} ledger
   \`\`\`
2. Interpret the total saved, the per-run sparkline trend, and today's spend. If there are
   no runs yet, explain that the ledger fills in as ultracode workflows complete.`
  },
  status: {
    hint: null,
    tools: DEFAULT_TOOLS,
    description: 'Report how ultracost is delivered (plugin / cli / both / none) and the active policy, and surface any permission-mode caveat that weakens the cost gate.',
    steps: `You are running the **status** workflow. Goal: confirm ultracost is wired correctly and
flag anything that weakens it.

1. Gather evidence:
   \`\`\`bash
   ${RUN} status
   \`\`\`
2. Interpret the delivery verdict and policy. If delivery is \`both\`, recommend removing
   one. **Most important:** if the permission mode is \`bypassPermissions\`/\`dontAsk\`, warn
   that the gate's ask path auto-approves (clean workflows won't pause) and suggest turning
   bypass off (shift+tab) for the full pre-flight stop.`
  },
  hud: {
    hint: '[setup|preview|disable]',
    tools: 'Bash, Read, AskUserQuestion',
    description: 'Set up, preview, or disable the ultracost HUD statusline — a live multi-line panel showing session cost, cumulative savings vs all-opus, the subagents running right now (model + tier + elapsed), and an animated pixel-art ultracost logo.',
    steps: `You are running the **hud** workflow. The HUD is a Claude Code statusline command that
renders a live ultracost panel (cost + savings + running subagents + animated logo). Goal:
do exactly what \`$ARGUMENTS\` asks — \`preview\` (default), \`setup\`, or \`disable\`.

1. Read \`$ARGUMENTS\`: if it is \`setup\` go to step 3, if it is \`disable\` go to step 4,
   otherwise (empty or \`preview\`) do step 2.
2. **preview** — render the HUD from a sample statusline payload so the user sees exactly
   what it looks like, and show it as evidence:
   \`\`\`bash
   echo '{"session_id":"preview","transcript_path":"/tmp/none.jsonl","model":{"id":"claude-opus-4-8","display_name":"Opus 4.8 (1M context)"},"effort":{"level":"xhigh"},"cost":{"total_cost_usd":0.21},"context_window":{"used_percentage":41,"context_window_size":1000000}}' \\
     | ${RUN} hud
   \`\`\`
   Walk the regions briefly (savings headline, today vs budget, session cost, model/effort/context,
   the running-subagents list, the animated logo) and stop. Do not change any settings on preview.
3. **setup** — first preview it as in step 2 so the user knows what they are enabling, then
   use **AskUserQuestion** to confirm: *Set ultracost as my statusline* or *Cancel*. Only if
   they confirm, install it:
   \`\`\`bash
   ${RUN} hud --install
   \`\`\`
   Then relay the notice the CLI prints: ultracost set itself as the Claude Code statusline,
   the previous statusline was backed up, and it is restored on disable/uninstall. Mention they
   can re-run \`/ultracost:hud preview\` or \`/ultracost:hud disable\` any time.
4. **disable** — restore the previous statusline:
   \`\`\`bash
   ${RUN} hud --uninstall
   \`\`\`
   Confirm what was restored (the backed-up statusline, or removed if there was none).`
  }
};

// Appended to every command: the CLI output is evidence to surface, and the command is
// agentic (reason + act), not a script that only echoes.
const FOOTER = `## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
\`FORCE_COLOR\` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.`;

export function renderCommand(name, c) {
  const fm = ['---', `description: ${c.description}`];
  if (c.hint) fm.push(`argument-hint: ${c.hint}`);
  fm.push(`allowed-tools: ${c.tools || DEFAULT_TOOLS}`, '---', '');
  return `${fm.join('\n')}# ultracost ${name}\n\n${c.steps}\n\n${FOOTER}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] || join(ROOT, 'commands');
  for (const [name, c] of Object.entries(COMMANDS)) {
    const file = join(outDir, `${name}.md`);
    writeFileSync(file, renderCommand(name, c));
    console.log('wrote ' + file);
  }
}
