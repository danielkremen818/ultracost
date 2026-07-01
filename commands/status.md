---
description: Report how ultracost is delivered (plugin / cli / both / none) and the active policy, and surface any permission-mode caveat that weakens the cost gate.
allowed-tools: Bash, Read, AskUserQuestion
---
# ultracost status

You are running the **status** workflow. Goal: confirm ultracost is wired correctly and
flag anything that weakens it.

1. Gather evidence:
   ```bash
   env -u NO_COLOR FORCE_COLOR=3 node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" status
   ```
2. Interpret the delivery verdict and policy. If delivery is `both`, recommend removing
   one. **Most important:** if the permission mode is `bypassPermissions`/`dontAsk`, warn
   that the gate's ask path auto-approves (clean workflows won't pause) and suggest turning
   bypass off (shift+tab) for the full pre-flight stop.

## How to present this

The CLI output is your **evidence** — its panels, tables, and bars (in color, since
`FORCE_COLOR` is set) are shown to the user in the command-output view; don't just
re-echo them, and don't strip them either. Lead with your reasoning and the recommended
action. When you offer choices, use the **AskUserQuestion** tool so the user gets a native
picker, then carry out what they choose. Keep prose tight.
