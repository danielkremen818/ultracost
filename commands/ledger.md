---
description: Show cumulative savings vs an all-opus baseline across recorded runs, with the per-run trend and today's spend.
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost ledger

You are running the **ledger** workflow. Goal: show the running savings and the trend.

1. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" ledger
   ```
2. Interpret the total saved, the per-run sparkline trend, and today's spend. If there are
   no runs yet, explain that the ledger fills in as ultracode workflows complete.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
