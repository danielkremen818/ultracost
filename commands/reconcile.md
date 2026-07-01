---
description: Reconcile a real workflow run — estimate vs ACTUAL per stage from local transcripts — and judge whether the routing held up.
argument-hint: [--last | <workflow-id>]
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost reconcile

You are running the **reconcile** workflow. Goal: did the per-stage routing match
reality, and what would you change next time.

1. Pass `$ARGUMENTS` through (`--last`, a workflow id, or nothing → latest).
2. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" reconcile $ARGUMENTS
   ```
3. Interpret: which stages cost the most, did any opus stage do mechanical work (a future
   sonnet candidate), and what was saved vs all-opus. Offer to `/ultracost:calibrate` if
   the estimate looked off.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
