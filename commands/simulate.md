---
description: Compare a workflow's cost under all-opus, the tiered pins as written, and aggressive all-sonnet — then recommend the right point on the quality/cost curve.
argument-hint: <path-to-workflow-script>
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost simulate

You are running the **simulate** workflow. Goal: show the quality/cost curve and give a
recommendation.

1. Use `$ARGUMENTS` as the script path.
2. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" simulate $ARGUMENTS
   ```
3. Interpret the three totals (all-opus / tiered / all-sonnet). Recommend where this
   workflow should sit — quality-first keeps reasoning on `opus`; only push toward
   all-sonnet if the work is genuinely mechanical. Be specific about the tradeoff.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
