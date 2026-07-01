---
description: Report real token cost from local transcripts (main loop vs subagents vs workflow stages) and point out where the spend is concentrated. Offline.
argument-hint: [dir]
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost usage

You are running the **usage** workflow. Goal: show where real spend goes and what to do
about it.

1. Use `$ARGUMENTS` as the projects dir if given, else the default.
2. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" usage <dir>
   ```
3. Interpret the split (main / subagent / workflow-stage, and by model). If workflow
   stages are a big share, suggest calibrating and reconciling a recent run.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
